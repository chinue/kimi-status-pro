## [Unreleased]

## [0.1.6] - 2026-05-12

### Added
- **Dashboard refresh button live timer** (`src/presenters/dashboard.ts`, `src/i18n.ts`)
  - Button now shows `"↻ XXs ago"` counting up every second since last refresh
  - New i18n keys: `dashboard.secondsAgo`, `dashboard.refreshing`
- **Percentage smoothing on API refresh** (`src/services/scheduler.ts`)
  - Long tick compares local estimate (rounded) with API integer; if they match, preserves the smoother decimal estimate
  - Avoids jarring jumps back to integer every 60s when local short-tick estimate is already accurate
- **Store-level diff for LOCAL_ESTIMATE** (`src/store.ts`)
  - Reducer skips dispatch when all payload fields equal current values (same state reference)
  - Eliminates unnecessary UI refreshes during idle short ticks
- **Frontend DOM diff in dashboard** (`src/presenters/dashboard.ts`)
  - Only mutates DOM properties when values actually changed
  - Prevents CSS transition re-trigger flicker even if postMessage fires

### Changed
- **Tooltip cost header** (`src/i18n.ts`)
  - English: `"¥"` → `"COST"` (Chinese stays `"费用"`)
- **Tooltip local-usage row** (`src/types.ts`, `src/services/localUsageService.ts`, `src/services/scheduler.ts`, `src/presenters/statusBar.ts`, `src/i18n.ts`)
  - Replaced `"24h"` row with `"5h"` row in the detailed usage table
  - `LocalEstimate` / `LocalAggregatedUsage` fields: `*24h` → `*5h`
  - `LocalUsageService.scanAllFiles()` now aggregates full 5h token stats (not just cost)

### Fixed
- **MemorySecretStorage mock** (`test/mocks/vscode.ts`)
  - Added missing `keys()` and `onDidChange` properties for VS Code SecretStorage compatibility
- **Design document inconsistencies** (`docs/v2-local-estimation-design.md`, `docs/v2-phase2-implementation.md`, `docs/CODING_STANDARDS.md`)
  - `v2-local-estimation-design.md`: removed obsolete "30s TTL cache" description (replaced with `fileStates` Map incremental update); removed "24h" time window; fixed `store.state` → `store.getState()` in code examples
  - `v2-phase2-implementation.md`: removed TTL cache code; removed `day24hAgo` fallback; fixed 5h aggregation logic to use `window5hStart` directly; removed duplicate `cost5h` field in `LocalAggregatedUsage`
  - `CODING_STANDARDS.md`: updated section 5.3 hardcoded-string list to mark all items as fixed in v0.1.5

## [0.1.5] - 2026-05-12

### Added
- **Data retention period configuration** (`package.json`, `src/config.ts`, `src/services/localUsageService.ts`)
  - New setting `kimiStatusPro.dataRetentionDays` (default: 365, range: 30–3650)
  - LocalUsageService discards entries older than retention period during scan
- **Coding standards document** (`docs/CODING_STANDARDS.md`)
  - Disk access isolation rule: only LocalUsageService and CacheService may touch disk
  - Memory budget rule: dual red lines (daily-avg×retention ≤ 200MB, daily-max×retention ≤ 400MB)
  - Formatting unification rule: all display logic must live in `src/calc.ts`
  - i18n rule: all display strings must use `makeT()`, no hardcoded text
- **Unified percentage resolution** (`src/calc.ts`)
  - `resolveWeeklyPct(state)` / `resolveWindowPct(state)` — consistent priority across statusBar, tooltip, dashboard
  - Priority: calibrated localEstimate > API quota > 0

### Changed
- **i18n completeness** (`src/i18n.ts`, `src/presenters/statusBar.ts`, `src/presenters/dashboard.ts`)
  - All previously hardcoded display strings are now i18n keys (EN + zh-CN)
  - Dashboard webview receives translated labels via inline `labels` object
- **LocalUsageService incremental scan fix** (`src/services/localUsageService.ts`)
  - `seenMessageIds` moved from global Set to local Set inside `scanAllFiles()`
  - Fixes short-tick data dropping to 0 after first scan

### Fixed
- **Today row msg showing `undefined`** (`src/services/scheduler.ts`)
  - `requestsToday` was missing from LOCAL_ESTIMATE dispatch payload in both short and long ticks
- **Percentage display inconsistency** (`src/presenters/statusBar.ts`, `src/presenters/dashboard.ts`)
  - statusBar, tooltip, and dashboard now all use `resolveWeeklyPct` / `resolveWindowPct`

## [0.1.4] - 2026-05-12

### Fixed
- **Language toggle stuck after first switch** (`src/presenters/dashboard.ts`)
  - Root cause: `toggleLanguage` did not await `setLanguage` before rebuilding HTML, causing race condition
  - Fix: extracted `doToggleLanguage()` async method; awaits `setLanguage()` then rebuilds HTML
- **COST and resets completely hidden** (`src/presenters/dashboard.ts`)
  - Root cause: frontend JS referenced backend function `fmtDuration` (not available in webview), causing `ReferenceError` that crashed the entire update handler
  - Fix: inlined `fmtDuration` into the webview `<script>` so it is self-contained
- **Time format non-compliant** (`src/calc.ts`, `src/presenters/dashboard.ts`)
  - Rule: large unit (XX) pads with space, small unit (YY) pads with zero, pure seconds (ZZ) pads with space
  - Examples: 5d3h → `" 5d03h"`, 5h3m → `" 5h03m"`, 5m3s → `" 5m03s"`, 5s → `" 5s"`, 0s → `" 0s"`
- **Tooltip table wrapping** (`src/i18n.ts`, `src/presenters/statusBar.ts`)
  - Shortened EN column headers: Input→In, Output→Out, CacheW→CW, CacheR→CR, Msgs→#, Cost→¥
- **30-second cache causing stale short-tick data** (`src/services/localUsageService.ts`, `src/services/scheduler.ts`)
  - Root cause: 30s TTL cache meant 5s short ticks always read stale data; percentage decimals never changed
  - Fix: removed TTL cache entirely. Replaced with incremental `fileStates: Map<filePath, {mtimeMs, size, entries}>`.
    - Each call enumerates files, checks mtime/size
    - Unchanged files reuse in-memory entries
    - Changed files are re-read entirely; old messageIds purged from dedup set
    - Aggregation recalculated from all in-memory entries (O(N), microseconds for 13k records)
  - Scheduler no longer passes `force: true`; `getLocalUsage()` is always incremental

### Changed
- **LocalUsageService architecture** (`src/services/localUsageService.ts`)
  - Deleted `cache`, `cacheAt`, `CACHE_TTL_MS`
  - Added `fileStates: Map<string, FileState>` and `seenMessageIds: Set<string>`
  - `getLocalUsage()` no longer accepts `force`; always performs incremental scan
  - `invalidate()` clears both `fileStates` and `seenMessageIds`
- **Scheduler short tick** (`src/services/scheduler.ts`)
  - Removed `force: true` from `getLocalUsage()` calls in both `doShortTick()` and `doLongTick()`

## [0.1.3] - 2026-05-12

### Fixed
- **Language toggle not switching back** (`src/presenters/dashboard.ts`)
  - Root cause: `toggleLanguage` used `effectiveLanguage` (resolves 'auto') instead of `language` (raw setting)
  - Fix: read raw `config.language`; if 'auto', resolve to concrete locale then flip
- **Tooltip not translated to Chinese** (`src/i18n.ts`, `src/presenters/statusBar.ts`)
  - Root cause: missing i18n keys `tooltip.table.quotaSummary` and `tooltip.table.col.parallel`
  - Fix: added both EN and zh-CN translations
- **Manual refresh not working** (`src/services/scheduler.ts`)
  - Root cause: `force()` did not reset `lastLongTick`, so the forced tick could be a short tick
  - Fix: `force()` now sets `lastLongTick = Date.now() - LONG_MS` guaranteeing a long tick (API fetch)
- **COST and resets on separate lines** (`src/presenters/dashboard.ts`)
  - Fix: merged into `.progress-meta-row` flex container with 16px gap
- **Short tick data never changing (percentage decimal always 0)** (`src/services/scheduler.ts`, `src/services/localUsageService.ts`)
  - Root cause: `localUsageService.getLocalUsage()` had a 30-second cache, so 5s short ticks always returned stale data
  - Fix: `getLocalUsage()` accepts `force?: boolean`; scheduler `doShortTick` passes `force: true`
- **Presenters illegally accessing disk** (`src/presenters/statusBar.ts`)
  - Root cause: `buildTooltip` called `LocalUsageService.getLocalUsage()` directly, violating "only scheduler reads disk"
  - Fix: scheduler now dispatches full local usage detail into `store.localEstimate`; tooltip reads from memory only
- **Setting descriptions missing ranges** (`package.json`)
  - Added range and behavior notes to every configuration property

### Changed
- **Extended `LocalEstimate` type** (`src/types.ts`)
  - Added 15 new fields: `tokensToday`, `tokensIn24h`, `tokensOut24h`, `tokensCacheRead24h`, `tokensCacheCreate24h`, `cost24h`, `requests24h`, `tokensIn7d`, `tokensOut7d`, `tokensCacheRead7d`, `tokensCacheCreate7d`, `requests7d`, `tokensThisCycle`, `costThisCycle`, `requestsThisCycle`
  - Presenters consume these from store; no direct disk access

### Tests
- Added `force() triggers a long tick` — verifies manual refresh hits API
- Added `short tick dispatches full usage detail` — verifies LOCAL_ESTIMATE payload contains all fields and `getLocalUsage` receives `force: true`
- 66 tests passing

## [0.1.2] - 2026-05-12

### Added
- **Reusable format functions** (`src/calc.ts`)
  - `drawBorderTable` / `displayWidth` / `padCell` — CJK-aware ASCII table drawing
  - Tooltip quota table and local usage table now use `drawBorderTable`
  - Local usage table includes **CacheR** column (was missing)
- **New skill: reusable-format-functions** (`.kimi/skills/reusable-format-functions/SKILL.md`)
  - Mandates extraction of any formatting logic used in more than one place
  - Forbidden: inline `padStart`/`padEnd`, inline duration formatting, inline table construction

### Fixed
- **Dashboard duration formatting** (`src/presenters/dashboard.ts`)
  - Replaced inline `fmtReset` with centralized `fmtDuration` from `src/calc.ts`
- **StatusBar inline buildBar/buildMiniBar** (`src/presenters/statusBar.ts`)
  - Removed duplicate inline definitions; now imports from `src/calc.ts`

### Changed
- **Design docs updated** (`docs/v2-phase1-implementation.md`)
  - Added `drawBorderTable` section in `calc.ts`
  - Added "可复用函数封装规范（强制）" chapter with function inventory
  - Updated `statusBar.ts` and `dashboard.ts` sections to match refactored code

## [0.1.1] - 2026-05-12

### Added
- **Dashboard button interactions** (`src/presenters/dashboard.ts`)
  - Refresh button shows "Refreshing..." disabled state during `isLoading`
  - Toggle mode button switches between `$ / %` and `% / $` labels
  - Language switch immediately rebuilds WebView HTML with new locale
  - Cost display elements (`cost-5h`, `cost-7d`) added with null-safe updates
- **Short refresh interval config** (`src/config.ts`, `package.json`)
  - New setting `kimiStatusPro.shortRefreshIntervalSeconds` (default 5s, range 1-60)
- **Scheduler short tick precision test** (`test/scheduler.test.ts`)
  - Validates 5s tick produces non-integer decimal estimates after calibration

### Fixed
- **Cost element missing in dashboard HTML** — JS referenced `cost-5h`/`cost-7d` but DOM elements did not exist, causing potential runtime errors
- **apiService test type cast** (`test/apiService.test.ts`) — `as sinon.SinonStub` → `as unknown as sinon.SinonStub` for TS strict mode

### Changed
- **Dashboard display mode** — progress labels now render `used/limit` in `absolute` mode, percentage in `percent` mode
- **Design docs updated** (`docs/v2-phase1-implementation.md`)
  - Updated `dashboard.ts` section with button interaction table and rebuilt HTML/JS
  - Added `shortRefreshIntervalSeconds` to `config.ts` and `package.json` sections

## [0.1.0] - 2026-05-12

### Added
- **Phase 2: Local estimation & calibration** (`src/services/localUsageService.ts`, `src/calc.ts`, `src/services/scheduler.ts`)
  - Full JSONL scan of `~/.kimi/sessions/**/wire.jsonl` with `StatusUpdate` parsing
  - Multi-window aggregation: today, 24h, 5h, 7d, current cycle
  - Deduplication by `message_id`
  - 30-second memory cache for scanned data
  - Token capacity calibration from `apiWeeklyUsedPct + localTokens`
  - Window cost capacity calibration from `apiWindowUsedPct + localCost5h`
  - Short tick (5s) local estimation without API calls
  - Long tick (60s) API fetch + automatic calibration
  - Calibration persistence in cache v2 schema (`src/services/cacheService.ts`)
  - Calibration validity check based on `resetAt` and 7-day expiration
  - Safe estimate wrapper with fallback to `used/limit` ratio
- **Status bar fallback to local estimate** (`src/presenters/statusBar.ts`)
  - Displays 🔍 estimate badge when API data is unavailable
  - Shows estimated percentages from `localEstimate` state
- **Dashboard estimate display** (`src/presenters/dashboard.ts`)
  - Progress bars render from `localEstimate` when no API quota
  - `(estimate)` badge shown next to window labels
- **New skill: test-driven-function** (`.kimi/skills/test-driven-function/SKILL.md`)
  - Enforces test-first workflow for complex/reusable/high-risk functions

### Tests
- Added 21 new tests (62 total, all passing)
  - `calibrateTokenCapacity` / `calibrateWindowCostCapacity`
  - `estimateWeeklyPct` / `estimateWindowPct`
  - `fallbackWeeklyPct` / `fallbackWindowPct`
  - `isCalibrationValid`
  - `LOCAL_ESTIMATE` reducer (creation, merge, dataSource behavior)
  - Scheduler Phase 2 integration (short/long tick)

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
