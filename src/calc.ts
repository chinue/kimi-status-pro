import { QuotaData, TokenPricing } from './types';

export interface UtilizationResult {
  weeklyPct: number;
  windowPct: number;
  weeklyUtil: number;
  windowUtil: number;
  weeklyBar: string;
  windowBar: string;
  weeklyMiniBar: string;
  windowMiniBar: string;
}

export function computeUtilization(quota: QuotaData | null): UtilizationResult {
  if (!quota) {
    return { weeklyPct: 0, windowPct: 0, weeklyUtil: 0, windowUtil: 0, weeklyBar: '', windowBar: '', weeklyMiniBar: '', windowMiniBar: '' };
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
    weeklyMiniBar: buildMiniBar(weeklyUtil, 5),
    windowMiniBar: buildMiniBar(windowUtil, 5),
  };
}

export function buildBar(util: number, width: number): string {
  const safe = Math.max(0, Math.min(1, isFinite(util) ? util : 0));
  const filled = Math.round(safe * width);
  return '\u25B0'.repeat(filled) + '\u25B1'.repeat(width - filled);
}

export function buildMiniBar(util: number, width = 5): string {
  return buildBar(util, width);
}

export function formatPercent(pct: number, decimals = 0): string {
  const safe = isFinite(pct) ? pct : 0;
  return safe.toFixed(decimals) + '%';
}

/** Format a percentage with fixed-width padding like C's %5.2f.
 *  Default width 5 (for 2 decimals: e.g. '12.34') plus '%' suffix.
 */
export function formatPercentPadded(pct: number, decimals = 2): string {
  if (!isFinite(pct)) pct = 0;
  const numStr = pct.toFixed(decimals).padStart(5, ' ');
  return numStr + '%';
}

export function fmtDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return ' 0s';
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const pad2 = (n: number) => String(n).padStart(2, ' ');
  if (days > 0) return `${pad2(days)}d${pad2(hours)}h`;
  if (hours > 0) return `${pad2(hours)}h${pad2(mins)}m`;
  if (mins > 0) return `${pad2(mins)}m${pad2(secs)}s`;
  return `${pad2(secs)}s`;
}

export function fmtHours(h: number): string {
  return fmtDuration(Math.round(h * 3600));
}

export interface TokenUsage {
  inputOther: number;
  output: number;
  inputCacheRead: number;
  inputCacheCreation: number;
}

export function calculateCost(usage: TokenUsage, pricing: TokenPricing): number {
  const cost = (
    (usage.inputOther / 1_000_000) * pricing.inputPerMillion +
    (usage.output / 1_000_000) * pricing.outputPerMillion +
    (usage.inputCacheRead / 1_000_000) * pricing.cacheReadPerMillion +
    (usage.inputCacheCreation / 1_000_000) * pricing.cacheCreatePerMillion
  );
  return isFinite(cost) && cost >= 0 ? cost : 0;
}
