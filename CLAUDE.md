# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Electron 34 desktop application (`HRms` v2.4.0) that wraps the HR管理系统 as a native Windows application. It loads static HTML files from `dist/` using `win.loadFile()` — it does NOT run an HTTP server.

## Commands

```bash
npm start              # Run Electron app directly (electron .)
npm run start:utf8     # Run with UTF-8 console encoding (for Chinese characters)
npm run build          # Build Windows installer via electron-builder (NSIS)
npm run dist           # Build Windows x64 via electron-builder
npm run package        # Package via electron-forge (NODE_ENV=production)
npm run make           # Make installer via electron-forge (300s timeout)
npm test               # Jest tests
```

## Architecture: Module System

The main process (`src/main.js`, ~275 lines) orchestrates 7 modules, each in `src/modules/<category>/`:

```
src/
├── main.js                     # Entry: imports modules, orchestrates startup
└── modules/
    ├── app/
    │   └── AppLifecycle.js     # Squirrel events, global shortcuts, app menu, app.whenReady
    ├── auth/
    │   ├── DeviceJwtGenerator.js  # Generate device JWT from system info
    │   ├── JwtVerifier.js         # RSA public key JWT verification + device binding
    │   └── TokenManager.js        # Encrypted token storage, auto-refresh (5min before expiry)
    ├── config/
    │   └── ConfigManager.js    # electron-store wrapper: get/set/reset/updateMultiple
    ├── ipc/
    │   └── IpcHandlers.js      # All IPC handlers: auth, tokens, config, network, navigation, window
    ├── network/
    │   ├── RequestProxy.js     # HTTP proxy via net.fetch: auto token refresh on 401, dedup
    │   └── UrlInterceptor.js   # webRequest interceptor: inject Auth header, fix protocol-relative URLs, CORS
    ├── system/
    │   └── SystemInfo.js       # Collect MAC, CPU ID, device ID, disk serial
    └── window/
        ├── WindowManager.js    # BrowserWindow creation, navigation, loading overlay, titlebar injection
        └── format.js           # Window formatting utilities
```

## Key Modules

### WindowManager (`src/modules/window/WindowManager.js`)

- Creates 1920x1080 frameless window (production) with custom titlebar
- `loadLoginPage()` — loads `dist/login.html` (from login-page build)
- `loadStartPage()` — checks if previous session can be restored (valid refreshToken → restore last URL)
- `navigate(htmlPath)` — loads `dist/[hash].html` (from front-2.1 build)
- `loadUrl(url)` — normalizes and loads any URL
- Injects custom titlebar HTML/CSS/JS into loaded pages (for frameless window controls)
- Persists `lastVisitedUrl` to electron-store

### TokenManager (`src/modules/auth/TokenManager.js`)

- Encrypted storage via Node `crypto` (AES-256-CBC) + Electron `safeStorage`
- Auto-refreshes access token 5 minutes before expiry
- In-memory cache with 60s TTL
- `saveTokens(accessToken, refreshToken, indexUrl, persistLogin)` — persist or session-only

### JwtVerifier (`src/modules/auth/JwtVerifier.js`)

- RSA public key verification using `jose` library (dynamic import)
- Device binding check: verifies JWT claims (MAC, cpuId, deviceId) match current system
- `verifyJwt(jwt)` → `{ valid, payload, error }`

### RequestProxy (`src/modules/network/RequestProxy.js`)

- Proxies renderer HTTP requests through main process via `net.fetch()`
- Adds `Authorization: Bearer {token}` header automatically
- On 401: triggers token refresh, retries request once
- Request deduplication for concurrent identical requests

### UrlInterceptor (`src/modules/network/UrlInterceptor.js`)

- `webRequest.onBeforeRequest` listener
- Fixes protocol-relative URLs (`//at.alicdn.com/...` → `https://...`) when loaded via `file://`
- Injects CORS headers for `file://` origin requests

## Preload Script (`preload.js`)

Exposes `window.electronAPI` via `contextBridge.exposeInMainWorld`:

**Auth:** `getMAC`, `checkJwt`, `saveJwt`, `saveTokens`, `getAccessToken`, `getRefreshToken`, `logout`, `verifyStoredJwt`, `clearLastVisited`

**Navigation:** `navigate`, `navigateTo`, `navigateToExample`, `goBack`, `goForward`, `reload`

**Config:** `getConfig`, `setConfig`, `updateConfigs`, `resetConfig`

**Window:** `windowMinimize`, `windowMaximize`, `windowClose`, `windowIsMaximized`, `onWindowMaximizeChange`

**Other:** `proxyRequest`, `openExternal`, `getCurrentPage`, `onJwtValidated`, `onLoginValidated`, `setZoomFactor`, `getZoomFactor`

## Environment Configuration

Three files, loaded by `env.loader.js` based on `NODE_ENV` / `app.isPackaged`:

| File | When Used | SERVER |
|------|-----------|--------|
| `env.config.js` | Development (`npm start`) | `localhost:3000` |
| `env.prod.config.js` | Production (packaged) | `119.23.253.225:80` |

Key config keys: `SERVER`, `SERVER_PORT`, `RSA_PUBLIC_KEY`, `ENCRYPTION_KEY`, `LOG_*`, `DIRECT_LOAD_LAST_PAGE`, `DEVTOOLS_NETWORK_VISIBLE`.

## Startup Flow

```
1. AppLifecycle: app.whenReady → createWindow()
2. WindowManager.createWindow(): BrowserWindow + loadStartPage()
3. loadStartPage():
   ├── DIRECT_LOAD_LAST_PAGE enabled + valid refreshToken → restore last URL
   └── Otherwise → loadLoginPage() → dist/login.html
4. did-finish-load → onPageLoaded():
   ├── Valid JWT + valid refreshToken → send 'login-validated' (auto-navigate)
   ├── Valid JWT + expired refreshToken → send 'jwt-validated' (skip device auth)
   └── No valid JWT → send 'jwt-validated: false' (full auth flow)
```

## Build Output (`dist/`)

Contains the built frontend assets loaded at runtime:
- `dist/login.html` — Login page entry (from `../login-page/dist/login.html`)
- `dist/[contenthash].html` — Business app pages (from `../front-2.1/dist/`)
- `dist/asset/css/`, `dist/asset/js/` — Frontend bundles

**Important:** The `dist/` directory must contain BOTH login-page AND front-2.1 build outputs. These come from separate build processes in separate projects.

## Build & Distribution

- **electron-builder** (primary): NSIS Windows installer, appId `com.zyukyun.hrm`, product name `HR管理系统`
- **electron-forge** (secondary): Used for dev packaging with webpack plugin
- Output: `release/HR管理系统 Setup x.x.x.exe`
- ASAR packaging with `electron-store` and `jose` unpacked

## Tech Stack

Electron 34.2.0, electron-builder 26, electron-forge 7.6, electron-store 10, jose 6, Jest 30, fast-check 4.5.

## Related Projects

- `../login-page/` — Login page source (build output consumed here)
- `../front-2.1/` — Business app source (build output consumed here)
- `../nestjs-3.6/` — Backend API (all API calls proxy here)
