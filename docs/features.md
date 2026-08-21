# electron-sample-app 功能说明

## 1. 桌面应用壳（Desktop Wrapper）

将 Web 版 HR 管理系统包装为原生 Windows 桌面应用。

**核心能力：**
- 原生窗口：基于 Electron 34 的无边框窗口（1920x1080）
- 本地文件加载：通过 `win.loadFile()` 加载静态 HTML，无需 HTTP 服务器
- 自定义标题栏：自动注入 Windows 风格标题栏（最小化/最大化/关闭按钮）
- 加载覆盖层：页面加载期间显示加载动画
- 窗口状态管理：最大化/还原状态跟踪和持久化

## 2. 设备认证

基于设备指纹的安全认证机制。

**核心能力：**
- 设备指纹采集：收集 MAC 地址、CPU ID、设备 ID、磁盘序列号
- 设备 JWT 生成：用系统信息生成设备级别的 JWT
- 设备绑定校验：验证 JWT 中的设备信息与当前系统匹配
- 双因素认证流程：设备认证通过后再进行用户登录

## 3. JWT Token 管理

多层次的安全 Token 存储和自动维护。

**核心能力：**
- 加密存储：AES-256-CBC（Node crypto）+ Electron safeStorage（Windows DPAPI）
- 内存缓存：60 秒 TTL 的 Token 内存缓存，减少解密开销
- 自动刷新：accessToken 过期前 5 分钟自动调用 `/auth/refresh`
- 会话持久化：`persistLogin=true` 时 Token 持久化到磁盘
- 安全登出：清除所有存储的 Token 和会话信息
- RSA 公钥验证：使用 `jose` 库验证 RS256 签名

## 4. HTTP 请求代理

主进程代理所有渲染进程的 HTTP 请求，解决 `file://` 协议下的跨域限制。

**核心能力：**
- 透明代理：通过 `net.fetch()` 在主进程发起 HTTP 请求
- 自动认证：每个请求自动添加 `Authorization: Bearer {token}` 头
- 401 自动恢复：收到 401 响应时自动刷新 Token 并重试请求（重试 1 次）
- 请求去重：并发相同请求自动去重，避免重复网络调用
- IPC 封装：渲染进程通过 `window.electronAPI.proxyRequest()` 调用

## 5. URL 拦截与重写

自动修复 `file://` 协议下的 URL 问题。

**核心能力：**
- Protocol-relative URL 修复：`//at.alicdn.com/...` → `https://at.alicdn.com/...`
- `/backend/` 路由重写：`/backend/xxx` → `http://{SERVER}:{PORT}/xxx`
- `/api/proxy/` 前缀添加：自动为哈希命名页面的 axios 请求添加代理前缀
- CORS 头注入：为 `file://` 来源的请求注入 CORS 响应头
- 兼容性：支持 axios、fetch、XMLHttpRequest 等所有浏览器 HTTP 请求

## 6. 窗口管理

完整的窗口创建和导航控制。

**核心能力：**
- 窗口创建：可配置大小、无边框模式的生产环境窗口
- 页面导航：`navigate(htmlPath)` 加载 `dist/` 中的页面
- 登录页加载：`loadLoginPage()` 加载 `dist/login.html`
- 起始页加载：`loadStartPage()` 智能判断是恢复会话还是显示登录页
- URL 加载：`loadUrl(url)` 归一化并加载任意 URL
- 导航历史：支持前进/后退/刷新
- 最后访问记录：持久化 `lastVisitedUrl` 到 electron-store

## 7. 会话恢复

智能恢复上次使用状态。

**核心能力：**
- 条件恢复：`DIRECT_LOAD_LAST_PAGE` 开关控制
- Token 验证：恢复前验证 refreshToken 有效性
- 页面恢复：有效 Token 时直接恢复到上次访问的页面
- 分级处理：
  - JWT 有效 + refreshToken 有效 → 自动导航
  - JWT 有效 + refreshToken 过期 → 跳过设备认证，直接进入登录
  - JWT 无效 → 完整认证流程

## 8. 配置管理

集中化的应用配置存储。

**核心能力：**
- 持久化存储：基于 electron-store 的 JSON 文件存储
- 动态配置：`get/set/reset/updateMultiple` 操作
- 敏感信息加密：Token 和密钥加密存储
- 环境区分：开发环境（`env.config.js`）和生产环境（`env.prod.config.js`）独立配置

## 9. 调试支持

**核心能力：**
- DevTools：通过 `DEVTOOLS_NETWORK_VISIBLE` 配置控制 DevTools 可见性
- 断点调试：支持源码映射，VS Code launch.json 配置
- 日志系统：分级日志输出（`LOG_LEVEL` 配置）
- UTF-8 控制台：`npm run start:utf8` 支持中文日志输出

## 10. 跨项目集成

**核心能力：**
- login-page 集成：加载 `../login-page/dist/login.html` 作为登录入口
- front-2.1 集成：加载 `../front-2.1/dist/*.html` 作为业务应用
- nestjs-3.6 集成：所有 API 调用代理到 nestjs-3.6/server-1
- 构建链路：login-page → front-2.1 → electron-sample-app 的 dist 文件同步
