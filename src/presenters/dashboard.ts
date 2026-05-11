import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { Store } from '../store';
import { ConfigService } from '../config';
import { makeT } from '../i18n';
import { computeUtilization, formatPercent } from '../calc';

export class DashboardPanel {
  private static instance: DashboardPanel | undefined;
  private panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(private store: Store) {
    const nonce = crypto.randomBytes(16).toString('hex');
    const config = ConfigService.getInstance();
    const locale = config.effectiveLanguage;
    const i18n = makeT(locale);

    this.panel = vscode.window.createWebviewPanel(
      'kimiStatusProDashboard',
      i18n('dashboard.title'),
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.webview.html = this.getHtml(nonce, locale);

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
      case 'refresh':
        vscode.commands.executeCommand('kimiStatusPro.refresh');
        break;
      case 'toggleMode': {
        const next = ConfigService.getInstance().displayMode === 'percent' ? 'absolute' : 'percent';
        void ConfigService.getInstance().setDisplayMode(next);
        break;
      }
      case 'toggleLanguage': {
        const nextLang = ConfigService.getInstance().effectiveLanguage === 'zh-CN' ? 'en' : 'zh-CN';
        void ConfigService.getInstance().setLanguage(nextLang);
        break;
      }
      case 'openSettings':
        void vscode.commands.executeCommand('workbench.action.openSettings', '@ext:kayuii.kimi-status-pro');
        break;
    }
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
    .card {
      background: var(--vscode-sideBar-background); border: 1px solid var(--vscode-panel-border);
      border-radius: 4px; padding: 12px 16px; margin-bottom: 12px;
    }
    .card-title { font-size: 0.75em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--vscode-descriptionForeground); margin: 0 0 10px 0; }
    .progress-row { margin-bottom: 10px; }
    .progress-labels { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 0.9em; }
    .progress-track { height: 8px; background: var(--vscode-scrollbarSlider-background); border-radius: 4px; overflow: hidden; }
    .progress-fill { height: 100%; border-radius: 4px; background: var(--vscode-progressBar-background); transition: width 0.3s ease; }
    .progress-fill.warning { background: var(--vscode-editorWarning-foreground); }
    .progress-fill.error { background: var(--vscode-editorError-foreground); }
    .footer { color: var(--vscode-descriptionForeground); font-size: 0.8em; margin-top: 8px; }
    .placeholder { color: var(--vscode-descriptionForeground); font-style: italic; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spinning { display: inline-block; animation: spin 1s linear infinite; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${i18n('dashboard.title')}</h1>
    <div class="header-actions">
      <button id="btn-refresh">${i18n('dashboard.refresh')}</button>
      <button id="btn-toggle">${i18n('dashboard.toggleMode')}</button>
      <button id="btn-lang">&#127760; ${isZh ? 'EN' : '中'}</button>
      <button id="btn-settings">&#9881;</button>
    </div>
  </div>

  <div class="card">
    <div class="card-title">${i18n('dashboard.currentUsage')}</div>
    <div class="progress-row">
      <div class="progress-labels">
        <span>5h window</span>
        <span id="lbl-5h">—</span>
      </div>
      <div class="progress-track"><div class="progress-fill" id="fill-5h" style="width:0%"></div></div>
    </div>
    <div class="progress-row">
      <div class="progress-labels">
        <span>7d window</span>
        <span id="lbl-7d">—</span>
      </div>
      <div class="progress-track"><div class="progress-fill" id="fill-7d" style="width:0%"></div></div>
    </div>
  </div>

  <div class="footer" id="footer">—</div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

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

      if (!quota) {
        document.getElementById('lbl-5h').textContent = 'Loading…';
        document.getElementById('lbl-7d').textContent = 'Loading…';
        return;
      }

      const w5h = Math.min(100, (quota.windowUsedPct || 0));
      const w7d = Math.min(100, (quota.weeklyUsedPct || 0));

      const fill5h = document.getElementById('fill-5h');
      fill5h.style.width = w5h + '%';
      fill5h.className = 'progress-fill' + (w5h >= 75 ? ' warning' : '');
      document.getElementById('lbl-5h').textContent = w5h.toFixed(1) + '%';

      const fill7d = document.getElementById('fill-7d');
      fill7d.style.width = w7d + '%';
      fill7d.className = 'progress-fill' + (w7d >= 75 ? ' warning' : '');
      document.getElementById('lbl-7d').textContent = w7d.toFixed(1) + '%';

      const age = state.lastFetchAt
        ? Math.max(0, Math.floor((Date.now() - state.lastFetchAt) / 1000))
        : 0;
      const ageStr = age < 60 ? 'just now' : Math.floor(age / 60) + 'm ago';
      document.getElementById('footer').textContent = 'Last updated: ' + ageStr;
    });
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
