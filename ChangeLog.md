## [Unreleased]

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
  - VSIX package: `kimi-status-pro-0.4.0.vsix` (45.65 KB)
  - `.vscodeignore` for clean packaging
  - `.gitignore` for repository hygiene
