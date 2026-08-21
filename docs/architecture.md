# electron-sample-app 架构说明

## 1. 整体架构

Electron 34 桌面应用（HRms v2.4.0），将 HR 管理系统包装为原生 Windows 桌面应用。通过 `win.loadFile()` 加载静态 HTML 文件，不运行 HTTP 服务器。

```
┌──────────────────────────────────────────────────────────┐
│                   Electron Main Process                    │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │   App    │  │  Config  │  │  System  │  │  Window  │ │
│  │Lifecycle │  │ Manager  │  │  Info    │  │ Manager  │ │
│  └──────────┘  └──────────┘  └──────────┘  └────┬─────┘ │
│                                                  │       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │       │
│  │   Auth   │  │   IPC    │  │ Network  │       │       │
│  │ (JWT)    │  │ Handlers │  │  Proxy   │       │       │
│  └──────────┘  └──────────┘  └──────────┘       │       │
│                                                  │       │
│                    preload.js (contextBridge)     │       │
│  ┌───────────────────────────────────────────────┘       │
│  │                                                        │
│  │  window.electronAPI                                    │
│  │  { navigate, proxyRequest, saveTokens, ... }           │
│  │                                                        │
└──┼────────────────────────────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────────────────────────────┐
│                Renderer Process (Chromium)                 │
│                                                          │
│  ┌─────────────────┐        ┌─────────────────────────┐  │
│  │  login.html     │        │  [hash].html             │  │
│  │  (设备认证+登录) │  ────▶ │  (业务应用 / EHR 页面)    │  │
│  │  login-page     │        │  front-2.1               │  │
│  └─────────────────┘        └─────────────────────────┘  │
│         │                            │                    │
│         └──────────┬─────────────────┘                    │
│                    │ API 调用                              │
│                    ▼                                       │
│         window.electronAPI.proxyRequest()                  │
│                    │                                       │
└────────────────────┼───────────────────────────────────────┘
                     │
                     ▼
         ┌─────────────────────┐
         │  nestjs-3.6         │
         │  server-1 (:3000)   │
         └─────────────────────┘
```

## 2. 模块架构

主进程（`src/main.js`，约 275 行）编排 7 个模块：

### 2.1 应用生命周期 (`src/modules/app/`)

- **AppLifecycle.js** — 管理 Squirrel 事件（Windows 安装/更新）、全局快捷键、应用菜单、`app.whenReady` 启动入口

### 2.2 认证模块 (`src/modules/auth/`)

- **DeviceJwtGenerator.js** — 从系统信息（MAC、CPU ID、Device ID）生成设备 JWT
- **JwtVerifier.js** — RSA 公钥 JWT 验证（使用 `jose` 库），设备绑定校验
- **TokenManager.js** — 加密 Token 存储（AES-256-CBC + Electron safeStorage），过期前 5 分钟自动刷新，60s 内存缓存 TTL

### 2.3 配置管理 (`src/modules/config/`)

- **ConfigManager.js** — electron-store 封装，提供 get/set/reset/updateMultiple 操作

### 2.4 IPC 通信 (`src/modules/ipc/`)

- **IpcHandlers.js** — 所有 IPC 处理器注册：认证、Token、配置、网络、导航、窗口控制

### 2.5 网络模块 (`src/modules/network/`)

- **RequestProxy.js** — 主进程 HTTP 代理（`net.fetch`），自动添加 `Authorization` 头，401 自动刷新 Token 并重试，并发请求去重
- **UrlInterceptor.js** — `webRequest.onBeforeRequest` 拦截器，修复 `file://` 协议下的 protocol-relative URL，注入 CORS 头

### 2.6 系统信息 (`src/modules/system/`)

- **SystemInfo.js** — 采集 MAC 地址、CPU ID、设备 ID、磁盘序列号

### 2.7 窗口管理 (`src/modules/window/`)

- **WindowManager.js** — BrowserWindow 创建/导航/加载覆盖层/标题栏注入，持久化 `lastVisitedUrl`
- **format.js** — 窗口格式化工具

## 3. 启动流程

```
app.whenReady
  │
  ▼
createWindow()
  ├── ConfigManager 初始化
  ├── SystemInfo 初始化
  ├── TokenManager 初始化
  ├── JwtVerifier 初始化
  ├── RequestProxy 初始化
  ├── UrlInterceptor 注册
  ├── IpcHandlers 注册
  │
  ▼
WindowManager.createWindow()
  ├── 创建 BrowserWindow（1920x1080，生产环境无边框）
  ├── 注入自定义标题栏 HTML/CSS/JS
  │
  ▼
loadStartPage()
  ├── DIRECT_LOAD_LAST_PAGE + 有效 refreshToken → 恢复上次页面
  └── 否则 → loadLoginPage() → dist/login.html
       │
       ▼
     did-finish-load → onPageLoaded()
       ├── JWT 有效 + refreshToken 有效 → 'login-validated'（自动导航到业务页）
       ├── JWT 有效 + refreshToken 过期 → 'jwt-validated'（跳过设备认证）
       └── JWT 无效 → 'jwt-validated: false'（完整认证流程）
```

## 4. IPC 通信模式

```
渲染进程 (Renderer)                    主进程 (Main)
  │                                       │
  │  window.electronAPI.proxyRequest()    │
  │ ──────────────────────────────────▶  │
  │  {                                    │  ipcMain.handle('proxy-request')
  │    url, method, headers, data         │    │
  │  }                                    │    ├── RequestProxy.send()
  │                                       │    │   ├── 添加 Auth header
  │                                       │    │   ├── net.fetch(url, opts)
  │                                       │    │   ├── 401? → refresh token → retry
  │  ◀────────────────────────────────── │    │   └── 返回响应
  │  响应数据                              │    │
  │                                       │
```

preload.js 通过 `contextBridge.exposeInMainWorld` 暴露 `window.electronAPI`：

| 类别 | API 方法 |
|------|---------|
| 认证 | `getMAC`, `checkJwt`, `saveJwt`, `saveTokens`, `getAccessToken`, `getRefreshToken`, `logout`, `verifyStoredJwt`, `clearLastVisited` |
| 导航 | `navigate`, `navigateTo`, `navigateToExample`, `goBack`, `goForward`, `reload` |
| 配置 | `getConfig`, `setConfig`, `updateConfigs`, `resetConfig` |
| 窗口 | `windowMinimize`, `windowMaximize`, `windowClose`, `windowIsMaximized`, `onWindowMaximizeChange` |
| 网络 | `proxyRequest` |
| 其他 | `openExternal`, `getCurrentPage`, `onJwtValidated`, `onLoginValidated`, `setZoomFactor`, `getZoomFactor` |

## 5. Token 安全存储

```
TokenManager
  │
  ├── 存储层:
  │   ├── electron-store (持久化)
  │   │   └── AES-256-CBC 加密 (Node crypto)
  │   └── Electron safeStorage (系统级加密)
  │
  ├── 内存缓存:
  │   ├── accessToken (60s TTL)
  │   └── refreshToken
  │
  └── 自动刷新:
      └── accessToken 过期前 5 分钟 → POST /auth/refresh
```

`safeStorage` 在 Windows 上使用 DPAPI 加密，确保 Token 在磁盘上不可直接读取。

## 6. 环境配置

| 文件 | 使用场景 | SERVER 值 |
|------|---------|-----------|
| `env.config.js` | 开发（`npm start`） | `localhost:3000` |
| `env.prod.config.js` | 生产（打包后） | `119.23.253.225:80` |

关键配置键：`SERVER`、`SERVER_PORT`、`RSA_PUBLIC_KEY`、`ENCRYPTION_KEY`、`DIRECT_LOAD_LAST_PAGE`、`DEVTOOLS_NETWORK_VISIBLE`。

## 7. 构建输出结构

```
dist/
├── login.html              # 登录页（来自 ../login-page/dist/login.html）
├── [contenthash].html      # 业务页面（来自 ../front-2.1/dist/）
├── asset/
│   ├── css/                # 样式文件
│   └── js/                 # JS 打包文件
└── win-unpacked/           # 解包后的 Electron 应用（electron-builder）
```

**关键依赖：** `dist/` 目录必须同时包含 `login-page` 和 `front-2.1` 的构建产物，这两个来自独立的构建流程。

## 8. 模块依赖图

```
main.js
  ├── AppLifecycle
  │     └── WindowManager
  ├── ConfigManager ← electron-store
  ├── SystemInfo
  │     └── DeviceJwtGenerator
  ├── TokenManager ← ConfigManager, crypto, safeStorage
  ├── JwtVerifier ← ConfigManager, jose, SystemInfo
  ├── RequestProxy ← ConfigManager, TokenManager
  ├── UrlInterceptor ← WindowManager
  └── IpcHandlers ← TokenManager, JwtVerifier, ConfigManager,
                     RequestProxy, WindowManager, SystemInfo,
                     DeviceJwtGenerator
```
