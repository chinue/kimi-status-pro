# KimiStatusPro v2 Phase 1 详细实现文档

> 版本：v2.0.0-draft  
> 日期：2026-05-10  
> 前置文档：
> - `v2-rebuild-design.md` — 整体架构
> - `v2-dashboard-design.md` — 仪表盘设计
> - `v2-local-estimation-design.md` — 本地估算设计  
> **本文档目标**：AI 加载后可直接生成全部源代码，无需额外提示词。

---

## 1. Phase 1 范围

| 模块 | 功能 | 说明 |
|---|---|---|
| **状态栏** | 显示 🌘 weekly% \| 5️⃣ window% | 1位小数，带颜色 |
| **Tooltip** | 悬停显示配额详情表格 | Markdown 格式，ASCII 表格 |
| **定时器** | 每 60s 自动刷新 API | 单一 setTimeout 链 |
| **缓存** | 启动时从磁盘恢复配额数据 | v2 schema，拒绝旧版本 |
| **认证** | OAuth + API Key + CLI fallback | AuthService 统一解析 |
| **登录/登出** | 命令 + 状态栏响应 | `kimiStatusPro.signIn` / `signOut` |
| **手动刷新** | 命令触发立即刷新 | `kimiStatusPro.refresh` |
| **基础仪表盘** | WebView 显示百分比 + 进度条 | 可折叠区块，中英文切换按钮 |
| **语言切换** | 仪表盘内 🌐 按钮切换 | reload WebView，设置持久化 |

**Phase 1 不实现**：本地 JSONL 扫描（Phase 2）、成本曲线（Phase 3）、热力图（Phase 3）、模型明细（Phase 3）、预算告警（Phase 3）。

---

## 2. 文件结构

```
v2/
├── src/
│   ├── extension.ts              # 入口：activate/deactivate
│   ├── types.ts                  # 所有类型定义
│   ├── store.ts                  # Store + reducer + AppState
│   ├── config.ts                 # 配置读取/更新
│   ├── i18n.ts                   # 国际化字典 + makeT
│   ├── calc.ts                   # 纯计算函数
│   ├── utils.ts                  # SecretStorage 工具 + log
│   ├── services/
│   │   ├── authService.ts        # Token 解析（OAuth/API Key/CLI）
│   │   ├── apiService.ts         # HTTP 调用 + 响应解析
│   │   ├── cacheService.ts       # 磁盘缓存读写
│   │   └── scheduler.ts          # 单一 setTimeout 调度器
│   └── presenters/
│       ├── statusBar.ts          # 状态栏 + tooltip
│       └── dashboard.ts          # 基础 WebView 仪表盘
├── test/
│   └── (单元测试，Phase 1 可选)
├── package.json                  # 扩展配置
├── tsconfig.json                 # TypeScript 配置
└── esbuild.js                    # 构建脚本
```

---

## 3. package.json

```json
{
  "name": "kimi-status-pro",
  "displayName": "KimiStatusPro",
  "description": "Monitor Kimi Code quota usage in real-time",
  "version": "0.4.0",
  "publisher": "kayuii",
  "license": "MIT",
  "engines": { "vscode": "^1.74.0" },
  "categories": ["Other"],
  "icon": "../img/logo.png",
  "activationEvents": ["onStartupFinished"],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      { "command": "kimiStatusPro.refresh", "title": "KimiStatusPro: Refresh", "icon": "$(refresh)" },
      { "command": "kimiStatusPro.signIn", "title": "KimiStatusPro: Sign In (OAuth)", "icon": "$(sign-in)" },
      { "command": "kimiStatusPro.signOut", "title": "KimiStatusPro: Sign Out", "icon": "$(sign-out)" },
      { "command": "kimiStatusPro.setApiKey", "title": "KimiStatusPro: Set API Key", "icon": "$(key)" },
      { "command": "kimiStatusPro.showDashboard", "title": "KimiStatusPro: Show Dashboard", "icon": "$(graph)" }
    ],
    "configuration": {
      "title": "KimiStatusPro",
      "properties": {
        "kimiStatusPro.language": {
          "type": "string", "enum": ["auto", "en", "zh-CN"], "default": "auto",
          "description": "Display language (auto-detect or manual)"
        },
        "kimiStatusPro.refreshIntervalSeconds": {
          "type": "number", "default": 60, "minimum": 30,
          "description": "API refresh interval in seconds"
        },
        "kimiStatusPro.displayMode": {
          "type": "string", "enum": ["percent", "absolute"], "default": "percent",
          "description": "Status bar display mode"
        }
      }
    }
  },
  "scripts": {
    "vscode:prepublish": "node esbuild.js --production",
    "build": "node esbuild.js",
    "watch": "node esbuild.js --watch"
  },
  "devDependencies": {
    "@types/node": "^16.18.0",
    "@types/vscode": "^1.74.0",
    "esbuild": "^0.19.0",
    "typescript": "^5.3.0"
  }
}
```

---

## 4. types.ts

```typescript
export interface QuotaData {
  weeklyLimit: number;
  weeklyUsed: number;
  weeklyUsedPct: number;
  weeklyResetAt: number;
  windowLimit: number;
  windowUsed: number;
  windowRemaining: number;
  windowUsedPct: number;
  windowResetAt: number;
  parallelLimit: number;
}

export type AuthStatus = 'unknown' | 'authenticated' | 'missing' | 'expired' | 'failed';
export type DataSource = 'api' | 'cache' | 'stale' | 'no-credentials' | 'no-data';
export type DisplayMode = 'percent' | 'absolute';
export type LanguageSetting = 'auto' | 'en' | 'zh-CN';

export interface AppState {
  quota: QuotaData | null;
  lastFetchAt: number | null;
  error: string | null;
  authStatus: AuthStatus;
  dataSource: DataSource;
  ui: {
    displayMode: DisplayMode;
    language: LanguageSetting;
    isPaused: boolean;
  };
}

export interface ApiResponse {
  ok: boolean;
  data?: QuotaData;
  error?: string;
  authFailed?: boolean;
}

export interface CachedData {
  quota: QuotaData;
  fetchedAt: number;
}

export interface KimiOAuthCredentials {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresAt: number;
  scope: string;
  deviceId: string;
}

export type Action =
  | { type: 'INIT' }
  | { type: 'CACHE_LOADED'; payload: QuotaData }
  | { type: 'API_SUCCESS'; payload: QuotaData }
  | { type: 'API_ERROR'; payload: { error: string; authFailed?: boolean } }
  | { type: 'AUTH_STATUS'; payload: AuthStatus }
  | { type: 'UI_SET_DISPLAY_MODE'; payload: DisplayMode }
  | { type: 'UI_SET_LANGUAGE'; payload: LanguageSetting }
  | { type: 'UI_SET_PAUSED'; payload: boolean }
  | { type: 'SIGN_OUT' };
```

---

## 5. store.ts

**核心要求**：单一状态源，所有修改通过 `dispatch(action)`，UI 只读 `store.getState()`。

```typescript
import * as vscode from 'vscode';
import { AppState, Action, AuthStatus } from './types';

export const defaultState = (): AppState => ({
  quota: null,
  lastFetchAt: null,
  error: null,
  authStatus: 'unknown',
  dataSource: 'no-data',
  ui: {
    displayMode: 'percent',
    language: 'auto',
    isPaused: false,
  },
});

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'INIT':
      return state;

    case 'CACHE_LOADED':
      return {
        ...state,
        quota: action.payload,
        lastFetchAt: action.payload.weeklyResetAt, // 用 resetAt 近似
        dataSource: 'cache',
        error: null,
      };

    case 'API_SUCCESS':
      return {
        ...state,
        quota: action.payload,
        lastFetchAt: Date.now(),
        dataSource: 'api',
        error: null,
        authStatus: state.authStatus === 'missing' ? 'authenticated' : state.authStatus,
      };

    case 'API_ERROR':
      return {
        ...state,
        error: action.payload.error,
        authStatus: action.payload.authFailed
          ? (state.authStatus === 'authenticated' ? 'expired' : 'failed')
          : state.authStatus,
      };

    case 'AUTH_STATUS':
      return { ...state, authStatus: action.payload };

    case 'UI_SET_DISPLAY_MODE':
      return { ...state, ui: { ...state.ui, displayMode: action.payload } };

    case 'UI_SET_LANGUAGE':
      return { ...state, ui: { ...state.ui, language: action.payload } };

    case 'UI_SET_PAUSED':
      return { ...state, ui: { ...state.ui, isPaused: action.payload } };

    case 'SIGN_OUT':
      return {
        ...defaultState(),
        ui: state.ui, // 保留 UI 设置
      };

    default:
      return state;
  }
}

export class Store {
  private state: AppState;
  private listeners = new Set<(s: AppState) => void>();

  constructor() {
    this.state = defaultState();
  }

  dispatch(action: Action): void {
    const next = reducer(this.state, action);
    if (next !== this.state) {
      this.state = next;
      this.listeners.forEach((fn) => {
        try { fn(this.state); } catch (e) { console.error('Store listener error', e); }
      });
    }
  }

  getState(): AppState { return this.state; }

  subscribe(fn: (s: AppState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
```

---

## 6. config.ts

```typescript
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

  get effectiveLanguage(): 'en' | 'zh-CN' {
    const lang = this.language;
    if (lang === 'auto') {
      return vscode.env.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
    }
    return lang;
  }
}
```

---

## 7. i18n.ts

```typescript
export type Locale = 'en' | 'zh-CN';

export const dict: Record<Locale, Record<string, string>> = {
  en: {
    'tooltip.title': 'Kimi Code Usage',
    'tooltip.notLoggedIn': 'Sign in to see your usage data.\nRun "KimiStatusPro: Sign In" or set an API key.',
    'tooltip.authFailed': 'Authentication failed. Please sign in again.',
    'tooltip.window5h': '5h window',
    'tooltip.window7d': '7d window',
    'tooltip.resetsIn': 'resets in',
    'tooltip.table.col.used': 'Used',
    'tooltip.table.col.limit': 'Limit',
    'tooltip.table.col.remaining': 'Remaining',
    'tooltip.lastUpdate': 'Last updated:',
    'tooltip.nextUpdate': 'Next update:',
    'tooltip.stale': '(stale)',
    'tooltip.live': '(live)',
    'dashboard.title': 'Kimi Code Usage',
    'dashboard.refresh': '↻ Refresh',
    'dashboard.toggleMode': '$ / %',
    'dashboard.currentUsage': 'Current Usage',
    'dashboard.pricingSettings': 'Pricing & Settings',
    'dashboard.apiEnabled': 'API enabled',
    'dashboard.apiDisabled': 'API disabled',
  },
  'zh-CN': {
    'tooltip.title': 'Kimi Code 用量',
    'tooltip.notLoggedIn': '请登录后查看用量数据。\n运行 "KimiStatusPro: Sign In" 或设置 API Key。',
    'tooltip.authFailed': '认证失败，请重新登录。',
    'tooltip.window5h': '5h 窗口',
    'tooltip.window7d': '7d 窗口',
    'tooltip.resetsIn': '重置于',
    'tooltip.table.col.used': '已用',
    'tooltip.table.col.limit': '上限',
    'tooltip.table.col.remaining': '剩余',
    'tooltip.lastUpdate': '最后更新：',
    'tooltip.nextUpdate': '下次更新：',
    'tooltip.stale': '（过期）',
    'tooltip.live': '（实时）',
    'dashboard.title': 'Kimi Code 用量',
    'dashboard.refresh': '↻ 刷新',
    'dashboard.toggleMode': '$ / %',
    'dashboard.currentUsage': '当前用量',
    'dashboard.pricingSettings': '定价与设置',
    'dashboard.apiEnabled': 'API 已启用',
    'dashboard.apiDisabled': 'API 已禁用',
  },
};

export function makeT(locale: Locale) {
  return (key: string, ...params: Array<string | number>): string => {
    const template = dict[locale]?.[key] ?? dict['en']?.[key] ?? key;
    return params.reduce((s, p, i) => s.replace(`{${i}}`, String(p)), template);
  };
}
```

---

## 8. calc.ts

```typescript
import { QuotaData } from './types';

export interface UtilizationResult {
  weeklyPct: number;
  windowPct: number;
  weeklyUtil: number;
  windowUtil: number;
  weeklyBar: string;
  windowBar: string;
}

export function computeUtilization(quota: QuotaData | null): UtilizationResult {
  if (!quota) {
    return { weeklyPct: 0, windowPct: 0, weeklyUtil: 0, windowUtil: 0, weeklyBar: '', windowBar: '' };
  }

  const weeklyUtil = quota.weeklyLimit > 0 ? (quota.weeklyUsed / quota.weeklyLimit) : 0;
  const windowUtil = quota.windowLimit > 0 ? (quota.windowUsed / quota.windowLimit) : 0;
  const weeklyPct = Math.min(100, Math.max(0, quota.weeklyUsedPct ?? weeklyUtil * 100));
  const windowPct = Math.min(100, Math.max(0, quota.windowUsedPct ?? windowUtil * 100));

  return {
    weeklyPct,
    windowPct,
    weeklyUtil,
    windowUtil,
    weeklyBar: buildBar(weeklyUtil, 10),
    windowBar: buildBar(windowUtil, 10),
  };
}

export function buildBar(util: number, width: number): string {
  const safe = Math.max(0, Math.min(1, isFinite(util) ? util : 0));
  const filled = Math.round(safe * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export function formatPercent(pct: number, decimals = 0): string {
  const safe = isFinite(pct) ? pct : 0;
  return safe.toFixed(decimals) + '%';
}

export function fmtHours(h: number): string {
  if (h <= 0) return '0m';
  const secs = Math.round(h * 3600);
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${mins}m`;
  return `${mins}m`;
}
```

---

## 9. utils.ts

```typescript
import * as vscode from 'vscode';
import { KimiOAuthCredentials } from './types';

const SECRET_API_KEY = 'kimiStatusPro.apiKey';
const SECRET_OAUTH = 'kimiStatusPro.oauthCredentials';

let outputChannel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('KimiStatusPro');
  }
  return outputChannel;
}

export function log(message: string): void {
  const ts = new Date().toLocaleString('zh-CN', { hour12: false });
  getOutputChannel().appendLine(`[${ts}] ${message}`);
}

export async function readApiKey(secrets: vscode.SecretStorage): Promise<string | undefined> {
  return secrets.get(SECRET_API_KEY) || undefined;
}

export async function writeApiKey(secrets: vscode.SecretStorage, key: string): Promise<void> {
  await secrets.store(SECRET_API_KEY, key);
}

export async function deleteApiKey(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(SECRET_API_KEY);
}

export async function readOAuth(secrets: vscode.SecretStorage): Promise<KimiOAuthCredentials | undefined> {
  const raw = await secrets.get(SECRET_OAUTH);
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}

export async function writeOAuth(secrets: vscode.SecretStorage, creds: KimiOAuthCredentials): Promise<void> {
  await secrets.store(SECRET_OAUTH, JSON.stringify(creds));
}

export async function deleteOAuth(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(SECRET_OAUTH);
}

export function readKimiCliCredentials(): KimiOAuthCredentials | undefined {
  try {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const credPath = path.join(os.homedir(), '.kimi', 'credentials', 'kimi-code.json');
    if (!fs.existsSync(credPath)) return undefined;
    const raw = fs.readFileSync(credPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.access_token) return undefined;
    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token ?? '',
      tokenType: parsed.token_type ?? 'Bearer',
      expiresAt: Math.floor(parsed.expires_at ?? 0),
      scope: parsed.scope ?? 'kimi-code',
      deviceId: parsed.device_id ?? '',
    };
  } catch { return undefined; }
}
```

---

## 10. services/authService.ts

```typescript
import * as vscode from 'vscode';
import { KimiOAuthCredentials } from '../types';
import { readApiKey, readOAuth, writeOAuth, deleteOAuth, readKimiCliCredentials } from '../utils';

const REFRESH_THRESHOLD_SECONDS = 300;

export class AuthService {
  private static instance: AuthService;
  private secrets: vscode.SecretStorage | undefined;
  private cachedToken: string | null = null;
  private cachedAt = 0;

  static getInstance(): AuthService {
    if (!AuthService.instance) { AuthService.instance = new AuthService(); }
    return AuthService.instance;
  }

  init(secrets: vscode.SecretStorage): void {
    this.secrets = secrets;
  }

  /** 启动时调用一次，之后只在 token 失效时重新获取。缓存 60s 避免频繁读 SecretStorage。 */
  async resolveToken(): Promise<string | undefined> {
    if (!this.secrets) return undefined;
    if (this.cachedToken && Date.now() - this.cachedAt < 60_000) {
      return this.cachedToken;
    }

    let creds = await readOAuth(this.secrets);

    // Fallback 1: CLI credentials file
    if (!creds) {
      creds = readKimiCliCredentials();
      if (creds) { await writeOAuth(this.secrets, creds); }
    }

    // Fallback 2: API Key
    if (!creds) {
      const apiKey = await readApiKey(this.secrets);
      if (apiKey) {
        this.cachedToken = apiKey;
        this.cachedAt = Date.now();
        return apiKey;
      }
    }

    if (!creds) return undefined;

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (creds.expiresAt === 0 || creds.expiresAt - now > REFRESH_THRESHOLD_SECONDS) {
      this.cachedToken = creds.accessToken;
      this.cachedAt = Date.now();
      return creds.accessToken;
    }

    // Refresh token
    try {
      const refreshed = await this.refreshAccessToken(creds);
      await writeOAuth(this.secrets, refreshed);
      this.cachedToken = refreshed.accessToken;
      this.cachedAt = Date.now();
      return refreshed.accessToken;
    } catch {
      await deleteOAuth(this.secrets);
      this.invalidate();
      return undefined;
    }
  }

  invalidate(): void {
    this.cachedToken = null;
    this.cachedAt = 0;
  }

  private async refreshAccessToken(creds: KimiOAuthCredentials): Promise<KimiOAuthCredentials> {
    // OAuth refresh 实现（同旧代码）
    // POST https://auth.kimi.com/api/oauth/token
    // body: grant_type=refresh_token&refresh_token=...&client_id=...
    // 返回新 credentials
    throw new Error('Not implemented in Phase 1');
  }
}
```

---

## 11. services/apiService.ts

```typescript
import { QuotaData, ApiResponse } from '../types';

const API_BASE = 'https://api.kimi.com/v1';

export class ApiService {
  private static instance: ApiService;

  static getInstance(): ApiService {
    if (!ApiService.instance) { ApiService.instance = new ApiService(); }
    return ApiService.instance;
  }

  async fetchQuota(token: string): Promise<ApiResponse> {
    try {
      const resp = await fetch(`${API_BASE}/quota`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'KimiStatusPro-vscode',
        },
      });

      if (resp.status === 401 || resp.status === 403) {
        return { ok: false, error: `HTTP ${resp.status}`, authFailed: true };
      }
      if (!resp.ok) {
        return { ok: false, error: `HTTP ${resp.status}` };
      }

      const json = await resp.json();
      const data = this.parseResponse(json);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private parseResponse(json: any): QuotaData {
    // 根据实际 API 响应解析
    // 示例结构（需根据实际 API 调整）：
    const usage = json.usage || json.data || {};
    const limits = json.limits || [];
    const weekly = limits.find((l: any) => l.type === 'weekly') || {};
    const window = limits.find((l: any) => l.type === 'window') || {};

    return {
      weeklyLimit: toInt(weekly.limit),
      weeklyUsed: toInt(weekly.used),
      weeklyUsedPct: toInt(weekly.used_pct),
      weeklyResetAt: toMs(weekly.reset_time),
      windowLimit: toInt(window.limit),
      windowUsed: toInt(window.used),
      windowRemaining: toInt(window.remaining),
      windowUsedPct: toInt(window.used_pct),
      windowResetAt: toMs(window.reset_time),
      parallelLimit: toInt(json.parallel?.limit),
    };
  }
}

function toInt(v: any): number {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return isNaN(n) ? 0 : n;
}

function toMs(v: any): number {
  if (typeof v === 'number') return v * 1000;
  const d = new Date(v);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}
```

---

## 12. services/cacheService.ts

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { CachedData } from '../types';

const CACHE_FILE = path.join(os.homedir(), '.kimi', 'kimi-status-pro-cache-v2.json');
const SCHEMA = 'kimi-status-pro-cache-v2';
const CURRENT_VERSION = 2;

export class CacheService {
  private static instance: CacheService;

  static getInstance(): CacheService {
    if (!CacheService.instance) { CacheService.instance = new CacheService(); }
    return CacheService.instance;
  }

  async read(): Promise<CachedData | null> {
    try {
      const raw = await fs.readFile(CACHE_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.schema !== SCHEMA || parsed.version !== CURRENT_VERSION) {
        return null;
      }
      return parsed.data;
    } catch {
      return null;
    }
  }

  async write(data: CachedData): Promise<void> {
    const payload = {
      version: CURRENT_VERSION,
      schema: SCHEMA,
      writtenAt: new Date().toISOString(),
      data,
    };
    try {
      await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
      await fs.writeFile(CACHE_FILE, JSON.stringify(payload, null, 2));
    } catch {
      // ignore write errors
    }
  }

  async clear(): Promise<void> {
    try { await fs.unlink(CACHE_FILE); } catch { /* ignore */ }
  }
}
```

---

## 13. services/scheduler.ts

```typescript
import { Store } from '../store';
import { AuthService } from './authService';
import { ApiService } from './apiService';
import { CacheService } from './cacheService';
import { ConfigService } from '../config';
import { log } from '../utils';

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastLongTick = 0;
  private readonly config = ConfigService.getInstance();

  constructor(
    private store: Store,
    private authService: AuthService,
    private apiService: ApiService,
    private cacheService: CacheService,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    // 首次 100ms 后执行（让 UI 先渲染）
    this.schedule(Date.now() + 100);
  }

  stop(): void {
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  /** 用户手动刷新 */
  force(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.schedule(Date.now() + 50);
  }

  private schedule(at: number): void {
    if (!this.running) return;
    const delay = Math.max(0, at - Date.now());
    this.timer = setTimeout(() => this.tick(), delay);
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    const intervalMs = this.config.refreshIntervalSeconds * 1000;
    const now = Date.now();

    try {
      await this.doLongTick();
      this.lastLongTick = now;
    } catch (err) {
      log(`Scheduler tick error: ${err}`);
    }

    // 安排下一次
    this.schedule(this.lastLongTick + intervalMs);
  }

  private async doLongTick(): Promise<void> {
    if (this.store.getState().ui.isPaused) {
      this.store.dispatch({ type: 'INIT' }); // no-op to keep alive
      return;
    }

    const token = await this.authService.resolveToken();
    if (!token) {
      this.store.dispatch({ type: 'AUTH_STATUS', payload: 'missing' });
      return;
    }

    const result = await this.apiService.fetchQuota(token);

    if (result.ok && result.data) {
      await this.cacheService.write({
        quota: result.data,
        fetchedAt: Date.now(),
      });
      this.store.dispatch({ type: 'API_SUCCESS', payload: result.data });
    } else {
      this.store.dispatch({
        type: 'API_ERROR',
        payload: { error: result.error ?? 'Unknown error', authFailed: result.authFailed },
      });

      // 尝试回退到缓存
      const cached = await this.cacheService.read();
      if (cached) {
        this.store.dispatch({ type: 'CACHE_LOADED', payload: cached.quota });
      }
    }
  }
}
```

---

## 14. presenters/statusBar.ts

```typescript
import * as vscode from 'vscode';
import { Store } from '../store';
import { ConfigService } from '../config';
import { makeT } from '../i18n';
import { computeUtilization, formatPercent, fmtHours } from '../calc';
import { AppState } from '../types';

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
  private config = ConfigService.getInstance();

  constructor(private store: Store) {
    const alignment = vscode.StatusBarAlignment.Right;

    this.itemWeekly = vscode.window.createStatusBarItem(alignment, 104);
    this.itemWeekly.name = 'KimiStatusPro Weekly';
    this.itemWeekly.command = 'kimiStatusPro.showDashboard';
    this.itemWeekly.text = '$(sync~spin) Kimi…';
    this.itemWeekly.show();

    this.itemWindow = vscode.window.createStatusBarItem(alignment, 103);
    this.itemWindow.name = 'KimiStatusPro Window';
    this.itemWindow.command = 'kimiStatusPro.showDashboard';
    this.itemWindow.show();

    store.subscribe((state) => this.render(state));
  }

  private render(state: AppState): void {
    try {
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

      if (this.config.displayMode === 'absolute') {
        this.itemWeekly.text = `🌘 ${state.quota.weeklyUsed}/${state.quota.weeklyLimit}`;
        this.itemWindow.text = `5️⃣ ${state.quota.windowUsed}/${state.quota.windowLimit}`;
      } else {
        this.itemWeekly.text = `🌘 ${formatPercent(metrics.weeklyPct, 1)}`;
        this.itemWindow.text = `5️⃣ ${formatPercent(metrics.windowPct, 1)}`;
      }

      this.itemWeekly.color = utilizationToColor(metrics.weeklyUtil);
      this.itemWindow.color = utilizationToColor(metrics.windowUtil);
      this.itemWeekly.backgroundColor = undefined;
      this.itemWeekly.show();
      this.itemWindow.show();

      // Tooltip: lazy build on hover
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
      md.appendMarkdown(`\`\`\`text\n${t('tooltip.title')}\n─────────────────────────────\n${t('tooltip.notLoggedIn')}\n\`\`\``);
      return md;
    }

    if (state.authStatus === 'failed') {
      md.appendMarkdown(`\`\`\`text\n${t('tooltip.title')}\n─────────────────────────────\n${t('tooltip.authFailed')}\n\`\`\``);
      return md;
    }

    if (!state.quota) {
      md.appendMarkdown(`\`\`\`text\n${t('tooltip.title')}\n─────────────────────────────\nLoading…\n\`\`\``);
      return md;
    }

    const q = state.quota;
    const metrics = computeUtilization(q);
    const weeklyReset = q.weeklyResetAt > Date.now() ? fmtHours((q.weeklyResetAt - Date.now()) / 3600000) : '?';
    const windowReset = q.windowResetAt > Date.now() ? fmtHours((q.windowResetAt - Date.now()) / 3600000) : '?';

    md.appendMarkdown(`\`\`\`text\n`);
    md.appendMarkdown(`${t('tooltip.title')}${state.dataSource === 'stale' ? ' ' + t('tooltip.stale') : ''}\n`);
    md.appendMarkdown(`─────────────────────────────\n`);
    md.appendMarkdown(`${t('tooltip.window5h')}  ${formatPercent(metrics.windowPct, 2)} [${metrics.windowBar}] ${t('tooltip.resetsIn')} ${windowReset}\n`);
    md.appendMarkdown(`${t('tooltip.window7d')}  ${formatPercent(metrics.weeklyPct, 2)} [${metrics.weeklyBar}] ${t('tooltip.resetsIn')} ${weeklyReset}\n\n`);

    // Quota table
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
  }
}
```

---

## 15. presenters/dashboard.ts（Phase 1 基础版）

Phase 1 只实现最基础的功能：Header + Current Usage（进度条）+ Footer。Cost Curve、Detailed Usage、Usage History 留到 Phase 3。

```typescript
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { Store } from '../store';
import { ConfigService } from '../config';
import { makeT } from '../i18n';
import { computeUtilization, formatPercent, fmtHours } from '../calc';

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

    this.disposables.push(
      store.subscribe((state) => this.sendUpdate(state))
    );

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
      case 'toggleMode':
        const next = ConfigService.getInstance().displayMode === 'percent' ? 'absolute' : 'percent';
        ConfigService.getInstance().setDisplayMode(next);
        break;
      case 'toggleLanguage':
        const nextLang = ConfigService.getInstance().effectiveLanguage === 'zh-CN' ? 'en' : 'zh-CN';
        ConfigService.getInstance().setLanguage(nextLang);
        // WebView 会收到配置变更通知后 reload
        break;
      case 'openSettings':
        vscode.commands.executeCommand('workbench.action.openSettings', '@ext:kayuii.kimi-status-pro');
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
      <button id="btn-lang">🌐 ${isZh ? 'EN' : '中'}</button>
      <button id="btn-settings">⚙</button>
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

      document.getElementById('fill-5h').style.width = w5h + '%';
      document.getElementById('fill-5h').className = 'progress-fill' + (w5h >= 75 ? ' warning' : '');
      document.getElementById('lbl-5h').textContent = w5h.toFixed(1) + '%';

      document.getElementById('fill-7d').style.width = w7d + '%';
      document.getElementById('fill-7d').className = 'progress-fill' + (w7d >= 75 ? ' warning' : '');
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
```

---

## 16. extension.ts（入口）

```typescript
import * as vscode from 'vscode';
import { Store } from './store';
import { ConfigService } from './config';
import { AuthService } from './services/authService';
import { ApiService } from './services/apiService';
import { CacheService } from './services/cacheService';
import { Scheduler } from './services/scheduler';
import { StatusBarPresenter } from './presenters/statusBar';
import { DashboardPanel } from './presenters/dashboard';
import { log, writeApiKey, writeOAuth } from './utils';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  log('KimiStatusPro v2 activated');

  const store = new Store();
  const config = ConfigService.getInstance();
  const authService = AuthService.getInstance();
  const apiService = ApiService.getInstance();
  const cacheService = CacheService.getInstance();

  authService.init(context.secrets);

  // 1. 恢复缓存
  const cached = await cacheService.read();
  if (cached) {
    store.dispatch({ type: 'CACHE_LOADED', payload: cached.quota });
  }

  // 2. 初始化 Presenters
  const statusBar = new StatusBarPresenter(store);

  // 3. 启动定时器
  const scheduler = new Scheduler(store, authService, apiService, cacheService);
  scheduler.start();

  // 4. 注册命令
  context.subscriptions.push(
    vscode.commands.registerCommand('kimiStatusPro.refresh', () => {
      scheduler.force();
    }),
    vscode.commands.registerCommand('kimiStatusPro.signIn', () => {
      // Phase 1: 简化版，直接弹出输入框输入 API Key
      // Phase 2 再实现完整的 OAuth device flow
      promptForApiKey(context);
    }),
    vscode.commands.registerCommand('kimiStatusPro.signOut', async () => {
      await context.secrets.delete('kimiStatusPro.apiKey');
      await context.secrets.delete('kimiStatusPro.oauthCredentials');
      authService.invalidate();
      store.dispatch({ type: 'SIGN_OUT' });
    }),
    vscode.commands.registerCommand('kimiStatusPro.setApiKey', () => {
      promptForApiKey(context);
    }),
    vscode.commands.registerCommand('kimiStatusPro.showDashboard', () => {
      DashboardPanel.createOrShow(store);
    }),
  );

  // 5. 配置变更监听
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('kimiStatusPro')) {
        // 重新读取配置，触发 UI 更新
        store.dispatch({ type: 'UI_SET_DISPLAY_MODE', payload: config.displayMode });
        store.dispatch({ type: 'UI_SET_LANGUAGE', payload: config.language });
      }
    })
  );

  // 6. 清理
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
  vscode.window.showInformationMessage('API key saved.');
}
```

---

## 17. tsconfig.json

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2020",
    "lib": ["ES2020"],
    "outDir": "out",
    "rootDir": "src",
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "moduleResolution": "node",
    "resolveJsonModule": true
  },
  "exclude": ["node_modules", "out", "test"]
}
```

---

## 18. esbuild.js

```javascript
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isProduction = process.argv.includes('--production');

async function build() {
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'src', 'extension.ts')],
    bundle: true,
    outfile: path.join(__dirname, 'out', 'extension.js'),
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node16',
    sourcemap: !isProduction,
    minify: isProduction,
    tsconfig: path.join(__dirname, 'tsconfig.json'),
  });
  console.log(isProduction ? 'Production build complete.' : 'Development build complete.');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

---

## 19. 模块依赖图

```
extension.ts
  ├── store.ts
  ├── config.ts
  ├── services/
  │   ├── authService.ts  → utils.ts
  │   ├── apiService.ts   → types.ts
  │   ├── cacheService.ts
  │   └── scheduler.ts    → store, auth, api, cache, config
  ├── presenters/
  │   ├── statusBar.ts    → store, config, i18n, calc
  │   └── dashboard.ts    → store, config, i18n, calc
  └── utils.ts

i18n.ts  ← 独立，无依赖
calc.ts  ← types.ts
```

---

## 20. 数据流图

```
activate()
  → CacheService.read() → Store.dispatch(CACHE_LOADED)
  → StatusBar.subscribe(render)
  → Scheduler.start()

Scheduler.tick()
  → AuthService.resolveToken()
  → ApiService.fetchQuota()
    ├─ 成功 → CacheService.write() → Store.dispatch(API_SUCCESS)
    │          → StatusBar.render() + Dashboard.sendUpdate()
    └─ 失败 → Store.dispatch(API_ERROR)
              → CacheService.read() fallback → Store.dispatch(CACHE_LOADED)

User clicks refresh
  → Scheduler.force()
  → 立即执行 tick()

User clicks signOut
  → secrets.delete() → AuthService.invalidate()
  → Store.dispatch(SIGN_OUT)
  → StatusBar.render() (show "sign in")
```

---

## 21. 关键实现决策

| 决策 | 选择 | 理由 |
|---|---|---|
| Store 模式 | 自定义轻量 Store（非 Redux） | 避免依赖，代码 < 100 行 |
| Service 单例 | 静态 `getInstance()` | 确保数据同步，避免重复读取 |
| 定时器 | `setTimeout` 链（非 setInterval） | 天然防重叠，无需 isRefreshing 锁 |
| i18n | 简单对象字典（非 gettext/i18next） | 避免依赖，代码 < 50 行 |
| Tooltip | MarkdownString 内联构建 | VS Code 原生支持，无需 webview |
| Dashboard | WebView + 内联 HTML/JS | Phase 1 极简，Phase 3 再扩展 |
| 认证 | API Key 为主，OAuth 为扩展 | Phase 1 先实现 API Key，OAuth 后续补充 |
| 缓存 | JSON 文件（非 SQLite） | 简单、可手动查看、跨平台 |

---

## 22. 测试要点

| 测试项 | 方法 |
|---|---|
| Store reducer | 单元测试：dispatch 各种 action，验证 state 变化 |
| calc.ts | 单元测试：computeUtilization、buildBar、fmtHours |
| CacheService | 单元测试：write → read 往返，版本不匹配返回 null |
| Scheduler | 集成测试：mock ApiService，验证 tick → dispatch 流程 |
| StatusBar | 集成测试：mock Store，验证 subscribe → render |
| AuthService | 单元测试：resolveToken 缓存、invalidate、fallback |

---

## 23. 待确认事项

1. **API 响应格式**：`apiService.parseResponse` 中的字段映射需要根据实际 Kimi API 响应调整。当前使用占位结构。
2. **OAuth refresh**：`authService.refreshAccessToken` 在 Phase 1 中标记为 "Not implemented"，是否需要在 Phase 1 实现？
3. **定价配置**：Phase 1 是否需要配置项 `pricing.inputPerMillion` 等？（Phase 2 本地估算时才需要）
4. **状态栏对齐**：`Left` 还是 `Right`？默认 `Right`。
5. **扩展图标**：沿用旧工程的 `img/logo.png`？

---

*文档结束。AI 加载本文档后，应按文件结构逐一实现各模块代码。*
