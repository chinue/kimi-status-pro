import { AppState, Action, AuthStatus } from './types';

export const defaultState = (): AppState => ({
  quota: null,
  lastFetchAt: null,
  lastSuccessfulFetchAt: null,
  error: null,
  authStatus: 'unknown',
  dataSource: 'no-data',
  isLoading: false,
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
        lastFetchAt: action.payload.weeklyResetAt,
        dataSource: 'cache',
        error: null,
      };

    case 'API_SUCCESS': {
      const now = Date.now();
      return {
        ...state,
        quota: action.payload,
        lastFetchAt: now,
        lastSuccessfulFetchAt: now,
        dataSource: 'api',
        error: null,
        authStatus: state.authStatus === 'missing' ? 'authenticated' : state.authStatus,
        isLoading: false,
      };
    }

    case 'API_ERROR':
      return {
        ...state,
        error: action.payload.error,
        isLoading: false,
        authStatus: action.payload.authFailed
          ? (state.authStatus === 'authenticated' ? 'expired' : 'failed')
          : state.authStatus,
      };

    case 'LOCAL_ESTIMATE':
      // Phase 2: integrate local estimate into state
      return state;

    case 'AUTH_STATUS':
      return { ...state, authStatus: action.payload };

    case 'UI_SET_DISPLAY_MODE':
      return { ...state, ui: { ...state.ui, displayMode: action.payload } };

    case 'UI_SET_LANGUAGE':
      return { ...state, ui: { ...state.ui, language: action.payload } };

    case 'UI_SET_PAUSED':
      return { ...state, ui: { ...state.ui, isPaused: action.payload } };

    case 'LOADING_START':
      return { ...state, isLoading: true };

    case 'LOADING_END':
      return { ...state, isLoading: false };

    case 'SIGN_OUT':
      return {
        ...defaultState(),
        ui: state.ui,
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
