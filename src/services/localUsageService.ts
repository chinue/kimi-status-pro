// 🔀 Provider boundary: JSONL path and format are Kimi-specific.
// Phase 1: incremental scanning framework only. Full implementation in Phase 2.

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { TokenPricing } from '../types';
import { calculateCost, TokenUsage } from '../calc';

const SESSIONS_DIR = path.join(os.homedir(), '.kimi', 'sessions');

export interface LocalAggregatedUsage {
  tokensToday: number;
  costToday: number;
  requestsToday: number;
  tokensIn24h: number;
  tokensOut24h: number;
  tokensCacheRead24h: number;
  tokensCacheCreate24h: number;
  cost24h: number;
  requests24h: number;
  tokensIn7d: number;
  tokensOut7d: number;
  tokensCacheRead7d: number;
  tokensCacheCreate7d: number;
  cost7d: number;
  requests7d: number;
  cost5h: number;
  tokensThisCycle: number;
  costThisCycle: number;
  requestsThisCycle: number;
}

export class LocalUsageService {
  private static instance: LocalUsageService;
  private cache: LocalAggregatedUsage | null = null;
  private cacheAt = 0;
  private readonly CACHE_TTL_MS = 30_000;

  static getInstance(): LocalUsageService {
    if (!LocalUsageService.instance) { LocalUsageService.instance = new LocalUsageService(); }
    return LocalUsageService.instance;
  }

  /** Phase 1 placeholder: returns empty aggregation. Phase 2 will implement full scan. */
  async getLocalUsage(_opts?: {
    cycleStartMs?: number;
    weeklyResetAtMs?: number;
    windowResetAtMs?: number;
  }): Promise<LocalAggregatedUsage> {
    if (this.cache && Date.now() - this.cacheAt < this.CACHE_TTL_MS) {
      return this.cache;
    }
    this.cache = await this.scanAllFiles(_opts);
    this.cacheAt = Date.now();
    return this.cache;
  }

  invalidate(): void {
    this.cache = null;
    this.cacheAt = 0;
  }

  private async scanAllFiles(_opts?: {
    cycleStartMs?: number;
    weeklyResetAtMs?: number;
    windowResetAtMs?: number;
  }): Promise<LocalAggregatedUsage> {
    const empty: LocalAggregatedUsage = {
      tokensToday: 0, costToday: 0, requestsToday: 0,
      tokensIn24h: 0, tokensOut24h: 0, tokensCacheRead24h: 0, tokensCacheCreate24h: 0,
      cost24h: 0, requests24h: 0,
      tokensIn7d: 0, tokensOut7d: 0, tokensCacheRead7d: 0, tokensCacheCreate7d: 0,
      cost7d: 0, requests7d: 0,
      cost5h: 0,
      tokensThisCycle: 0, costThisCycle: 0, requestsThisCycle: 0,
    };

    try {
      await fs.access(SESSIONS_DIR);
    } catch {
      return empty;
    }

    // Phase 2: enumerate wire.jsonl files, parse StatusUpdate entries, aggregate.
    // Phase 1 returns empty to keep the interface stable.
    return empty;
  }
}

/** Default pricing for kimi-k2.6 (RMB). */
export const DEFAULT_PRICING: TokenPricing = {
  inputPerMillion: 6.50,
  outputPerMillion: 27.00,
  cacheReadPerMillion: 1.10,
  cacheCreatePerMillion: 6.50,
};
