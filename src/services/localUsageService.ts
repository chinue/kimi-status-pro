// DESIGN: v2-local-estimation-design.md
// AGENTS: err->try-catch | retention->dataRetentionDays | disk-OK
// 🔀 Provider boundary: JSONL path and format are Kimi-specific.

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { TokenPricing, UsageEntry } from '../types';
import { calculateCost, TokenUsage } from '../calc';
import { log } from '../utils';

const SESSIONS_DIR = path.join(os.homedir(), '.kimi', 'sessions');

export interface LocalAggregatedUsage {
  tokensToday: number;
  costToday: number;
  requestsToday: number;
  tokensIn5h: number;
  tokensOut5h: number;
  tokensCacheRead5h: number;
  tokensCacheCreate5h: number;
  requests5h: number;
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
  entries: UsageEntry[];
}

interface FileState {
  mtimeMs: number;
  size: number;
  entries: UsageEntry[];
}

export class LocalUsageService {
  private static instance: LocalUsageService;
  private fileStates = new Map<string, FileState>();
  private aggregate: LocalAggregatedUsage | null = null;

  static getInstance(): LocalUsageService {
    if (!LocalUsageService.instance) { LocalUsageService.instance = new LocalUsageService(); }
    return LocalUsageService.instance;
  }

  async getLocalUsage(opts?: {
    cycleStartMs?: number;
    weeklyResetAtMs?: number;
    windowResetAtMs?: number;
    dataRetentionDays?: number;
    force?: boolean;
  }): Promise<LocalAggregatedUsage> {
    // Incremental scan: no TTL cache. Always check mtime/size.
    this.aggregate = await this.scanAllFiles(opts);
    return this.aggregate;
  }

  invalidate(): void {
    this.fileStates.clear();
    this.aggregate = null;
  }

  private async scanAllFiles(opts?: {
    cycleStartMs?: number;
    weeklyResetAtMs?: number;
    windowResetAtMs?: number;
    dataRetentionDays?: number;
  }): Promise<LocalAggregatedUsage> {
    const empty: LocalAggregatedUsage = {
      tokensToday: 0, costToday: 0, requestsToday: 0,
      tokensIn5h: 0, tokensOut5h: 0, tokensCacheRead5h: 0, tokensCacheCreate5h: 0,
      requests5h: 0,
      tokensIn7d: 0, tokensOut7d: 0, tokensCacheRead7d: 0, tokensCacheCreate7d: 0,
      cost7d: 0, requests7d: 0,
      cost5h: 0,
      tokensThisCycle: 0, costThisCycle: 0, requestsThisCycle: 0,
      entries: [],
    };

    try {
      await fs.access(SESSIONS_DIR);
    } catch {
      return empty;
    }

    const files = await this.enumerateWireJsonl(SESSIONS_DIR);

    // Remove stale fileStates for deleted files
    const currentFiles = new Set(files);
    for (const [fp] of this.fileStates) {
      if (!currentFiles.has(fp)) {
        this.fileStates.delete(fp);
      }
    }

    const now = Date.now();
    const retentionDays = opts?.dataRetentionDays ?? 365;
    const retentionStart = now - retentionDays * 24 * 3600 * 1000;
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const day24hAgo = now - 24 * 3600 * 1000;
    const window5hStart = opts?.windowResetAtMs ? opts.windowResetAtMs - 5 * 3600 * 1000 : day24hAgo;
    const window7dStart = opts?.weeklyResetAtMs ? opts.weeklyResetAtMs - 7 * 24 * 3600 * 1000 : now - 7 * 24 * 3600 * 1000;
    const cycleStart = opts?.cycleStartMs ?? window7dStart;

    const entries: UsageEntry[] = [];
    const seenMessageIds = new Set<string>();

    for (const filePath of files) {
      const fileState = await this.updateFileState(filePath);
      for (const entry of fileState.entries) {
        // Deduplicate by messageId (local to this scan)
        if (entry.messageId) {
          if (seenMessageIds.has(entry.messageId)) continue;
          seenMessageIds.add(entry.messageId);
        }

        // Discard entries older than retention period
        if (entry.timestamp < retentionStart) continue;

        entries.push(entry);

        // Aggregate by time windows
        const ts = entry.timestamp;
        if (ts >= todayStart) {
          empty.tokensToday += entry.inputOther + entry.output + entry.inputCacheRead + entry.inputCacheCreation;
          empty.costToday += entry.cost;
          empty.requestsToday++;
        }
        if (ts >= window5hStart) {
          empty.tokensIn5h += entry.inputOther;
          empty.tokensOut5h += entry.output;
          empty.tokensCacheRead5h += entry.inputCacheRead;
          empty.tokensCacheCreate5h += entry.inputCacheCreation;
          empty.cost5h += entry.cost;
          empty.requests5h++;
        }
        if (ts >= window7dStart) {
          empty.tokensIn7d += entry.inputOther;
          empty.tokensOut7d += entry.output;
          empty.tokensCacheRead7d += entry.inputCacheRead;
          empty.tokensCacheCreate7d += entry.inputCacheCreation;
          empty.cost7d += entry.cost;
          empty.requests7d++;
        }
        if (ts >= cycleStart) {
          empty.tokensThisCycle += entry.inputOther + entry.output + entry.inputCacheRead + entry.inputCacheCreation;
          empty.costThisCycle += entry.cost;
          empty.requestsThisCycle++;
        }
      }
    }

    empty.entries = entries;
    return empty;
  }

  private async updateFileState(filePath: string): Promise<FileState> {
    const existing = this.fileStates.get(filePath);

    let stat: { mtimeMs: number; size: number };
    try {
      const s = await fs.stat(filePath);
      stat = { mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      return existing ?? { mtimeMs: 0, size: 0, entries: [] };
    }

    if (existing && existing.mtimeMs === stat.mtimeMs && existing.size === stat.size) {
      return existing;
    }

    // File changed or new: read entire file (data is small; simplicity over micro-optimisation)
    let text: string;
    try {
      text = await fs.readFile(filePath, 'utf-8');
    } catch {
      return existing ?? { mtimeMs: stat.mtimeMs, size: stat.size, entries: [] };
    }

    const newEntries = this.parseText(text);



    const fileState: FileState = { mtimeMs: stat.mtimeMs, size: stat.size, entries: newEntries };
    this.fileStates.set(filePath, fileState);
    return fileState;
  }

  private parseText(text: string): UsageEntry[] {
    const entries: UsageEntry[] = [];
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      const entry = this.parseLine(line);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  private async enumerateWireJsonl(dir: string): Promise<string[]> {
    const results: string[] = [];
    try {
      const sessionDirs = await fs.readdir(dir, { withFileTypes: true });
      for (const sessionDir of sessionDirs) {
        if (!sessionDir.isDirectory()) continue;
        const sessionPath = path.join(dir, sessionDir.name);
        try {
          const convDirs = await fs.readdir(sessionPath, { withFileTypes: true });
          for (const convDir of convDirs) {
            if (!convDir.isDirectory()) continue;
            const wirePath = path.join(sessionPath, convDir.name, 'wire.jsonl');
            try {
              await fs.access(wirePath);
              results.push(wirePath);
            } catch { /* ignore missing */ }
          }
        } catch { /* ignore unreadable session dir */ }
      }
    } catch { /* ignore */ }
    return results;
  }

  private parseLine(line: string): UsageEntry | null {
    try {
      const json = JSON.parse(line);
      if (json.message?.type !== 'StatusUpdate') return null;
      const payload = json.message.payload;
      if (!payload?.token_usage) return null;

      const tu = payload.token_usage;
      const usage: TokenUsage = {
        inputOther: toInt(tu.input_other),
        output: toInt(tu.output),
        inputCacheRead: toInt(tu.input_cache_read),
        inputCacheCreation: toInt(tu.input_cache_creation),
      };
      const cost = calculateCost(usage, DEFAULT_PRICING);
      const timestamp = typeof json.timestamp === 'number' ? json.timestamp * 1000 : Date.now();

      return {
        timestamp,
        inputOther: usage.inputOther,
        output: usage.output,
        inputCacheRead: usage.inputCacheRead,
        inputCacheCreation: usage.inputCacheCreation,
        cost,
        messageId: payload.message_id ?? null,
        model: payload.model ?? undefined,
      };
    } catch {
      return null;
    }
  }
}

function toInt(v: any): number {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return isNaN(n) ? 0 : n;
}

/** Default pricing for kimi-k2.6 (RMB). */
export const DEFAULT_PRICING: TokenPricing = {
  inputPerMillion: 6.50,
  outputPerMillion: 27.00,
  cacheReadPerMillion: 1.10,
  cacheCreatePerMillion: 6.50,
};
