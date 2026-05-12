// DESIGN: v2-dashboard-design.md
// AGENTS: fmt->calc.ts | err->try-catch | i18n->makeT() | no-disk-IO
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { Store } from '../store';
import { ConfigService } from '../config';
import { makeT } from '../i18n';
import { formatPercent } from '../calc';

export class DashboardPanel {
  private static instance: DashboardPanel | undefined;
  private panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private nonce: string;

  private constructor(private store: Store) {
    this.nonce = crypto.randomBytes(16).toString('hex');
    const config = ConfigService.getInstance();
    const locale = config.effectiveLanguage;
    const i18n = makeT(locale);

    this.panel = vscode.window.createWebviewPanel(
      'kimiStatusProDashboard',
      i18n('dashboard.title'),
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.webview.html = this.getHtml(this.nonce, locale);

    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      undefined,
      this.disposables
    );

    const unsub = store.subscribe((state) => this.sendUpdate(state));
    this.disposables.push({ dispose: unsub });

    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  static createOrShow(store: Store): void {
    if (DashboardPanel.instance) {
      DashboardPanel.instance.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    DashboardPanel.instance = new DashboardPanel(store);
  }

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case 'ready':
        this.sendUpdate(this.store.getState());
        break;
      case 'refresh':
        vscode.commands.executeCommand('kimiStatusPro.refresh');
        break;
      case 'toggleMode': {
        const next = ConfigService.getInstance().displayMode === 'percent' ? 'absolute' : 'percent';
        void ConfigService.getInstance().setDisplayMode(next);
        break;
      }
      case 'toggleLanguage': {
        void this.doToggleLanguage();
        break;
      }
      case 'openSettings':
        void vscode.commands.executeCommand('workbench.action.openSettings', '@ext:kayuii.kimi-status-pro');
        break;
    }
  }

  private async doToggleLanguage(): Promise<void> {
    const cfg = ConfigService.getInstance();
    const currentRaw = cfg.language;
    let nextLang: 'en' | 'zh-CN';
    if (currentRaw === 'auto') {
      nextLang = cfg.effectiveLanguage === 'zh-CN' ? 'en' : 'zh-CN';
    } else {
      nextLang = currentRaw === 'zh-CN' ? 'en' : 'zh-CN';
    }
    await cfg.setLanguage(nextLang);
    // Rebuild HTML with the new concrete locale
    this.panel.webview.html = this.getHtml(this.nonce, nextLang);
  }

  private sendUpdate(state: import('../types').AppState): void {
    if (!this.panel.visible) return;
    this.panel.webview.postMessage({ type: 'update', state });
  }

  private getHtml(nonce: string, locale: string): string {
    const isZh = locale === 'zh-CN';
    const i18n = makeT(locale as any);
    return `<!DOCTYPE html>
<html lang="${isZh ? 'zh-CN' : 'en'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <title>${i18n('dashboard.title')}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-font-size);
      padding: 16px; margin: 0;
    }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .header h1 { margin: 0; font-size: 1.2em; font-weight: 600; }
    .header-actions { display: flex; gap: 8px; }
    button {
      background: var(--vscode-button-background); color: var(--vscode-button-foreground);
      border: none; padding: 4px 12px; cursor: pointer; border-radius: 2px; font-size: 0.9em;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .card {
      background: var(--vscode-sideBar-background); border: 1px solid var(--vscode-panel-border);
      border-radius: 4px; padding: 12px 16px; margin-bottom: 12px;
    }
    .card-title { font-size: 0.75em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--vscode-descriptionForeground); margin: 0 0 10px 0; }
    .progress-row { margin-bottom: 10px; }
    .progress-labels { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 0.9em; }
    .progress-meta-row { display: flex; gap: 16px; color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-top: 2px; }
    .progress-track { height: 8px; background: var(--vscode-scrollbarSlider-background); border-radius: 4px; overflow: hidden; }
    .progress-fill { height: 100%; border-radius: 4px; background: var(--vscode-progressBar-background); transition: width 0.3s ease; }
    .progress-fill.warning { background: var(--vscode-editorWarning-foreground); }
    .progress-fill.error { background: var(--vscode-editorError-foreground); }
    .footer { color: var(--vscode-descriptionForeground); font-size: 0.8em; margin-top: 8px; }
    .placeholder { color: var(--vscode-descriptionForeground); font-style: italic; }
    .estimate-badge { font-size: 0.75em; color: var(--vscode-descriptionForeground); margin-left: 4px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spinning { display: inline-block; animation: spin 1s linear infinite; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${i18n('dashboard.title')}</h1>
    <div class="header-actions">
      <button id="btn-refresh">${i18n('dashboard.refresh')}</button>
      <button id="btn-toggle">$ / %</button>
      <button id="btn-lang">&#127760; ${isZh ? 'EN' : '\u4e2d'}</button>
      <button id="btn-settings">&#9881;</button>
    </div>
  </div>

  <div class="card">
    <div class="card-title">${i18n('dashboard.currentUsage')}</div>
    <div class="progress-row">
      <div class="progress-labels">
        <span>${i18n('dashboard.window5h')}<span id="badge-5h" class="estimate-badge"></span></span>
        <span id="lbl-5h">—</span>
      </div>
      <div class="progress-track"><div class="progress-fill" id="fill-5h" style="width:0%"></div></div>
      <div class="progress-meta-row">
        <span class="progress-meta" id="meta-5h"></span>
        <span class="progress-cost" id="cost-5h"></span>
      </div>
    </div>
    <div class="progress-row">
      <div class="progress-labels">
        <span>${i18n('dashboard.window7d')}<span id="badge-7d" class="estimate-badge"></span></span>
        <span id="lbl-7d">—</span>
      </div>
      <div class="progress-track"><div class="progress-fill" id="fill-7d" style="width:0%"></div></div>
      <div class="progress-meta-row">
        <span class="progress-meta" id="meta-7d"></span>
        <span class="progress-cost" id="cost-7d"></span>
      </div>
    </div>
  </div>

  <div class="footer" id="footer">—</div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    const labels = {
      loading: '${i18n('dashboard.loading')}',
      estimate: '${i18n('dashboard.estimate')}',
      justNow: '${i18n('dashboard.justNow')}',
      minutesAgo: '${i18n('dashboard.minutesAgo')}',
      lastUpdated: '${i18n('dashboard.lastUpdated')}',
      localEstimate: '${i18n('dashboard.localEstimate')}',
      cost: '${i18n('dashboard.cost')}',
      secondsAgo: '${i18n('dashboard.secondsAgo')}',
      refreshing: '${i18n('dashboard.refreshing')}',
    };

    let lastFetchAt = 0;
    let currentIsLoading = false;
    let currentDisplayMode = 'percent';

    function updateRefreshButton() {
      const btn = document.getElementById('btn-refresh');
      if (currentIsLoading) {
        const newText = '\u21bb ' + labels.refreshing;
        if (btn.textContent !== newText) btn.textContent = newText;
        btn.disabled = true;
        return;
      }
      btn.disabled = false;
      if (lastFetchAt === 0) {
        const newText = '${i18n('dashboard.refresh')}';
        if (btn.textContent !== newText) btn.textContent = newText;
        return;
      }
      const ageSec = Math.max(0, Math.floor((Date.now() - lastFetchAt) / 1000));
      const newText = '\u21bb ' + labels.secondsAgo.replace('{0}', ageSec);
      if (btn.textContent !== newText) btn.textContent = newText;
    }

    setInterval(updateRefreshButton, 1000);

    // Unified percentage resolution (must match backend calc.ts)
    function resolveWeeklyPct(state) {
      const le = state.localEstimate;
      const q = state.quota;
      if (le && le.calibratedAt !== null) return le.weeklyPct;
      if (q) return q.weeklyUsedPct;
      return 0;
    }
    function resolveWindowPct(state) {
      const le = state.localEstimate;
      const q = state.quota;
      if (le && le.calibratedAt !== null) return le.windowPct;
      if (q) return q.windowUsedPct;
      return 0;
    }

    // Inline formatting helpers (backend imports are not available in webview)
    function formatPercent(pct, decimals) {
      const safe = isFinite(pct) ? pct : 0;
      return safe.toFixed(decimals ?? 0) + '%';
    }
    function fmtDuration(totalSeconds) {
      if (totalSeconds <= 0) return ' 0s';
      const days = Math.floor(totalSeconds / 86400);
      const hours = Math.floor((totalSeconds % 86400) / 3600);
      const mins = Math.floor((totalSeconds % 3600) / 60);
      const secs = totalSeconds % 60;
      const padSpace = (n) => String(n).padStart(2, ' ');
      const padZero = (n) => String(n).padStart(2, '0');
      if (days > 0) return padSpace(days) + 'd' + padZero(hours) + 'h';
      if (hours > 0) return padSpace(hours) + 'h' + padZero(mins) + 'm';
      if (mins > 0) return padSpace(mins) + 'm' + padZero(secs) + 's';
      return padSpace(secs) + 's';
    }

    function fmtReset(ms) {
      if (!ms || ms <= Date.now()) return '';
      const totalSeconds = Math.max(0, Math.floor((ms - Date.now()) / 1000));
      return 'resets in ' + fmtDuration(totalSeconds);
    }

    document.getElementById('btn-refresh').addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });
    document.getElementById('btn-toggle').addEventListener('click', () => {
      vscode.postMessage({ type: 'toggleMode' });
    });
    document.getElementById('btn-lang').addEventListener('click', () => {
      vscode.postMessage({ type: 'toggleLanguage' });
    });
    document.getElementById('btn-settings').addEventListener('click', () => {
      vscode.postMessage({ type: 'openSettings' });
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type !== 'update') return;
      const state = msg.state;
      const quota = state.quota;
      const estimate = state.localEstimate;
      const displayMode = state.ui.displayMode;
      const isLoading = state.isLoading;

      const hasApi = !!quota;
      const hasEstimate = !!estimate;

      // Update refresh button timer state
      lastFetchAt = state.lastFetchAt || 0;
      currentIsLoading = isLoading;
      updateRefreshButton();

      // Toggle button label (DOM diff)
      const btnToggle = document.getElementById('btn-toggle');
      const toggleText = displayMode === 'percent' ? '$ / %' : '% / $';
      if (btnToggle.textContent !== toggleText) btnToggle.textContent = toggleText;
      currentDisplayMode = displayMode;

      if (!hasApi && !hasEstimate) {
        const lbl5h = document.getElementById('lbl-5h');
        const lbl7d = document.getElementById('lbl-7d');
        if (lbl5h.textContent !== labels.loading) lbl5h.textContent = labels.loading;
        if (lbl7d.textContent !== labels.loading) lbl7d.textContent = labels.loading;
        return;
      }

      const w5h = Math.min(100, resolveWindowPct(state) || 0);
      const w7d = Math.min(100, resolveWeeklyPct(state) || 0);

      // Display mode: absolute (used/limit) or percent
      const lbl5h = document.getElementById('lbl-5h');
      const lbl7d = document.getElementById('lbl-7d');
      if (displayMode === 'absolute' && quota) {
        const abs5h = (quota.windowUsed || 0) + ' / ' + (quota.windowLimit || 0);
        const abs7d = (quota.weeklyUsed || 0) + ' / ' + (quota.weeklyLimit || 0);
        if (lbl5h.textContent !== abs5h) lbl5h.textContent = abs5h;
        if (lbl7d.textContent !== abs7d) lbl7d.textContent = abs7d;
      } else {
        const pct5h = formatPercent(w5h, 2);
        const pct7d = formatPercent(w7d, 2);
        if (lbl5h.textContent !== pct5h) lbl5h.textContent = pct5h;
        if (lbl7d.textContent !== pct7d) lbl7d.textContent = pct7d;
      }

      // Progress bars (DOM diff to avoid CSS transition re-trigger)
      const fill5h = document.getElementById('fill-5h');
      const newWidth5h = w5h + '%';
      if (fill5h.style.width !== newWidth5h) fill5h.style.width = newWidth5h;
      const newClass5h = 'progress-fill' + (w5h >= 75 ? ' warning' : '') + (w5h >= 90 ? ' error' : '');
      if (fill5h.className !== newClass5h) fill5h.className = newClass5h;

      const badge5h = document.getElementById('badge-5h');
      const badge5hText = hasApi ? '' : labels.estimate;
      if (badge5h.textContent !== badge5hText) badge5h.textContent = badge5hText;

      const fill7d = document.getElementById('fill-7d');
      const newWidth7d = w7d + '%';
      if (fill7d.style.width !== newWidth7d) fill7d.style.width = newWidth7d;
      const newClass7d = 'progress-fill' + (w7d >= 75 ? ' warning' : '') + (w7d >= 90 ? ' error' : '');
      if (fill7d.className !== newClass7d) fill7d.className = newClass7d;

      const badge7d = document.getElementById('badge-7d');
      const badge7dText = hasApi ? '' : labels.estimate;
      if (badge7d.textContent !== badge7dText) badge7d.textContent = badge7dText;

      // Meta (reset times)
      const meta5h = document.getElementById('meta-5h');
      const meta5hText = quota ? fmtReset(quota.windowResetAt) : '';
      if (meta5h.textContent !== meta5hText) meta5h.textContent = meta5hText;

      const meta7d = document.getElementById('meta-7d');
      const meta7dText = quota ? fmtReset(quota.weeklyResetAt) : '';
      if (meta7d.textContent !== meta7dText) meta7d.textContent = meta7dText;

      // Cost display from localEstimate
      const leCost = state.localEstimate;
      const cost5hEl = document.getElementById('cost-5h');
      const cost7dEl = document.getElementById('cost-7d');
      if (cost5hEl) {
        const c5 = leCost ? labels.cost + leCost.cost5h.toFixed(2) : '';
        if (cost5hEl.textContent !== c5) cost5hEl.textContent = c5;
      }
      if (cost7dEl) {
        const c7 = leCost ? labels.cost + leCost.cost7d.toFixed(2) : '';
        if (cost7dEl.textContent !== c7) cost7dEl.textContent = c7;
      }

      // Footer: last updated time
      const age = state.lastFetchAt
        ? Math.max(0, Math.floor((Date.now() - state.lastFetchAt) / 1000))
        : 0;
      const ageStr = age < 60 ? labels.justNow : Math.floor(age / 60) + labels.minutesAgo;
      const sourceLabel = state.dataSource === 'local-only' ? labels.localEstimate : '';
      const footerText = labels.lastUpdated + ageStr + sourceLabel;
      const footer = document.getElementById('footer');
      if (footer.textContent !== footerText) footer.textContent = footerText;
    });

    // Notify extension that webview is ready to receive initial state
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }

  private dispose(): void {
    DashboardPanel.instance = undefined;
    this.panel.dispose();
    for (const d of this.disposables) { d.dispose(); }
  }
}
