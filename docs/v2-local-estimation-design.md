# KimiStatusPro v2 本地估算设计文档

> 版本：v2.0.0-draft  
> 日期：2026-05-10  
> 状态：待评审  

---

## 1. 为什么需要本地估算

Kimi API 的配额接口有调用频率限制（5h 窗口约 1000 次，7d 窗口约 100 次）。如果每次用户操作都调 API，很快会触发限流。本地估算通过读取 Kimi CLI 生成的 `wire.jsonl` 日志文件，在本地计算 token 使用量，实现：

1. **高频刷新**（每 5 秒）而不调 API
2. **更精确的百分比**（API 返回的 `weeklyUsedPct` 是整数，本地估算可到小数）
3. **成本计算**（API 不返回成本，本地根据 token × 定价计算）

---

## 2. 数据来源

### 2.1 日志文件位置

```
~/.kimi/sessions/
├── <session-id-1>/
│   ├── <conversation-id-1>/
│   │   └── wire.jsonl          ← 目标文件
│   └── <conversation-id-2>/
│       └── wire.jsonl
└── <session-id-2>/
    └── ...
```

### 2.2 日志文件格式

每行一个 JSON 对象，我们只关心 `type === 'StatusUpdate'` 的消息：

```json
{
  "timestamp": 1715355600.123,
  "message": {
    "type": "StatusUpdate",
    "payload": {
      "message_id": "msg_abc123",
      "token_usage": {
        "input_other": 1234,
        "output": 567,
        "input_cache_read": 89,
        "input_cache_creation": 12
      }
    }
  }
}
```

**关键字段**：
- `timestamp`：Unix 时间戳（秒）
- `message.payload.message_id`：去重 key
- `message.payload.token_usage.input_other`：普通输入 token
- `message.payload.token_usage.output`：输出 token
- `message.payload.token_usage.input_cache_read`：缓存读取 token
- `message.payload.token_usage.input_cache_creation`：缓存写入 token

### 2.3 读取策略

```typescript
interface FileState {
  mtimeMs: number;
  size: number;
  entries: UsageEntry[];
}

class LocalUsageService {
  private fileStates = new Map<string, FileState>();

  async getLocalUsage(opts: {
    cycleStartMs?: number;
    weeklyResetAtMs?: number;
    windowResetAtMs?: number;
  }): Promise<LocalAggregatedUsage> {
    return this.scanAllFiles(opts);
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
    // 读取新增内容并解析
    const entries = await this.readNewEntries(filePath, existing);
    const next: FileState = { mtimeMs: stat.mtimeMs, size: stat.size, entries };
    this.fileStates.set(filePath, next);
    return next;
  }
}
```

**性能优化**：
- `fileStates` Map 增量更新：按文件路径缓存解析结果，通过 `mtimeMs + size` 检测文件变化
- 文件未变化时直接复用缓存的 `entries`，避免重复解析
- 所有文件并行读取：`Promise.all(filePaths.map(fp => readFile(fp)))`
- 单文件增量读取：记录上次读取的 offset，只读新增内容
- 去重：按 `message_id` 去重，避免同一消息被重复计数

---

## 3. 聚合逻辑

### 3.1 时间窗口定义

| 窗口 | 起始时间 | 说明 |
|---|---|---|
| 今日 | `todayStart = new Date().setHours(0,0,0,0)` | 本地时区 0 点 |
| 5h | `windowResetAtMs - 5 * 3600 * 1000` | 以 API 返回的 resetAt 为终点 |
| 7d | `weeklyResetAtMs - 7 * 24 * 3600 * 1000` | 以 API 返回的 resetAt 为终点 |
| 当前周期 | `cycleStartMs` | 由 `getCycleStartMs()` 计算 |

### 3.2 聚合结果结构

```typescript
interface LocalAggregatedUsage {
  // 今日（本地时区 0 点至今）
  tokensToday: number;          // input + output + cacheRead + cacheCreate
  costToday: number;            // ¥
  requestsToday: number;        // 消息数

  // 5h 窗口（以 windowResetAt 为终点）
  tokensIn5h: number;           // input_other
  tokensOut5h: number;          // output
  tokensCacheRead5h: number;    // input_cache_read
  tokensCacheCreate5h: number;  // input_cache_creation
  cost5h: number;               // ¥
  requests5h: number;

  // 7d 周期（以 weeklyResetAt 为终点）
  tokensIn7d: number;
  tokensOut7d: number;
  tokensCacheRead7d: number;
  tokensCacheCreate7d: number;
  cost7d: number;
  requests7d: number;

  // 当前计费周期
  tokensThisCycle: number;      // input + output + cacheRead + cacheCreate
  costThisCycle: number;        // ¥
  requestsThisCycle: number;

  // 原始 entries（用于热力图、仪表盘明细）
  entries: UsageEntry[];
}

interface UsageEntry {
  timestamp: number;  // ms
  inputOther: number;
  output: number;
  inputCacheRead: number;
  inputCacheCreation: number;
  cost: number;       // ¥
  messageId: string | null;
  model?: string;     // 预留多模型
}
```

### 3.3 成本计算

```typescript
function calculateCost(tokens: {
  inputOther: number;
  output: number;
  inputCacheRead: number;
  inputCacheCreation: number;
}, pricing: TokenPricing): number {
  const cost = (
    (tokens.inputOther / 1_000_000) * pricing.inputPerMillion +
    (tokens.output / 1_000_000) * pricing.outputPerMillion +
    (tokens.inputCacheRead / 1_000_000) * pricing.cacheReadPerMillion +
    (tokens.inputCacheCreation / 1_000_000) * pricing.cacheCreatePerMillion
  );
  return isFinite(cost) && cost >= 0 ? cost : 0;
}
```

**默认定价**（kimi-k2.6 RMB）：
- Input（cache miss）：¥6.50 / 1M tokens
- Output：¥27.00 / 1M tokens
- Cache read（cache hit）：¥1.10 / 1M tokens
- Cache creation：¥6.50 / 1M tokens

---

## 4. 容量校准（Calibration）

### 4.1 为什么需要校准

API 返回的 `weeklyUsedPct` 是**整数**，例如 `62%`。但本地实际使用了 `12345678` tokens。我们无法直接知道 "62% 对应多少 tokens"，因为 Kimi 的百分比计算可能包含了其他因素（如不同模型的权重、费用上限等）。

**校准**就是在 API 返回精确百分比的那一刻，记录 "当前本地 tokens / API 百分比"，得到一个**容量系数**。之后没有 API 数据时，用 "当前本地 tokens / 容量系数" 来估算百分比。

### 4.2 7d Token 容量校准

```typescript
function calibrateTokenCapacity(
  apiWeeklyUsedPct: number,      // API 返回的整数，如 62
  localTokensThisCycle: number   // 当前周期本地 tokens
): number | null {
  if (!apiWeeklyUsedPct || apiWeeklyUsedPct <= 0) return null;
  if (localTokensThisCycle <= 0) return null;

  // capacity = localTokens / (apiPct / 100)
  // 例如：localTokens = 10,000,000, apiPct = 62
  // capacity = 10,000,000 / 0.62 = 16,129,032
  const capacity = localTokensThisCycle / (apiWeeklyUsedPct / 100);
  return isFinite(capacity) && capacity > 0 ? capacity : null;
}
```

**校准时机**：每次 API 调用成功时立即校准。

**校准值存储**：写入 `ApiCache` 持久化：
```json
{
  "calibration": {
    "tokenCapacity": 16129032,
    "calibratedAt": 1715355600000
  }
}
```

### 4.3 5h 成本容量校准

5h 窗口的限制是基于**成本**（RMB）而非 token 数。API 返回 `windowUsedPct`，本地计算 `cost5h`。

```typescript
function calibrateWindowCostCapacity(
  apiWindowUsedPct: number,   // API 返回的整数
  localCost5h: number         // 本地 5h 成本
): number | null {
  if (!apiWindowUsedPct || apiWindowUsedPct <= 0) return null;
  if (localCost5h <= 0) return null;

  // capacity = cost5h / (apiPct / 100)
  // 例如：cost5h = ¥45.67, apiPct = 30
  // capacity = 45.67 / 0.30 = ¥152.23
  const capacity = localCost5h / (apiWindowUsedPct / 100);
  return isFinite(capacity) && capacity > 0 ? capacity : null;
}
```

**特殊情况：API 返回 0%**

当 API `windowUsedPct = 0` 但本地 `cost5h > 0` 时，无法直接校准。使用启发式估算：

```typescript
function estimateWindowCostCapacityHeuristic(
  localCost5h: number,
  windowLimit: number | null
): number | null {
  if (localCost5h <= 0) return null;
  if (!windowLimit || windowLimit <= 0) return null;

  // 假设当前成本对应 1 个最小请求单位
  // capacity = cost5h * windowLimit
  const capacity = localCost5h * windowLimit;
  return isFinite(capacity) && capacity > 0 ? capacity : null;
}
```

### 4.4 校准值过期处理

校准值不是永久有效的。以下情况应视为过期：

1. **周期重置**：`weeklyResetAt` 或 `windowResetAt` 变化时，上一周期的校准值失效
2. **长时间未校准**：超过 `7d` 未更新（用户可能更换了模型或定价策略）
3. **百分比跳变**：API 返回的百分比与估算值偏差 > 10%（说明容量模型已不准确）

```typescript
function isCalibrationValid(
  calibration: Calibration,
  currentResetAt: number | null
): boolean {
  if (!calibration.calibratedAt) return false;
  if (!currentResetAt) return false;

  // 如果 resetAt 变了，校准值失效
  if (calibration.resetAt !== currentResetAt) return false;

  // 超过 7 天未校准
  if (Date.now() - calibration.calibratedAt > 7 * 24 * 3600 * 1000) return false;

  return true;
}
```

---

## 5. 估算逻辑（Estimation）

### 5.1 7d 百分比估算

```typescript
function estimateWeeklyPct(
  localTokensThisCycle: number,
  tokenCapacity: number | null
): number | null {
  if (!tokenCapacity || tokenCapacity <= 0) return null;
  if (localTokensThisCycle < 0) return null;

  const pct = (localTokensThisCycle / tokenCapacity) * 100;
  return Math.min(100, Math.max(0, pct));
}
```

**Fallback**：如果没有校准值，回退到 `used / limit`：
```typescript
function fallbackWeeklyPct(
  localTokensThisCycle: number,
  weeklyLimit: number | null
): number {
  if (!weeklyLimit || weeklyLimit <= 0) return 0;
  return Math.min(100, (localTokensThisCycle / weeklyLimit) * 100);
}
```

### 5.2 5h 百分比估算

```typescript
function estimateWindowPct(
  localCost5h: number,
  windowCostCapacity: number | null
): number | null {
  if (!windowCostCapacity || windowCostCapacity <= 0) return null;
  if (localCost5h < 0) return null;

  const pct = (localCost5h / windowCostCapacity) * 100;
  return Math.min(100, Math.max(0, pct));
}
```

**Fallback**：如果没有校准值，回退到 `used / limit`：
```typescript
function fallbackWindowPct(
  localCost5h: number,
  windowLimit: number | null
): number {
  if (!windowLimit || windowLimit <= 0) return 0;
  return Math.min(100, (localCost5h / windowLimit) * 100);
}
```

### 5.3 估算 vs API 的优先级

```
API 可用且有效
  → 使用 API 返回的百分比（精确）
  → 同时进行校准
  → **百分数平稳化**：若本地估算值四舍五入后的整数与 API 返回的整数一致，保留更精细的估算值；不一致时强制更新为 API 值

API 不可用（限流/网络错误）
  → 使用本地估算
  → 如果校准值有效：用校准容量估算
  → 如果校准值无效：用 fallback（used/limit）

从未调过 API（首次使用）
  → 使用 fallback（used/limit）
  → 显示提示：数据基于本地日志估算
```

### 5.4 状态流转

```
API_SUCCESS
  → state.weeklyUsedPct = apiWeeklyUsedPct（经平稳化后可能保留本地小数估算）
  → state.windowUsedPct = apiWindowUsedPct（经平稳化后可能保留本地小数估算）
  → state.dataSource = 'api'
  → 触发校准：tokenCapacity, windowCostCapacity

API_ERROR (非 401/403)
  → state.weeklyUsedPct = estimateWeeklyPct(localTokens, tokenCapacity)
  → state.windowUsedPct = estimateWindowPct(localCost5h, windowCostCapacity)
  → state.dataSource = 'stale'
  → state.error = errorMessage

NO_CREDENTIALS
  → state.weeklyUsedPct = null
  → state.windowUsedPct = null
  → state.dataSource = 'no-credentials'

FIRST_LAUNCH (无缓存)
  → state.weeklyUsedPct = fallbackWeeklyPct(localTokens, weeklyLimit)
  → state.windowUsedPct = fallbackWindowPct(localCost5h, windowLimit)
  → state.dataSource = 'local-only'
```

---

## 6. 定时器调度

### 6.1 Short Tick（5 秒）

```typescript
async function onShortTick(store: Store): Promise<void> {
  // 1. 读取本地 JSONL（fileStates 增量更新）
  const localUsage = await localUsageService.getLocalUsage({
    weeklyResetAtMs: store.getState().quota?.weeklyResetAt,
    windowResetAtMs: store.getState().quota?.windowResetAt,
  });

  // 2. 估算百分比
  const tokenCapacity = store.getState().localEstimate?.tokenCapacity;
  const windowCostCapacity = store.getState().localEstimate?.windowCostCapacity;

  const weeklyPct = estimateWeeklyPct(localUsage.tokensThisCycle, tokenCapacity)
    ?? fallbackWeeklyPct(localUsage.tokensThisCycle, store.getState().quota?.weeklyLimit);

  const windowPct = estimateWindowPct(localUsage.cost5h, windowCostCapacity)
    ?? fallbackWindowPct(localUsage.cost5h, store.getState().quota?.windowLimit);

  // 3. 更新状态
  store.dispatch({
    type: 'LOCAL_ESTIMATE',
    payload: {
      weeklyPct,
      windowPct,
      localUsage,
    },
  });
}
```

**注意**：Short tick **不调 API**，只做本地估算。如果当前没有校准值，百分比可能不准确，但这是预期行为（用户会看到一个"估算中"的提示）。

### 6.2 Long Tick（60 秒）

```typescript
async function onLongTick(store: Store, authService: AuthService): Promise<void> {
  const token = await authService.resolveToken();
  if (!token) {
    store.dispatch({ type: 'AUTH_STATUS', payload: 'missing' });
    return;
  }

  try {
    const apiData = await apiService.fetchQuota(token);

    // 读取本地数据用于校准
    const localUsage = await localUsageService.getLocalUsage({
      weeklyResetAtMs: apiData.weeklyResetAt,
      windowResetAtMs: apiData.windowResetAt,
    });

    // 校准
    const tokenCapacity = calibrateTokenCapacity(
      apiData.weeklyUsedPct,
      localUsage.tokensThisCycle
    );
    const windowCostCapacity = calibrateWindowCostCapacity(
      apiData.windowUsedPct,
      localUsage.cost5h
    );

    // 写入缓存
    await cacheService.write({
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

    // 百分数平稳化
    const currentEstimate = store.getState().localEstimate;
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

    // 更新状态
    store.dispatch({ type: 'API_SUCCESS', payload: apiData });
    store.dispatch({
      type: 'LOCAL_ESTIMATE',
      payload: {
        weeklyPct,
        windowPct,
        tokenCapacity,
        windowCostCapacity,
        calibratedAt: Date.now(),
      },
    });

  } catch (err) {
    if (err.status === 401) {
      store.dispatch({ type: 'API_ERROR', payload: { error: 'Unauthorized', authFailed: true } });
      authService.invalidate();
    } else if (err.status === 403) {
      store.dispatch({ type: 'API_ERROR', payload: { error: 'Forbidden', authFailed: true } });
    } else {
      store.dispatch({ type: 'API_ERROR', payload: { error: err.message } });
    }
  }
}
```

---

## 7. 缓存持久化

### 7.1 缓存文件结构

```json
{
  "version": 2,
  "schema": "kimi-status-pro-cache-v2",
  "writtenAt": "2026-05-10T21:00:00.000Z",
  "data": {
    "quota": {
      "weeklyLimit": 100000000,
      "weeklyUsed": 62000000,
      "weeklyUsedPct": 62,
      "weeklyResetAt": 1715960400000,
      "windowLimit": 5000000,
      "windowUsed": 1500000,
      "windowRemaining": 3500000,
      "windowUsedPct": 30,
      "windowResetAt": 1715374800000,
      "parallelLimit": 10
    },
    "calibration": {
      "tokenCapacity": 100000000,
      "windowCostCapacity": 152.23,
      "calibratedAt": 1715355600000,
      "reset5hAt": 1715374800,
      "reset7dAt": 1715960400
    }
  }
}
```

### 7.2 启动时恢复

```typescript
async function init(store: Store): Promise<void> {
  const cached = await cacheService.read();
  if (cached) {
    // 恢复配额数据
    store.dispatch({ type: 'CACHE_LOADED', payload: cached.quota });

    // 恢复校准值
    if (cached.calibration) {
      store.dispatch({
        type: 'LOCAL_ESTIMATE',
        payload: {
          tokenCapacity: cached.calibration.tokenCapacity,
          windowCostCapacity: cached.calibration.windowCostCapacity,
          calibratedAt: cached.calibration.calibratedAt,
        },
      });
    }

    // 判断缓存新鲜度
    const age = Date.now() - cached.quota.lastUpdated;
    const isFresh = age < config.cacheTtlSeconds * 1000;
    store.dispatch({
      type: 'API_SUCCESS', // 或 CACHE_LOADED 单独处理
      payload: { ...cached.quota, dataSource: isFresh ? 'cache' : 'stale' },
    });
  }
}
```

---

## 8. 错误处理

### 8.1 文件读取错误

| 场景 | 处理 |
|---|---|
| `~/.kimi/sessions` 不存在 | 返回空聚合结果，所有计数为 0 |
| 单个文件读取失败 | 跳过该文件，继续处理其他文件 |
| JSON parse 失败 | 跳过该行，继续处理下一行 |
| 文件被占用 | 跳过，下次 tick 重试 |

### 8.2 估算异常

```typescript
function safeEstimate(
  estimateFn: () => number | null,
  fallbackFn: () => number
): number {
  try {
    const result = estimateFn();
    return result !== null && isFinite(result) ? result : fallbackFn();
  } catch {
    return fallbackFn();
  }
}
```

### 8.3 校准异常

- `tokenCapacity` 或 `windowCostCapacity` 为 `NaN/Infinity/负数` → 视为 `null`
- 校准值异常大（如 > 1e15）→ 视为 `null`
- 校准后百分比 > 150% → 视为 `null`（说明容量模型已失效）

---

## 9. 与旧版本的改进

| 维度 | v0.3.x | v2 |
|---|---|---|
| **文件扫描** | 同步 `fs.readSync`，阻塞主线程 | 异步 `fs.readFile`，并行读取 |
| **缓存 TTL** | 无（每次 tooltip 都重新扫描） | 30 秒内存缓存 |
| **校准持久化** | 只存 `tokenCapacity`，不存 `windowCostCapacity` | 完整校准对象持久化 |
| **校准过期** | 无过期检测 | 基于 `resetAt` 和时间双重检测 |
| **估算 Fallback** | fallback 逻辑散落在多处 | 统一的 `safeEstimate` 包装 |
| **错误处理** | 局部 try/catch，可能漏捕获 | 每个 Service 边界独立捕获 |
| **状态修改** | 直接修改 `this.state` | 通过 `dispatch` 统一更新 |

---

## 10. 文件结构

```
src/
├── services/
│   ├── localUsageService.ts    # 本地 JSONL 扫描 + 聚合
│   ├── cacheService.ts         # 磁盘缓存读写
│   └── apiService.ts           # API 调用
├── calc.ts                     # 成本计算 + 校准 + 估算（纯函数）
└── types.ts                    # LocalAggregatedUsage 等类型
```

---

*文档结束。本地估算的所有逻辑（扫描、聚合、校准、估算、缓存）均在此文档中描述，无需参考旧代码。*
