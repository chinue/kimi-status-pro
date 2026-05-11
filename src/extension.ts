import * as vscode from 'vscode';
import { Store } from './store';
import { ConfigService } from './config';
import { AuthService } from './services/authService';
import { ApiService } from './services/apiService';
import { CacheService } from './services/cacheService';
import { Scheduler } from './services/scheduler';
import { StatusBarPresenter } from './presenters/statusBar';
import { DashboardPanel } from './presenters/dashboard';
import { log, writeApiKey, deleteApiKey, deleteOAuth } from './utils';

const PAUSE_STATE_KEY = 'kimiStatusPro._pauseSignal';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  log('KimiStatusPro v2 activated');

  const store = new Store();
  const config = ConfigService.getInstance();
  const authService = AuthService.getInstance();
  const apiService = ApiService.getInstance();
  const cacheService = CacheService.getInstance();

  authService.init(context.secrets);

  // 1. Restore pause state from globalState (cross-window sync)
  const pausedFromGlobal = context.globalState.get<boolean>(PAUSE_STATE_KEY, false);
  if (pausedFromGlobal) {
    store.dispatch({ type: 'UI_SET_PAUSED', payload: true });
  }

  // 2. Restore cache
  const cached = await cacheService.read();
  if (cached) {
    store.dispatch({ type: 'CACHE_LOADED', payload: cached.quota });
  }

  // 3. Initialize Presenters
  const statusBar = new StatusBarPresenter(store);

  // 4. Start scheduler
  const scheduler = new Scheduler(store, authService, apiService, cacheService);
  scheduler.start();

  // 5. Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('kimiStatusPro.refresh', () => {
      scheduler.force();
    }),
    vscode.commands.registerCommand('kimiStatusPro.signIn', async () => {
      const success = await authService.startOAuthFlow();
      if (success) {
        scheduler.force();
      }
    }),
    vscode.commands.registerCommand('kimiStatusPro.signOut', async () => {
      await deleteApiKey(context.secrets);
      await deleteOAuth(context.secrets);
      authService.invalidate();
      store.dispatch({ type: 'SIGN_OUT' });
    }),
    vscode.commands.registerCommand('kimiStatusPro.setApiKey', () => {
      promptForApiKey(context);
    }),
    vscode.commands.registerCommand('kimiStatusPro.showDashboard', () => {
      DashboardPanel.createOrShow(store);
    }),
    vscode.commands.registerCommand('kimiStatusPro.togglePause', async () => {
      const next = !store.getState().ui.isPaused;
      store.dispatch({ type: 'UI_SET_PAUSED', payload: next });
      await context.globalState.update(PAUSE_STATE_KEY, next);
      // Broadcast via configuration change so other windows pick it up
      const cfg = vscode.workspace.getConfiguration('kimiStatusPro');
      await cfg.update('_pauseSignal', Date.now(), true);
    }),
  );

  // 6. Listen to configuration changes (including pause broadcast)
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('kimiStatusPro')) {
        store.dispatch({ type: 'UI_SET_DISPLAY_MODE', payload: config.displayMode });
        store.dispatch({ type: 'UI_SET_LANGUAGE', payload: config.language });
      }
    })
  );

  // 7. Persist cache on deactivation via subscription disposal
  context.subscriptions.push(
    { dispose: () => { scheduler.stop(); statusBar.dispose(); } }
  );
}

export function deactivate(): void {
  log('KimiStatusPro v2 deactivated');
}

async function promptForApiKey(context: vscode.ExtensionContext): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: 'KimiStatusPro – Set API Key',
    prompt: 'Paste your Kimi API key (sk-...).',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'sk-...',
  });
  if (!value?.trim()) return;
  await writeApiKey(context.secrets, value.trim());
  void vscode.window.showInformationMessage('API key saved.');
}
