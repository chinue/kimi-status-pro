## [Unreleased]

## [0.0.2] - 2026-05-12

### Fixed
- **API data fetch** (`src/services/apiService.ts`)
  - `User-Agent` changed to `KimiCLI/1.6` (required by Kimi API)
  - `parseResponse` rewritten to match real Kimi API shape:
    - `json.usage` → weekly quota
    - `json.limits[0].detail` → window quota
  - Added `pctOrCompute` to derive percentage when API omits `used_pct`
- **OAuth login popup** (`src/services/authService.ts`, `src/extension.ts`)
  - Implemented full OAuth device-code flow (`startOAuthFlow`)
  - Status bar shows `$(key) Kimi: sign in` with command `kimiStatusPro.signIn` when auth is missing
  - Status bar shows `$(warning) Kimi: auth failed` with retry command on auth failure

### Changed
- **Status bar styling** (`src/presenters/statusBar.ts`)
  - Three items: `🌘 Kimi:12%`, `5️⃣ ▰▰▰▱▱ 45%`, `⏸️`
  - Tooltip progress bars use `▰`/`▱` characters
  - Tooltip percent aligned with `formatPercentPadded` (C-style `%5.2f`)
  - Tooltip reset time uses space-padded fixed-width format
- **Time display format** (`src/calc.ts`, `src/presenters/dashboard.ts`)
  - `fmtHours` / `fmtDuration` now use padded, fixed-width style:
    - `XXdYYh`, `XXhYYm`, `XXmYYs`, `XXs` (single digits space-padded)
- **Dashboard initial sync** (`src/presenters/dashboard.ts`)
  - WebView sends `ready` postMessage on load; extension pushes current state immediately
- **Dashboard reset countdown** (`src/presenters/dashboard.ts`)
  - Added `.progress-meta` under each progress bar showing `resets in ...`

### Added
- `buildMiniBar` (5-char progress bar) and `formatPercentPadded` in `src/calc.ts`
- `fmtDuration` helper for seconds-based formatting in `src/calc.ts`

### Tests
- Updated `calc` tests for new `buildBar` characters, `buildMiniBar`, and `fmtHours` format
- 41 passing tests total

## [0.0.1] - 2026-05-11

### Added
- **KimiStatusPro v2 Phase 1 rebuild** (`src/`)
  - Store + reducer single source of truth (`src/store.ts`)
  - setTimeout chain scheduler with overlap prevention (`src/services/scheduler.ts`)
  - 3-entry status bar: weekly 🌘, window 5️⃣, pause ⏸️ (`src/presenters/statusBar.ts`)
  - WebView dashboard with progress bars (`src/presenters/dashboard.ts`)
  - API service with Kimi-specific endpoint (`src/services/apiService.ts`)
  - Auth service with OAuth/API Key/CLI fallback (`src/services/authService.ts`)
  - Disk cache with v2 schema validation (`src/services/cacheService.ts`)
  - Local usage estimation framework (`src/services/localUsageService.ts`)
  - i18n support (en / zh-CN) (`src/i18n.ts`)
  - Cost calculation with TokenPricing parameter (`src/calc.ts`)
  - Global pause sync via globalState + configuration broadcast (`src/extension.ts`)
- **Test suite** (`test/`)
  - 34 passing tests covering store (100%), calc (100%), cache (90%+), auth (80%+), scheduler, statusBar
  - VS Code API mock for headless testing (`test/mocks/vscode.ts`)
- **Build & packaging**
  - esbuild production build script (`esbuild.js`)
  - VSIX package support
  - `.vscodeignore` for clean packaging
  - `.gitignore` for repository hygiene
