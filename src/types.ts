// DESIGN: v2-phase2-implementation.md#typests
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
export type DataSource = 'api' | 'cache' | 'stale' | 'no-credentials' | 'no-data' | 'local-only';
export type DisplayMode = 'percent' | 'absolute';
export type LanguageSetting = 'auto' | 'en' | 'zh-CN';

export interface TokenPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  cacheCreatePerMillion: number;
}

export interface LocalEstimate {
  weeklyPct: number;
  windowPct: number;
  tokenCapacity: number | null;
  windowCostCapacity: number | null;
  calibratedAt: number | null;
  cost5h: number;
  cost7d: number;
  costToday: number;
  // Detailed usage for tooltip / dashboard display (from memory, not disk)
  requestsToday: number;
  tokensToday: number;
  tokensIn5h: number;
  tokensOut5h: number;
  tokensCacheRead5h: number;
  tokensCacheCreate5h: number;
  requests5h: number;
  tokensIn7d: number;
  tokensOut7d: number;
  tokensCacheRead7d: number;
  tokensCacheCreate7d: number;
  requests7d: number;
  tokensThisCycle: number;
  costThisCycle: number;
  requestsThisCycle: number;
}

export interface CalibrationData {
  tokenCapacity: number | null;
  windowCostCapacity: number | null;
  calibratedAt: number;
  reset5hAt: number;
  reset7dAt: number;
}

export interface AppState {
  quota: QuotaData | null;
  lastFetchAt: number | null;
  lastSuccessfulFetchAt: number | null;
  error: string | null;
  authStatus: AuthStatus;
  dataSource: DataSource;
  isLoading: boolean;
  localEstimate: LocalEstimate | null;
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
  networkError?: boolean;
}

export interface CachedData {
  quota: QuotaData;
  fetchedAt: number;
  calibration?: CalibrationData;
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
  | { type: 'API_ERROR'; payload: { error: string; authFailed?: boolean; networkError?: boolean } }
  | { type: 'LOCAL_ESTIMATE'; payload: Partial<LocalEstimate> }
  | { type: 'AUTH_STATUS'; payload: AuthStatus }
  | { type: 'UI_SET_DISPLAY_MODE'; payload: DisplayMode }
  | { type: 'UI_SET_LANGUAGE'; payload: LanguageSetting }
  | { type: 'UI_SET_PAUSED'; payload: boolean }
  | { type: 'LOADING_START' }
  | { type: 'LOADING_END' }
  | { type: 'SIGN_OUT' };
