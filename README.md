# KimiStatusPro

> A professional VS Code extension for real-time monitoring of **Kimi Code** quota usage, rebuilt from the ground up with a clean architecture.

[![Version](https://img.shields.io/badge/version-0.4.0-blue)](https://github.com/yourname/kimi-status-pro)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**English** | [中文](README.zh-CN.md)

---

## What is KimiStatusPro?

**KimiStatusPro** is a VS Code extension that displays your **Kimi Code** usage quota directly in the status bar — with a beautiful dashboard, local file estimation, and zero unnecessary disk I/O.

Unlike the original `kimi-status-ex` (v0.3.x) which suffered from architectural rot (dual timers, race conditions, sync file reads), **KimiStatusPro** is a complete rebuild with:

- **Single source of truth** — a lightweight Store + reducer pattern
- **Single scheduler** — one `setTimeout` chain, no overlapping API calls
- **Zero blocking I/O** — async file reads with change detection and incremental parsing
- **Provider-ready architecture** — designed for future abstraction into a multi-provider framework

---

## Features

### Status Bar (3 entries)

```
🌘 34.5% | 5️⃣ 67.2% | ⏸️
```

| Entry | Action | Description |
|---|---|---|
| 🌘 **Weekly** (7d) | Click → Open Dashboard | Shows 7-day quota percentage |
| 5️⃣ **Window** (5h) | Click → Force Refresh | Shows 5-hour window percentage; spins during refresh |
| ⏸️ **Pause** | Click → Pause/Resume | Cross-window synchronized pause state |

- **Offline indicator** ⛓️‍💥 appears when the server is unreachable
- **Stale indicator** 💤 appears when data hasn't been updated for a full cycle
- **Tooltip** on hover shows a detailed ASCII table with usage, limits, remaining, and reset times

### Dashboard (WebView)

- **Current Usage** — progress bars for 5h and 7d windows with color-coded thresholds
- **Cost Curve** (Phase 3) — Chart.js line chart showing usage trends
- **Heatmap** (Phase 3) — Daily token/cost heatmaps for the last 90 days
- **Language switcher** 🌐 — instant language toggle (zh / en) without reloading VS Code

### Architecture Highlights

| Feature | v0.3.x | KimiStatusPro |
|---|---|---|
| State management | `DataManager` direct mutation | `Store` + `dispatch(action)` |
| Scheduler | Dual `setInterval` + locks | Single `setTimeout` chain |
| File scanning | `fs.readSync` every tooltip | `fs.stat` change detection + incremental offset reads |
| Cache writes | Every API call writes to disk | In-memory only; persists once on exit |
| Auth | UI reads `SecretStorage` every update | `AuthService` caches 60s; UI reads `state.authStatus` |

---

## Installation

### From VS Code Marketplace

Search for **"KimiStatusPro"** in the Extensions panel and install.

### From Source

```bash
git clone https://github.com/yourname/kimi-status-pro.git
cd kimi-status-pro
npm install
npm run build
# Press F5 in VS Code to launch the Extension Host
```

---

## Authentication

KimiStatusPro supports three authentication methods (auto-detected in order):

1. **API Key** — Set via command `KimiStatusPro: Set API Key`
2. **OAuth** — Automatic refresh before token expiry
3. **CLI Credentials** — Fallback to `~/.kimi/credentials.json`

---

## Configuration

| Setting | Default | Description |
|---|---|---|
| `kimiStatusPro.language` | `auto` | Display language (`auto` / `en` / `zh-CN`) |
| `kimiStatusPro.refreshIntervalSeconds` | `60` | API refresh interval (min 30s) |
| `kimiStatusPro.displayMode` | `percent` | Status bar mode (`percent` / `absolute`) |
| `kimiStatusPro.statusBar.alignment` | `right` | Status bar position (`left` / `right`) |
| `kimiStatusPro.rateLimitApi.enabled` | `true` | Enable automatic API polling |

---

## Commands

| Command | ID | Description |
|---|---|---|
| Refresh | `kimiStatusPro.refresh` | Force an immediate API refresh |
| Sign In | `kimiStatusPro.signIn` | Set API Key or initiate OAuth |
| Sign Out | `kimiStatusPro.signOut` | Clear all credentials |
| Show Dashboard | `kimiStatusPro.showDashboard` | Open the usage dashboard |
| Toggle Pause | `kimiStatusPro.togglePause` | Pause/resume auto-refresh (synced across windows) |

---

## Roadmap

### Phase 1: MVP (Current)
- ✅ Status bar with 3 interactive entries
- ✅ Auto-refresh every 60s via single `setTimeout` scheduler
- ✅ Disk cache with schema versioning
- ✅ OAuth + API Key + CLI fallback authentication
- ✅ Cross-window pause synchronization
- ✅ Dashboard with progress bars and language switcher
- ✅ Network error ⛓️‍💥 and stale data 💤 indicators

### Phase 2: Local Estimation
- 🔄 JSONL file scanning from `~/.kimi/sessions/**/wire.jsonl`
- 🔄 Token capacity calibration
- 🔄 Short tick (5s) local estimation without API calls
- 🔄 File change detection — skip scan when JSONL is unchanged
- 🔄 Incremental offset reads — parse only new content

### Phase 3: Advanced Features
- 📋 Cost curves with Chart.js
- 📋 Heatmaps (token + cost, 90-day history)
- 📋 Budget alerts
- 📋 Session monitor (optional, default off)

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│              VS Code Extension Host                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ StatusBar│  │ Dashboard│  │ Commands / Events│  │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────┘  │
│       └─────────────┴─────────────────┘              │
│                        │                             │
│                   ┌────┴────┐                        │
│                   │  Store  │  ← Single source of    │
│                   │(reducer)│    truth, read-only UI │
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

### Design Principles

1. **Single source of truth** — All UI reads from `Store.getState()`. State changes only via `dispatch(action)`.
2. **Side-effect isolation** — All async operations (API calls, file reads, SecretStorage) live in Service layers. Services never mutate state directly.
3. **Provider boundary** — `authService.ts` and `apiService.ts` are designed as swappable Provider implementations. The rest of the codebase (Store, Scheduler, Dashboard, StatusBar) is provider-agnostic.

---

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run watch

# Run tests
npm test

# Package for distribution
npx vsce package
```

---

## License

MIT © [Your Name](https://github.com/yourname)
