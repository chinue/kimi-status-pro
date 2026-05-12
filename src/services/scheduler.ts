// DESIGN: v2-phase2-implementation.md#servicesschedulerts
// 💠 Generic: scheduler logic is provider-agnostic.

import { Store } from '../store';
import { AuthService } from './authService';
import { ApiService } from './apiService';
import { CacheService } from './cacheService';
import { LocalUsageService } from './localUsageService';
import { ConfigService } from '../config';
import { log } from '../utils';
import {
  calibrateTokenCapacity,
  calibrateWindowCostCapacity,
  estimateWeeklyPct,
  estimateWindowPct,
  fallbackWeeklyPct,
  fallbackWindowPct,
  isCalibrationValid,
} from '../calc';

const LONG_MS = 60_000;

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
    private localUsageService: LocalUsageService,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    // Ensure first tick is a long tick so we fetch API data immediately
    this.lastLongTick = Date.now() - LONG_MS;
    // First tick immediately (fetch API data as soon as possible)
    this.schedule(Date.now());
  }

  stop(): void {
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  /** Manual refresh: force a long tick (API fetch) immediately. */
  force(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    // Reset lastLongTick so the next tick is guaranteed to be a long tick
    this.lastLongTick = Date.now() - LONG_MS;
    this.schedule(Date.now() + 50);
  }

  private schedule(at: number): void {
    if (!this.running) return;
    const delay = Math.max(0, at - Date.now());
    this.timer = setTimeout(() => this.tick(), delay);
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    const now = Date.now();
    const isLong = now - this.lastLongTick >= LONG_MS;

    try {
      if (isLong) {
        await this.doLongTick();
        this.lastLongTick = now;
      } else {
        await this.doShortTick();
      }
    } catch (err) {
      log(`Scheduler tick error: ${err}`);
    }

    // Schedule next tick: whichever comes first (short or long)
    const nextLong = this.lastLongTick + LONG_MS;
    const nextShort = now + this.config.shortRefreshIntervalSeconds * 1000;
    this.schedule(Math.min(nextLong, nextShort));
  }

  private async doShortTick(): Promise<void> {
    if (this.store.getState().ui.isPaused) {
      return;
    }

    const state = this.store.getState();
    const quota = state.quota;

    const localUsage = await this.localUsageService.getLocalUsage({
      weeklyResetAtMs: quota?.weeklyResetAt,
      windowResetAtMs: quota?.windowResetAt,
      dataRetentionDays: this.config.dataRetentionDays,
    });

    const calibration = state.localEstimate
      ? {
          tokenCapacity: state.localEstimate.tokenCapacity,
          windowCostCapacity: state.localEstimate.windowCostCapacity,
          calibratedAt: state.localEstimate.calibratedAt ?? 0,
          resetAt: quota?.weeklyResetAt ?? 0,
        }
      : null;

    const tokenCapacity = isCalibrationValid(calibration, quota?.weeklyResetAt ?? null)
      ? calibration!.tokenCapacity
      : null;
    const windowCostCapacity = isCalibrationValid(
      calibration ? { ...calibration, resetAt: quota?.windowResetAt ?? 0 } : null,
      quota?.windowResetAt ?? null,
    )
      ? calibration!.windowCostCapacity
      : null;

    const weeklyPct = estimateWeeklyPct(localUsage.tokensThisCycle, tokenCapacity)
      ?? fallbackWeeklyPct(localUsage.tokensThisCycle, quota?.weeklyLimit ?? null);
    const windowPct = estimateWindowPct(localUsage.cost5h, windowCostCapacity)
      ?? fallbackWindowPct(localUsage.cost5h, quota?.windowLimit ?? null);

    this.store.dispatch({
      type: 'LOCAL_ESTIMATE',
      payload: {
        weeklyPct,
        windowPct,
        cost5h: localUsage.cost5h,
        cost7d: localUsage.cost7d,
        costToday: localUsage.costToday,
        // Full detail for tooltip / dashboard (from memory, no disk access)
        requestsToday: localUsage.requestsToday,
        tokensToday: localUsage.tokensToday,
        tokensIn5h: localUsage.tokensIn5h,
        tokensOut5h: localUsage.tokensOut5h,
        tokensCacheRead5h: localUsage.tokensCacheRead5h,
        tokensCacheCreate5h: localUsage.tokensCacheCreate5h,
        requests5h: localUsage.requests5h,
        tokensIn7d: localUsage.tokensIn7d,
        tokensOut7d: localUsage.tokensOut7d,
        tokensCacheRead7d: localUsage.tokensCacheRead7d,
        tokensCacheCreate7d: localUsage.tokensCacheCreate7d,
        requests7d: localUsage.requests7d,
        tokensThisCycle: localUsage.tokensThisCycle,
        costThisCycle: localUsage.costThisCycle,
        requestsThisCycle: localUsage.requestsThisCycle,
      },
    });
  }

  private async doLongTick(): Promise<void> {
    if (this.store.getState().ui.isPaused) {
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
      const apiData = result.data;

      const localUsage = await this.localUsageService.getLocalUsage({
        weeklyResetAtMs: apiData.weeklyResetAt,
        windowResetAtMs: apiData.windowResetAt,
        dataRetentionDays: this.config.dataRetentionDays,
      });

      // Calibrate
      const tokenCapacity = calibrateTokenCapacity(apiData.weeklyUsedPct, localUsage.tokensThisCycle);
      const windowCostCapacity = calibrateWindowCostCapacity(apiData.windowUsedPct, localUsage.cost5h);

      // Write cache with calibration
      await this.cacheService.write({
        quota: apiData,
        fetchedAt: Date.now(),
        calibration: {
          tokenCapacity,
          windowCostCapacity,
          calibratedAt: Date.now(),
          reset5hAt: apiData.windowResetAt,
          reset7dAt: apiData.weeklyResetAt,
        },
      });

      // 百分数平稳化：若本地估算值四舍五入后的整数与 API 返回的整数一致，
      // 则保留更精细的本地估算值，避免每次 API 刷新都跳回整数造成视觉跳动
      const currentEstimate = this.store.getState().localEstimate;
      let weeklyPct = apiData.weeklyUsedPct;
      let windowPct = apiData.windowUsedPct;
      if (currentEstimate) {
        if (Math.round(currentEstimate.weeklyPct) === apiData.weeklyUsedPct) {
          weeklyPct = currentEstimate.weeklyPct;
        }
        if (Math.round(currentEstimate.windowPct) === apiData.windowUsedPct) {
          windowPct = currentEstimate.windowPct;
        }
      }

      this.store.dispatch({ type: 'API_SUCCESS', payload: apiData });
      this.store.dispatch({
        type: 'LOCAL_ESTIMATE',
        payload: {
          weeklyPct,
          windowPct,
          tokenCapacity,
          windowCostCapacity,
          calibratedAt: Date.now(),
          cost5h: localUsage.cost5h,
          cost7d: localUsage.cost7d,
          costToday: localUsage.costToday,
          // Full detail for tooltip / dashboard (from memory, no disk access)
          requestsToday: localUsage.requestsToday,
          tokensToday: localUsage.tokensToday,
          tokensIn5h: localUsage.tokensIn5h,
          tokensOut5h: localUsage.tokensOut5h,
          tokensCacheRead5h: localUsage.tokensCacheRead5h,
          tokensCacheCreate5h: localUsage.tokensCacheCreate5h,
          requests5h: localUsage.requests5h,
          tokensIn7d: localUsage.tokensIn7d,
          tokensOut7d: localUsage.tokensOut7d,
          tokensCacheRead7d: localUsage.tokensCacheRead7d,
          tokensCacheCreate7d: localUsage.tokensCacheCreate7d,
          requests7d: localUsage.requests7d,
          tokensThisCycle: localUsage.tokensThisCycle,
          costThisCycle: localUsage.costThisCycle,
          requestsThisCycle: localUsage.requestsThisCycle,
        },
      });
    } else {
      this.store.dispatch({
        type: 'API_ERROR',
        payload: { error: result.error ?? 'Unknown error', authFailed: result.authFailed, networkError: result.networkError },
      });

      // Fallback to cache
      const cached = await this.cacheService.read();
      if (cached) {
        this.store.dispatch({ type: 'CACHE_LOADED', payload: cached.quota });
        // Restore calibration if valid
        if (cached.calibration) {
          this.store.dispatch({
            type: 'LOCAL_ESTIMATE',
            payload: {
              tokenCapacity: cached.calibration.tokenCapacity,
              windowCostCapacity: cached.calibration.windowCostCapacity,
              calibratedAt: cached.calibration.calibratedAt,
            },
          });
        }
      }
    }

    this.store.dispatch({ type: 'LOADING_END' });
  }
}
