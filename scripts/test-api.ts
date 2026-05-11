// Manual API check script — run with your own token to verify parseResponse.
// Usage:
//   npx ts-node scripts/test-api.ts <token>
//   npx ts-node scripts/test-api.ts          (auto-reads ~/.kimi/credentials/kimi-code.json)

import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const API_URL = 'https://api.kimi.com/coding/v1/usages';

function readCliToken(): string | undefined {
  try {
    const credPath = path.join(os.homedir(), '.kimi', 'credentials', 'kimi-code.json');
    const raw = fs.readFileSync(credPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed.access_token;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const token = process.argv[2] || readCliToken();
  if (!token) {
    console.error('No token provided. Usage: npx ts-node scripts/test-api.ts <token>');
    process.exit(1);
  }

  console.log('Fetching usages from Kimi API...\n');

  const resp = await fetch(API_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'KimiCLI/1.6',
      Accept: 'application/json',
    },
  });

  console.log('HTTP Status:', resp.status);

  if (!resp.ok) {
    const body = await resp.text();
    console.error('Error body:', body.slice(0, 500));
    process.exit(1);
  }

  const json = await resp.json();
  console.log('\n--- Raw JSON response ---');
  console.log(JSON.stringify(json, null, 2));

  // Inline parseResponse logic for quick validation
  function toInt(v: any): number {
    const n = typeof v === 'number' ? v : parseInt(String(v), 10);
    return isNaN(n) ? 0 : n;
  }

  function toMs(v: any): number {
    if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
    if (typeof v === 'string') {
      const d = new Date(v);
      return isNaN(d.getTime()) ? 0 : d.getTime();
    }
    return 0;
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

  const usage = json.usage ?? {};
  const win = json.limits?.[0]?.detail ?? {};

  const weeklyLimit = toInt(usage.limit);
  const weeklyUsed = toInt(usage.used);
  const windowLimit = toInt(win.limit);
  const windowUsed = toInt(win.used);

  const parsed = {
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

  console.log('\n--- Parsed QuotaData ---');
  console.log(JSON.stringify(parsed, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
