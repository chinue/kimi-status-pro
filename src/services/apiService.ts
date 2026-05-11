// 🔀 Provider boundary: API format is Kimi-specific.
// If adapting to another provider, replace this module.

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
      const resp = await (globalThis as any).fetch(API_URL, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'KimiStatusPro-vscode',
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
    // Normalize various possible response shapes from Kimi API.
    const usage = json.usage ?? json.data ?? json ?? {};
    const limits = json.limits ?? [];
    const weekly = limits.find((l: any) => l.type === 'weekly') ?? {};
    const window = limits.find((l: any) => l.type === 'window') ?? {};

    return {
      weeklyLimit: toInt(weekly.limit ?? usage.weekly_limit),
      weeklyUsed: toInt(weekly.used ?? usage.weekly_used),
      weeklyUsedPct: toInt(weekly.used_pct ?? usage.weekly_used_pct),
      weeklyResetAt: toMs(weekly.reset_time ?? usage.weekly_reset_at),
      windowLimit: toInt(window.limit ?? usage.window_limit),
      windowUsed: toInt(window.used ?? usage.window_used),
      windowRemaining: toInt(window.remaining ?? usage.window_remaining),
      windowUsedPct: toInt(window.used_pct ?? usage.window_used_pct),
      windowResetAt: toMs(window.reset_time ?? usage.window_reset_at),
      parallelLimit: toInt(json.parallel?.limit ?? usage.parallel_limit),
    };
  }
}

function toInt(v: any): number {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return isNaN(n) ? 0 : n;
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
