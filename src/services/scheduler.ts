// 💠 Generic: scheduler logic is provider-agnostic.

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
    // First tick after 100ms (let UI render first)
    this.schedule(Date.now() + 100);
  }

  stop(): void {
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  /** Manual refresh: cancel current wait and execute immediately. */
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

    // Schedule next tick
    this.schedule(this.lastLongTick + intervalMs);
  }

  private async doLongTick(): Promise<void> {
    if (this.store.getState().ui.isPaused) {
      this.store.dispatch({ type: 'INIT' }); // no-op to keep alive
      return;
    }

    this.store.dispatch({ type: 'LOADING_START' });

    const token = await this.authService.resolveToken();
    if (!token) {
      this.store.dispatch({ type: 'AUTH_STATUS', payload: 'missing' });
      this.store.dispatch({ type: 'LOADING_END' });
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
        payload: { error: result.error ?? 'Unknown error', authFailed: result.authFailed, networkError: result.networkError },
      });

      // Fallback to cache
      const cached = await this.cacheService.read();
      if (cached) {
        this.store.dispatch({ type: 'CACHE_LOADED', payload: cached.quota });
      }
    }
  }
}
