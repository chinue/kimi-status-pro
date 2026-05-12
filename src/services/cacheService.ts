// DESIGN: v2-phase2-implementation.md#servicescacheservicets
// AGENTS: err->try-catch | schema-version->v2 | disk-OK
// 💠 Generic: cache schema is provider-agnostic.

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { CachedData } from '../types';

const CACHE_DIR = path.join(os.homedir(), '.kimi');
const CACHE_FILE = path.join(CACHE_DIR, 'kimi-status-pro-cache-v2.json');
const SCHEMA = 'kimi-status-pro-cache-v2';
const CURRENT_VERSION = 2;

export class CacheService {
  private static instance: CacheService;
  private cacheFile: string;

  static getInstance(): CacheService {
    if (!CacheService.instance) { CacheService.instance = new CacheService(); }
    return CacheService.instance;
  }

  constructor(cacheFile?: string) {
    this.cacheFile = cacheFile ?? CACHE_FILE;
  }

  async read(): Promise<CachedData | null> {
    try {
      const raw = await fs.readFile(this.cacheFile, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.schema !== SCHEMA || parsed.version !== CURRENT_VERSION) {
        return null;
      }
      return parsed.data;
    } catch {
      return null;
    }
  }

  async write(data: CachedData): Promise<void> {
    const payload = {
      version: CURRENT_VERSION,
      schema: SCHEMA,
      writtenAt: new Date().toISOString(),
      data,
    };
    try {
      await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
      await fs.writeFile(this.cacheFile, JSON.stringify(payload, null, 2));
    } catch {
      // ignore write errors
    }
  }

  async clear(): Promise<void> {
    try { await fs.unlink(this.cacheFile); } catch { /* ignore */ }
  }
}
