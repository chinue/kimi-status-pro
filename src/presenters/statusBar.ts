// DESIGN: v2-phase2-implementation.md#presentersstatusbarts
import * as vscode from 'vscode';
import { Store } from '../store';
import { ConfigService } from '../config';
import { makeT } from '../i18n';
import {
  computeUtilization, formatPercent, formatPercentPadded,
  fmtHours, fmtTokens, fmtCost,
  buildBar, buildMiniBar, drawBorderTable,
  resolveWeeklyPct, resolveWindowPct,
} from '../calc';
import { AppState } from '../types';

const STALE_THRESHOLD_MS = 120_000; // 2 minutes

function utilizationToColor(util: number): string {
  if (util < 0.20) return '#FFFFFF';
  if (util < 0.40) return '#FFFF80';
  if (util < 0.60) return '#00FF80';
  if (util < 0.80) return '#FF80FF';
  return '#FF0000';
}

export class StatusBarPresenter {
  private itemWeekly: vscode.StatusBarItem;
  private itemWindow: vscode.StatusBarItem;
  private itemPause: vscode.StatusBarItem;
  private config = ConfigService.getInstance();
  private disposables: vscode.Disposable[] = [];

  constructor(private store: Store) {
    const alignment = vscode.StatusBarAlignment.Right;

    this.itemWeekly = vscode.window.createStatusBarItem(alignment, 104);
    this.itemWeekly.name = 'KimiStatusPro Weekly';
    this.itemWeekly.command = 'kimiStatusPro.showDashboard';
    this.itemWeekly.text = '$(sync~spin) Kimi…';
    this.itemWeekly.show();

    this.itemWindow = vscode.window.createStatusBarItem(alignment, 103);
    this.itemWindow.name = 'KimiStatusPro Window';
    this.itemWindow.command = 'kimiStatusPro.refresh';
    this.itemWindow.show();

    this.itemPause = vscode.window.createStatusBarItem(alignment, 102);
    this.itemPause.name = 'KimiStatusPro Pause';
    this.itemPause.command = 'kimiStatusPro.togglePause';
    this.itemPause.text = '\u23F8\uFE0F';
    this.itemPause.show();

    const unsub = store.subscribe((state) => this.render(state));
    this.disposables.push({ dispose: unsub });

    // Initial render
    this.render(store.getState());
  }

  private render(state: AppState): void {
    try {
      const t = makeT(this.config.effectiveLanguage);
      // Pause icon: moon when paused (to indicate dormant), pause symbol when active
      this.itemPause.text = state.ui.isPaused ? '\uD83C\uDF18' : '\u23F8\uFE0F';
      this.itemPause.tooltip = state.ui.isPaused ? t('tooltip.resumeAutoRefresh') : t('tooltip.pauseAutoRefresh');

      // When paused, hide data items and show only pause button
      if (state.ui.isPaused) {
        this.itemWeekly.hide();
        this.itemWindow.hide();
        return;
      }

      if (state.authStatus === 'missing') {
        this.itemWeekly.text = '$(key) Kimi: sign in';
        this.itemWeekly.command = 'kimiStatusPro.signIn';
        this.itemWeekly.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.itemWeekly.color = new vscode.ThemeColor('statusBarItem.errorForeground');
        this.itemWindow.hide();
        return;
      }

      if (state.error && state.authStatus === 'failed') {
        this.itemWeekly.text = '$(warning) Kimi: auth failed';
        this.itemWeekly.command = 'kimiStatusPro.signIn';
        this.itemWeekly.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.itemWindow.hide();
        return;
      }

      const hasApiData = !!state.quota;
      const hasEstimate = !!state.localEstimate;

      if (!hasApiData && !hasEstimate) {
        this.itemWeekly.text = '$(sync~spin) Kimi…';
        this.itemWeekly.backgroundColor = undefined;
        this.itemWindow.hide();
        return;
      }

      // Unified percentage resolution (consistent across statusBar / tooltip / dashboard)
      const weeklyPct = resolveWeeklyPct(state);
      const windowPct = resolveWindowPct(state);
      const weeklyUtil = weeklyPct / 100;
      const windowUtil = windowPct / 100;

      const isStale = state.lastSuccessfulFetchAt
        ? Date.now() - state.lastSuccessfulFetchAt > STALE_THRESHOLD_MS
        : !hasApiData;
      const staleIndicator = isStale ? ' \uD83D\uDCA4' : '';
      const estimateIndicator = !hasApiData && hasEstimate ? ' \uD83D\uDD0D' : ''; // 🔍 for estimate
      const errorIndicator = state.error && (state.error.includes('network') || state.error.includes('ECONN'))
        ? ' \u26D3\uFE0F\u200D\uD83D\uDCA5'
        : '';

      if (this.config.displayMode === 'absolute') {
        if (hasApiData) {
          this.itemWeekly.text = `\uD83C\uDF18 Kimi:${state.quota!.weeklyUsed}/${state.quota!.weeklyLimit}${errorIndicator}`;
          this.itemWindow.text = `5\uFE0F\u20E3 ${state.quota!.windowUsed}/${state.quota!.windowLimit}${staleIndicator}`;
        } else {
          this.itemWeekly.text = `\uD83C\uDF18 Kimi:${weeklyPct > 0 ? '~' + formatPercent(weeklyPct, 1) : '—'}${estimateIndicator}${errorIndicator}`;
          this.itemWindow.text = `5\uFE0F\u20E3 ${windowPct > 0 ? '~' + formatPercent(windowPct, 1) : '—'}${staleIndicator}`;
        }
      } else {
        this.itemWeekly.text = `\uD83C\uDF18 Kimi:${formatPercent(weeklyPct, 1)}${estimateIndicator}${errorIndicator}`;
        this.itemWindow.text = `5\uFE0F\u20E3 ${buildMiniBar(windowUtil, 5)} ${formatPercent(windowPct, 1)}${staleIndicator}`;
      }

      this.itemWeekly.command = 'kimiStatusPro.showDashboard';
      this.itemWeekly.color = utilizationToColor(weeklyUtil);
      this.itemWindow.color = utilizationToColor(windowUtil);
      this.itemWeekly.backgroundColor = undefined;
      this.itemWeekly.show();
      this.itemWindow.show();

      // Tooltip: lazy build (async)
      this.buildTooltip(state).then((tooltip) => {
        this.itemWeekly.tooltip = tooltip;
        this.itemWindow.tooltip = tooltip;
      });
    } catch (err) {
      console.error('StatusBar render error', err);
    }
  }

  private async buildTooltip(state: AppState): Promise<vscode.MarkdownString> {
    const locale = this.config.effectiveLanguage;
    const t = makeT(locale);
    const md = new vscode.MarkdownString();

    if (state.authStatus === 'missing') {
      md.appendMarkdown(`\`\`\`text\n${t('tooltip.title')}\n${'─'.repeat(29)}\n${t('tooltip.notLoggedIn')}\n\`\`\``);
      return md;
    }

    if (state.authStatus === 'failed') {
      md.appendMarkdown(`\`\`\`text\n${t('tooltip.title')}\n${'─'.repeat(29)}\n${t('tooltip.authFailed')}\n\`\`\``);
      return md;
    }

    const hasApiData = !!state.quota;
    const hasEstimate = !!state.localEstimate;

    if (!hasApiData && !hasEstimate) {
      md.appendMarkdown(`\`\`\`text\n${t('tooltip.title')}\n${'─'.repeat(29)}\n${t('dashboard.loading')}\n\`\`\``);
      return md;
    }

    const q = state.quota;
    const le = state.localEstimate;
    const weeklyPct = resolveWeeklyPct(state);
    const windowPct = resolveWindowPct(state);
    const weeklyUtil = weeklyPct / 100;
    const windowUtil = windowPct / 100;

    const weeklyBar = buildBar(weeklyUtil, 10);
    const windowBar = buildBar(windowUtil, 10);

    const weeklyReset = q && q.weeklyResetAt > Date.now()
      ? fmtHours((q.weeklyResetAt - Date.now()) / 3600000)
      : '?';
    const windowReset = q && q.windowResetAt > Date.now()
      ? fmtHours((q.windowResetAt - Date.now()) / 3600000)
      : '?';

    let sourceLabel = '';
    if (state.dataSource === 'stale') sourceLabel = ' ' + t('tooltip.stale');
    else if (state.dataSource === 'local-only') sourceLabel = t('dashboard.estimate');

    const lines: string[] = [];
    lines.push(
      t('tooltip.title') + sourceLabel,
      '─────────────────────────────',
      `${t('tooltip.window5h')}  ${formatPercentPadded(windowPct, 2)} [${windowBar}] ${t('tooltip.resetsIn')} ${windowReset}`,
      `${t('tooltip.window7d')}  ${formatPercentPadded(weeklyPct, 2)} [${weeklyBar}] ${t('tooltip.resetsIn')} ${weeklyReset}`,
    );

    // Quota table via drawBorderTable
    if (q) {
      lines.push('');
      lines.push(t('tooltip.table.quotaSummary'));
      lines.push('─────────────────────────────');
      const quotaHeader = ['', t('tooltip.table.col.used'), t('tooltip.table.col.limit'), t('tooltip.table.col.remaining')];
      const quotaRows = [
        [t('tooltip.window5h'), String(q.windowUsed), String(q.windowLimit), String(q.windowRemaining)],
        [t('tooltip.window7d'), String(q.weeklyUsed), String(q.weeklyLimit), String(q.weeklyLimit - q.weeklyUsed)],
      ];
      lines.push(...drawBorderTable(quotaHeader, quotaRows, ['l', 'r', 'r', 'r']));
      if (q.parallelLimit) {
        lines.push('', `${t('tooltip.table.col.parallel')}: ${q.parallelLimit}`);
      }
    }

    // Local usage table (from memory — store.localEstimate) via drawBorderTable
    const lu = state.localEstimate;
    if (lu && (lu.requests5h > 0 || lu.requests7d > 0 || lu.requestsThisCycle > 0)) {
      lines.push('');
      lines.push(t('tooltip.localUsage'));
      lines.push('─────────────────────────────');
      const localHeader = [
        '',
        t('tooltip.table.col.input'),
        t('tooltip.table.col.output'),
        t('tooltip.table.col.cacheCreate'),
        t('tooltip.table.col.cacheRead'),
        t('tooltip.table.col.requests'),
        t('tooltip.table.col.cost'),
      ];
      const localRows = [
        [
          t('tooltip.table.row.today'),
          fmtTokens(lu.tokensToday),
          '—',
          '—',
          '—',
          String(lu.requestsToday),
          fmtCost(lu.costToday),
        ],
        [
          t('tooltip.table.row.5h'),
          fmtTokens(lu.tokensIn5h),
          fmtTokens(lu.tokensOut5h),
          fmtTokens(lu.tokensCacheCreate5h),
          fmtTokens(lu.tokensCacheRead5h),
          String(lu.requests5h),
          fmtCost(lu.cost5h),
        ],
        [
          t('tooltip.table.row.7d'),
          fmtTokens(lu.tokensIn7d),
          fmtTokens(lu.tokensOut7d),
          fmtTokens(lu.tokensCacheCreate7d),
          fmtTokens(lu.tokensCacheRead7d),
          String(lu.requests7d),
          fmtCost(lu.cost7d),
        ],
      ];
      if (lu.requestsThisCycle > 0) {
        localRows.push([
          t('tooltip.table.row.cycle'),
          fmtTokens(lu.tokensThisCycle),
          '—',
          '—',
          '—',
          String(lu.requestsThisCycle),
          fmtCost(lu.costThisCycle),
        ]);
      }
      lines.push(...drawBorderTable(localHeader, localRows, ['l', 'r', 'r', 'r', 'r', 'r', 'r']));
    }

    lines.push('', `${t('tooltip.lastUpdate')} ${state.lastFetchAt ? new Date(state.lastFetchAt).toLocaleString() : '—'}`);

    md.appendMarkdown(`\`\`\`text\n${lines.join('\n')}\n\`\`\``);
    return md;
  }

  dispose(): void {
    this.itemWeekly.dispose();
    this.itemWindow.dispose();
    this.itemPause.dispose();
    for (const d of this.disposables) { d.dispose(); }
  }
}
