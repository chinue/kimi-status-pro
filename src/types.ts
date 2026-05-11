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

export interface AppState {
  quota: QuotaData | null;
  lastFetchAt: number | null;
  lastSuccessfulFetchAt: number | null;
  error: string | null;
  authStatus: AuthStatus;
  dataSource: DataSource;
  isLoading: boolean;
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
  | { type: 'LOCAL_ESTIMATE'; payload: { weeklyPct: number; windowPct: number } }
  | { type: 'AUTH_STATUS'; payload: AuthStatus }
  | { type: 'UI_SET_DISPLAY_MODE'; payload: DisplayMode }
  | { type: 'UI_SET_LANGUAGE'; payload: LanguageSetting }
  | { type: 'UI_SET_PAUSED'; payload: boolean }
  | { type: 'LOADING_START' }
  | { type: 'LOADING_END' }
  | { type: 'SIGN_OUT' };
