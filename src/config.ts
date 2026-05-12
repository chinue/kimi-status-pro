// DESIGN: v2-phase2-implementation.md#configts
// AGENTS: fmt->calc.ts | err->try-catch | i18n->makeT() | no-disk-IO
import * as vscode from 'vscode';
import { DisplayMode, LanguageSetting } from './types';

const CFG_SECTION = 'kimiStatusPro';

export class ConfigService {
  private static instance: ConfigService;

  static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  private get cfg() {
    return vscode.workspace.getConfiguration(CFG_SECTION);
  }

  get displayMode(): DisplayMode {
    return this.cfg.get<DisplayMode>('displayMode', 'percent');
  }

  async setDisplayMode(mode: DisplayMode): Promise<void> {
    await this.cfg.update('displayMode', mode, true);
  }

  get language(): LanguageSetting {
    return this.cfg.get<LanguageSetting>('language', 'auto');
  }

  async setLanguage(lang: LanguageSetting): Promise<void> {
    await this.cfg.update('language', lang, true);
  }

  get refreshIntervalSeconds(): number {
    return Math.max(30, this.cfg.get<number>('refreshIntervalSeconds', 60));
  }

  get shortRefreshIntervalSeconds(): number {
    return Math.max(1, Math.min(60, this.cfg.get<number>('shortRefreshIntervalSeconds', 5)));
  }

  get dataRetentionDays(): number {
    return Math.max(30, Math.min(3650, this.cfg.get<number>('dataRetentionDays', 365)));
  }

  get updateAnimationDurationMs(): number {
    return Math.max(500, Math.min(10_000, this.cfg.get<number>('updateAnimationDurationMs', 5_000)));
  }

  get updateAnimationIntervalMs(): number {
    return Math.max(100, Math.min(2_000, this.cfg.get<number>('updateAnimationIntervalMs', 300)));
  }

  get effectiveLanguage(): 'en' | 'zh-CN' {
    const lang = this.language;
    if (lang === 'auto') {
      return vscode.env.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
    }
    return lang;
  }
}
