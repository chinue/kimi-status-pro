# KimiStatusPro

> 一款专业的 VS Code 扩展，用于实时监控 **Kimi Code** 配额使用情况，采用全新架构从零重建。

[![Version](https://img.shields.io/badge/version-0.4.0-blue)](https://github.com/yourname/kimi-status-pro)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

[English](README.md) | **中文**

---

## KimiStatusPro 是什么？

**KimiStatusPro** 是一款 VS Code 扩展，直接在状态栏显示你的 **Kimi Code** 用量配额——配有精美的仪表盘、本地文件估算功能，以及零不必要的磁盘 I/O。

与原版 `kimi-status-ex`（v0.3.x）相比，后者因架构腐烂而饱受困扰（双定时器、竞态条件、同步文件读取），**KimiStatusPro** 是完全重建的版本，具备以下特点：

- **单一状态源** —— 轻量级 Store + reducer 模式
- **单一调度器** —— 一条 `setTimeout` 链，无重叠 API 调用
- **零阻塞 I/O** —— 异步文件读取，支持变化检测和增量解析
- **Provider 就绪架构** —— 为将来抽象为多 Provider 框架而设计

---

## 功能特性

### 状态栏（3 个条目）

```
🌘 34.5% | 5️⃣ 67.2% | ⏸️
```

| 条目 | 操作 | 说明 |
|---|---|---|
| 🌘 **Weekly** (7d) | 点击 → 打开仪表盘 | 显示 7 天配额百分比 |
| 5️⃣ **Window** (5h) | 点击 → 强制刷新 | 显示 5 小时窗口百分比；刷新时旋转动画 |
| ⏸️ **Pause** | 点击 → 暂停/恢复 | 跨窗口同步的暂停状态 |

- **离线指示器** ⛓️‍💥 —— 服务器不可达时显示
- **陈旧指示器** 💤 —— 超过一个完整周期未更新时显示
- **Tooltip** —— 鼠标悬停显示详细的 ASCII 用量表格

### 仪表盘（WebView）

- **当前用量** —— 5h 和 7d 窗口的进度条，颜色分级显示
- **成本曲线**（Phase 3）—— Chart.js 折线图展示用量趋势
- **热力图**（Phase 3）—— 近 90 天的每日 Token/成本热力图
- **语言切换器** 🌐 —— 即时切换中英文，无需重载 VS Code

### 架构亮点

| 特性 | v0.3.x | KimiStatusPro |
|---|---|---|
| 状态管理 | `DataManager` 直接修改 | `Store` + `dispatch(action)` |
| 调度器 | 双 `setInterval` + 锁 | 单一 `setTimeout` 链 |
| 文件扫描 | 每次 tooltip 都 `fs.readSync` | `fs.stat` 变化检测 + 增量 offset 读取 |
| 缓存写入 | 每次 API 调用都写磁盘 | 纯内存；退出时持久化一次 |
| 认证 | UI 每次更新都读 `SecretStorage` | `AuthService` 缓存 60s；UI 读 `state.authStatus` |

---

## 安装

### 从 VS Code 应用商店

在扩展面板中搜索 **"KimiStatusPro"** 并安装。

### 从源码

```bash
git clone https://github.com/yourname/kimi-status-pro.git
cd kimi-status-pro
npm install
npm run build
# 在 VS Code 中按 F5 启动扩展宿主
```

---

## 认证方式

KimiStatusPro 支持三种认证方式（按顺序自动检测）：

1. **API Key** —— 通过命令 `KimiStatusPro: Set API Key` 设置
2. **OAuth** —— Token 过期前自动刷新
3. **CLI 凭证** —— 回退到 `~/.kimi/credentials.json`

---

## 配置项

| 设置项 | 默认值 | 说明 |
|---|---|---|
| `kimiStatusPro.language` | `auto` | 显示语言 (`auto` / `en` / `zh-CN`) |
| `kimiStatusPro.refreshIntervalSeconds` | `60` | API 刷新间隔（最小 30s） |
| `kimiStatusPro.displayMode` | `percent` | 状态栏模式 (`percent` / `absolute`) |
| `kimiStatusPro.statusBar.alignment` | `right` | 状态栏位置 (`left` / `right`) |
| `kimiStatusPro.rateLimitApi.enabled` | `true` | 启用自动 API 轮询 |

---

## 命令

| 命令 | ID | 说明 |
|---|---|---|
| Refresh | `kimiStatusPro.refresh` | 立即强制刷新 API |
| Sign In | `kimiStatusPro.signIn` | 设置 API Key 或发起 OAuth |
| Sign Out | `kimiStatusPro.signOut` | 清除所有凭证 |
| Show Dashboard | `kimiStatusPro.showDashboard` | 打开用量仪表盘 |
| Toggle Pause | `kimiStatusPro.togglePause` | 暂停/恢复自动刷新（跨窗口同步） |

---

## 路线图

### Phase 1: MVP（当前）
- ✅ 3 个可交互的状态栏条目
- ✅ 每 60s 自动刷新，单一 `setTimeout` 调度器
- ✅ 带 schema 版本控制的磁盘缓存
- ✅ OAuth + API Key + CLI 回退认证
- ✅ 跨窗口暂停同步
- ✅ 带进度条和语言切换器的仪表盘
- ✅ 网络错误 ⛓️‍💥 和陈旧数据 💤 指示器

### Phase 2: 本地估算
- 🔄 扫描 `~/.kimi/sessions/**/wire.jsonl`
- 🔄 Token 容量校准
- 🔄 短周期 tick（5s）本地估算，无需调用 API
- 🔄 文件变化检测 —— JSONL 未变化时跳过扫描
- 🔄 增量 offset 读取 —— 只解析新增内容

### Phase 3: 高级功能
- 📋 Chart.js 成本曲线
- 📋 热力图（Token + 成本，90 天历史）
- 📋 预算告警
- 📋 会话监控（可选，默认关闭）

---

## 架构

```
┌──────────────────────────────────────────────────────┐
│              VS Code Extension Host                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ StatusBar│  │ Dashboard│  │ Commands / Events│  │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────┘  │
│       └─────────────┴─────────────────┘              │
│                        │                             │
│                   ┌────┴────┐                        │
│                   │  Store  │  ← 单一状态源，UI 只读  │
│                   │(reducer)│                        │
│                   └────┬────┘                        │
│       ┌────────────────┼────────────────┐           │
│  ┌────┴────┐  ┌────────┴────────┐       │           │
│  │  Auth   │  │    Scheduler    │       │           │
│  │ Service │  │ (single timer)  │       │           │
│  └────┬────┘  └────────┬────────┘       │           │
│  ┌────┴────┐  ┌────────┴────────┐       │           │
│  │Secret   │  │   API Client    │       │           │
│  │Storage  │  │ (Kimi-specific) │       │           │
│  └─────────┘  └─────────────────┘       │           │
└──────────────────────────────────────────────────────┘
```

### 设计原则

1. **单一状态源** —— 所有 UI 从 `Store.getState()` 读取。状态变更只能通过 `dispatch(action)`。
2. **副作用隔离** —— 所有异步操作（API 调用、文件读取、SecretStorage 访问）封装在 Service 层。Service 从不直接修改状态。
3. **Provider 边界** —— `authService.ts` 和 `apiService.ts` 设计为可替换的 Provider 实现。其余代码（Store、Scheduler、Dashboard、StatusBar）与 Provider 无关。

---

## 开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 监听模式
npm run watch

# 运行测试
npm test

# 打包分发
npx vsce package
```

---

## License

MIT © [Your Name](https://github.com/yourname)
