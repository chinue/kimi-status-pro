// 🔀 Provider boundary: API format is Kimi-specific.
// AGENTS: err->try-catch | network-fallback
// If adapting to another provider, replace this module.

// DESIGN: v2-provider-abstraction.md
import fetch from 'node-fetch';
import { QuotaData, ApiResponse } from '../types';

const API_URL = 'https://api.kimi.com/coding/v1/usages';

export class ApiService {
  private static instance: ApiService;

  static getInstance(): ApiService {
    if (!ApiService.instance) { ApiService.instance = new ApiService(); }
    return ApiService.instance;
  }

  async fetchQuota(token: string): Promise<ApiResponse> {
    try {
      const resp = await fetch(API_URL, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'KimiCLI/1.6',
          'Accept': 'application/json',
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
      const msg = (err as Error).message;
      const isNetwork = /fetch|network|ECONN|ENOTFOUND|ETIMEDOUT/i.test(msg);
      return { ok: false, error: msg, networkError: isNetwork };
    }
  }

  private parseResponse(json: any): QuotaData {
    // Mirrors the official Kimi API shape:
    //   json.usage          -> weekly quota
    //   json.limits[0].detail -> window quota
    const usage = json.usage ?? {};
    const win = json.limits?.[0]?.detail ?? {};

    const weeklyLimit = toInt(usage.limit);
    const weeklyUsed = toInt(usage.used);
    const windowLimit = toInt(win.limit);
    const windowUsed = toInt(win.used);

    return {
      weeklyLimit,
      weeklyUsed,
      weeklyUsedPct: pctOrCompute(usage.used_pct, weeklyUsed, weeklyLimit),
      weeklyResetAt: toMs(usage.resetTime),
      windowLimit,
      windowUsed,
      windowRemaining: toInt(win.remaining),
      windowUsedPct: pctOrCompute(win.used_pct, windowUsed, windowLimit),
      windowResetAt: toMs(win.resetTime),
      parallelLimit: toInt(json.parallel?.limit),
    };
  }
}

function toInt(v: any): number {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return isNaN(n) ? 0 : n;
}

function pctOrCompute(pct: any, used: number, limit: number): number {
  if (typeof pct === 'number' && !isNaN(pct)) return Math.min(100, Math.max(0, pct));
  if (typeof pct === 'string') {
    const n = parseFloat(pct);
    if (!isNaN(n)) return Math.min(100, Math.max(0, n));
  }
  if (limit > 0) return Math.min(100, Math.max(0, (used / limit) * 100));
  return 0;
}

function toMs(v: any): number {
  if (typeof v === 'number') {
    // Treat as seconds if it's small enough, otherwise milliseconds
    return v < 1e12 ? v * 1000 : v;
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }
  return 0;
}
