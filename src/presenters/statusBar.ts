import * as vscode from 'vscode';
import { Store } from '../store';
import { ConfigService } from '../config';
import { makeT } from '../i18n';
import { computeUtilization, formatPercent, fmtHours } from '../calc';
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
    this.itemPause.show();

    const unsub = store.subscribe((state) => this.render(state));
    this.disposables.push({ dispose: unsub });

    // Initial render
    this.render(store.getState());
  }

  private render(state: AppState): void {
    try {
      // Pause item always visible
      this.itemPause.text = state.ui.isPaused ? '$(play) \u23F8\uFE0F' : '$(debug-pause) \u23F8\uFE0F';
      this.itemPause.tooltip = state.ui.isPaused ? 'Resume auto-refresh' : 'Pause auto-refresh';

      if (state.authStatus === 'missing') {
        this.itemWeekly.text = '$(key) Kimi: sign in';
        this.itemWeekly.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.itemWeekly.color = new vscode.ThemeColor('statusBarItem.errorForeground');
        this.itemWindow.hide();
        return;
      }

      if (state.error && state.authStatus === 'failed') {
        this.itemWeekly.text = '$(warning) Kimi: auth failed';
        this.itemWeekly.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.itemWindow.hide();
        return;
      }

      if (!state.quota) {
        this.itemWeekly.text = '$(sync~spin) Kimi…';
        this.itemWeekly.backgroundColor = undefined;
        this.itemWindow.hide();
        return;
      }

      const metrics = computeUtilization(state.quota);
      const isStale = state.lastSuccessfulFetchAt
        ? Date.now() - state.lastSuccessfulFetchAt > STALE_THRESHOLD_MS
        : false;
      const staleIndicator = isStale ? ' \uD83D\uDCA4' : '';
      const errorIndicator = state.error && (state.error.includes('network') || state.error.includes('ECONN'))
        ? ' \u26D3\uFE0F\u200D\uD83D\uDCA5'
        : '';

      if (this.config.displayMode === 'absolute') {
        this.itemWeekly.text = `\uD83C\uDF18 ${state.quota.weeklyUsed}/${state.quota.weeklyLimit}${errorIndicator}`;
        this.itemWindow.text = `5\uFE0F\u20E3 ${state.quota.windowUsed}/${state.quota.windowLimit}${staleIndicator}`;
      } else {
        this.itemWeekly.text = `\uD83C\uDF18 ${formatPercent(metrics.weeklyPct, 1)}${errorIndicator}`;
        this.itemWindow.text = `5\uFE0F\u20E3 ${formatPercent(metrics.windowPct, 1)}${staleIndicator}`;
      }

      this.itemWeekly.color = utilizationToColor(metrics.weeklyUtil);
      this.itemWindow.color = utilizationToColor(metrics.windowUtil);
      this.itemWeekly.backgroundColor = undefined;
      this.itemWeekly.show();
      this.itemWindow.show();

      // Tooltip: lazy build
      this.itemWeekly.tooltip = this.buildTooltip(state);
      this.itemWindow.tooltip = this.itemWeekly.tooltip;
    } catch (err) {
      console.error('StatusBar render error', err);
    }
  }

  private buildTooltip(state: AppState): vscode.MarkdownString {
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

    if (!state.quota) {
      md.appendMarkdown(`\`\`\`text\n${t('tooltip.title')}\n${'─'.repeat(29)}\nLoading…\n\`\`\``);
      return md;
    }

    const q = state.quota;
    const metrics = computeUtilization(q);
    const weeklyReset = q.weeklyResetAt > Date.now() ? fmtHours((q.weeklyResetAt - Date.now()) / 3600000) : '?';
    const windowReset = q.windowResetAt > Date.now() ? fmtHours((q.windowResetAt - Date.now()) / 3600000) : '?';
    const sourceLabel = state.dataSource === 'stale' ? ' ' + t('tooltip.stale') : '';

    md.appendMarkdown(`\`\`\`text\n`);
    md.appendMarkdown(`${t('tooltip.title')}${sourceLabel}\n`);
    md.appendMarkdown(`${'─'.repeat(29)}\n`);
    md.appendMarkdown(`${t('tooltip.window5h')}  ${formatPercent(metrics.windowPct, 2)} [${metrics.windowBar}] ${t('tooltip.resetsIn')} ${windowReset}\n`);
    md.appendMarkdown(`${t('tooltip.window7d')}  ${formatPercent(metrics.weeklyPct, 2)} [${metrics.weeklyBar}] ${t('tooltip.resetsIn')} ${weeklyReset}\n\n`);

    md.appendMarkdown(`${t('tooltip.table.col.used')} | ${t('tooltip.table.col.limit')} | ${t('tooltip.table.col.remaining')}\n`);
    md.appendMarkdown(`5h: ${q.windowUsed} | ${q.windowLimit} | ${q.windowRemaining}\n`);
    md.appendMarkdown(`7d: ${q.weeklyUsed} | ${q.weeklyLimit} | ${q.weeklyLimit - q.weeklyUsed}\n`);

    if (q.parallelLimit) {
      md.appendMarkdown(`\nParallel: ${q.parallelLimit}\n`);
    }

    md.appendMarkdown(`\n${t('tooltip.lastUpdate')} ${state.lastFetchAt ? new Date(state.lastFetchAt).toLocaleString() : '—'}\n`);
    md.appendMarkdown(`\`\`\``);

    return md;
  }

  dispose(): void {
    this.itemWeekly.dispose();
    this.itemWindow.dispose();
    this.itemPause.dispose();
    for (const d of this.disposables) { d.dispose(); }
  }
}
