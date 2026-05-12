# KimiStatusPro 编码强制规范

> **本规范对 `src/` 下所有模块具有强制约束力。**
> 任何新增代码、重构、Bug 修复都必须通过本规范检查清单后方可合入。

---

## 1. 磁盘访问隔离（铁律）

**只有 `LocalUsageService` 和 `CacheService` 可以访问磁盘。**

| 模块 | 能否访问磁盘 | 说明 |
|---|---|---|
| `LocalUsageService` | ✅ | 唯一读取 `~/.kimi/sessions` 的模块 |
| `CacheService` | ✅ | 读写 `~/.kimi/kimi-status-pro-cache-v2.json` |
| `Scheduler` | ✅ 间接 | 调用 `LocalUsageService` / `CacheService`，本身不直接 IO |
| `StatusBarPresenter` | ❌ | 只从 `store.getState()` 读取 |
| `DashboardPanel` | ❌ | 只从 `store.getState()` 读取 |
| `ApiService` / `AuthService` | ✅ 网络 | 允许 HTTP 请求，但禁止本地磁盘 IO（除 SecretStorage） |

**违规示例**：
```typescript
// ❌ 禁止 —— Presenter 直接访问磁盘
import { LocalUsageService } from '../services/localUsageService';
const usage = await LocalUsageService.getInstance().getLocalUsage();
```

**正确做法**：
```typescript
// ✅ 正确 —— 从内存 state 读取
const lu = store.getState().localEstimate;
```

---

## 2. 数据保留周期

### 2.1 配置项

`kimiStatusPro.dataRetentionDays`：控制 LocalUsageService 保留历史 entries 的天数。

- **默认值**：365
- **范围**：30 – 3650（约 10 年）
- **单位**：天

### 2.2 过滤规则

`LocalUsageService.scanAllFiles()` 在解析 entry 后，必须丢弃超出 retention 的数据：

```typescript
const retentionStart = now - dataRetentionDays * 24 * 3600 * 1000;
if (entry.timestamp < retentionStart) continue; // 丢弃过期数据
```

聚合窗口（today / 5h / 7d）保持不变，只受 retention 上限控制。

---

## 3. 内存预算（双红线）

### 3.1 新增数据字段前必须做内存估算

新增字段（包括新增聚合指标、新增时间窗口、新增列式数组）前，按以下公式计算：

| 指标 | 公式 | 红线 |
|---|---|---|
| **年日均用量** | 有效天（用量 > 0 的天）总内存 ÷ 有效天数 | × dataRetentionDays ≤ **200MB** |
| **年内日最大用量** | 全年单日最大内存峰值 | × dataRetentionDays ≤ **400MB** |

> **注意**：年日均用量只统计**有效天**（用量 > 0 的天），0 用量天不纳入平均。

### 3.2 计算示例

假设用户实际数据（17 天有效）：
- 有效天总内存：1.05 MB
- 有效天数：17
- 年日均用量：1.05MB ÷ 17 ≈ **62 KB/天**
- 年内日最大用量：**242 KB**

标准年（365 天）：
- 62KB × 365 ≈ **22.6 MB** < 200MB ✅
- 242KB × 365 ≈ **86.3 MB** < 400MB ✅

### 3.3 超过红线的处理流程

如果任一指标超过红线：
1. **停止新增**，不得自行合入
2. **向用户报告**：
   - 当前内存估算结果
   - 超标指标和超标倍数
3. **给出可行建议**（至少提供 2 种）：
   - 缩短 `dataRetentionDays`
   - 改用列式存储（Struct-of-Arrays）
   - 数据采样（如只保留每 N 条）
   - 压缩存储（如用 TypedArray）
4. **等待用户确认**后方可继续

---

## 4. 格式化统一封装

**所有可能被多处使用的格式化、计算、显示逻辑必须封装为纯函数，统一放在 `src/calc.ts`。**

禁止在 Presenter、Service 或前端脚本中内联格式化逻辑。

### 4.1 已封装函数清单

| 函数 | 用途 | 使用位置 |
|---|---|---|
| `fmtDuration(totalSeconds)` | 时间格式（`2d03h` / `45m30s` / `5s`） | tooltip、dashboard、状态栏 |
| `fmtHours(hours)` | 小时 → 格式化时长 | tooltip 重置时间 |
| `fmtTokens(n)` | Token 数（`1.2M` / `3.5k`） | tooltip 表格、dashboard |
| `fmtCost(rmb)` | 成本（`¥12.34`） | tooltip 表格、dashboard |
| `formatPercent(pct, decimals)` | 百分比（`25.3%`） | 状态栏、dashboard |
| `formatPercentPadded(pct, decimals)` | 固定宽度百分比（` 25.34%`） | tooltip |
| `buildBar(util, width)` | Unicode 进度条 | 状态栏、tooltip |
| `drawBorderTable(header, rows, align)` | CJK 感知的边框表格 | tooltip |

### 4.2 前端 WebView 中的处理

Dashboard 的 WebView 无法直接导入后端模块。当前方案：
- `fmtDuration` 和 `formatPercent` 已内联到前端 `<script>` 中
- **禁止新增内联函数**；如需新增，必须先在后端 `calc.ts` 中定义，再同步内联到前端

---

## 5. i18n 强制规范

**所有用于显示的字符串（除纯数值、单位符号如 `%`、`¥`、`#`）必须通过 `makeT()` 翻译，禁止硬编码。**

### 5.1 已支持语言

- `en`（英文）
- `zh-CN`（简体中文）

### 5.2 添加新字符串的流程

1. 在 `src/i18n.ts` 的 `dict.en` 和 `dict['zh-CN']` 中同时添加键值对
2. 在代码中使用 `t('key')` 调用
3. **禁止只添加一种语言**（必须双语同时添加）

### 5.3 硬编码字符串检查清单

以下硬编码字符串已在 v0.1.5 中全部修复为 i18n 键：

| 位置 | 原硬编码 | i18n 键 | 修复版本 |
|---|---|---|---|
| statusBar.ts | `'Resume auto-refresh'` | `tooltip.resumeAutoRefresh` | v0.1.5 |
| statusBar.ts | `'Pause auto-refresh'` | `tooltip.pauseAutoRefresh` | v0.1.5 |
| statusBar.ts | `'Quota Summary'`（fallback） | `tooltip.table.quotaSummary` | v0.1.5 |
| statusBar.ts | `'Parallel'`（fallback） | `tooltip.table.col.parallel` | v0.1.5 |
| dashboard.ts | `'Loading…'` | `dashboard.loading` | v0.1.5 |
| dashboard.ts | `'5h window'` | `dashboard.window5h` | v0.1.5 |
| dashboard.ts | `'7d window'` | `dashboard.window7d` | v0.1.5 |
| dashboard.ts | `'just now'` | `dashboard.justNow` | v0.1.5 |
| dashboard.ts | `'m ago'` | `dashboard.minutesAgo` | v0.1.5 |
| dashboard.ts | `'Last updated: '` | `dashboard.lastUpdated` | v0.1.5 |

> 新增显示字符串时，必须同步添加到 `src/i18n.ts`（中英双语），并更新本清单。

---

## 6. 审查检查清单

提交代码前，逐条确认：

- [ ] 没有 Presenter 直接导入 `LocalUsageService`
- [ ] 没有内联 `padStart` / `padEnd` / `toFixed` 格式化逻辑
- [ ] 没有新增未受 `dataRetentionDays` 限制的 entries 缓存
- [ ] 新增字段前已做内存估算，双红线均满足
- [ ] 所有新增/修改的显示字符串已添加到 `src/i18n.ts`（中英双语）
- [ ] 所有百分比显示统一使用 `formatPercent`（后端）或内联 `formatPercent`（前端）
- [ ] 66+ 测试全部通过
- [ ] `node esbuild.js --production` 编译成功
