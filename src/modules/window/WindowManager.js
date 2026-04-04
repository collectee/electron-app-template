/**
 * 窗口管理模块
 * 负责Electron窗口的创建、管理和导航
 */

const { BrowserWindow, BrowserView, Menu, app } = require('electron');
const path = require('path');

const log = require('../../utils/logger');

/**
 * 窗口管理器类
 * 提供窗口创建、加载界面、导航等功能
 */
class WindowManager {
  constructor() {
    this.win = null;
    this.loadingView = null;
    this.dataStore = null; // 用于持久化最后访问的页面
  }

  /**
   * 设置数据存储实例（用于记录最后访问的页面）
   * @param {Object} store - electron-store 实例
   */
  setDataStore(store) {
    this.dataStore = store;
  }

  /**
   * 创建主应用窗口
   * @returns {BrowserWindow} 创建的窗口实例
   */
  createWindow() {
    log.info('创建主窗口');

    const isProduction = app.isPackaged;

    if (isProduction) {
      Menu.setApplicationMenu(null);
    }

    this.win = new BrowserWindow({
      width: 1920,
      height: 1080,
      backgroundColor: '#ffffff',
      show: false,
      frame: !isProduction,
      webPreferences: {
        preload: path.join(__dirname, '../../../preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        enableRemoteModule: false,
        devTools: !isProduction,
        backgroundThrottling: false
      },
    });

    // 主窗口创建完成
    // 提高监听器上限，避免 MaxListenersExceededWarning
    // （窗口事件、导航跟踪、加载覆盖层等合计超过默认的 10 个）
    this.win.setMaxListeners(20);

    // 设置协议处理
    this.setupProtocolHandler();

    // 设置窗口事件监听器
    this.setupWindowEventListeners();

    // 设置页面导航记录（用于恢复关闭前的页面）
    this.setupNavigationTracking();

    // 设置加载界面
    this.setupLoadingInterface();

    return this.win;
  }

  /**
   * 设置协议处理器
   */
  setupProtocolHandler() {
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('hrms', process.execPath, [path.resolve(process.argv[1])]);
      }
    } else {
      app.setAsDefaultProtocolClient('hrms');
    }
  }

  /**
   * 设置窗口事件监听器
   */
  setupWindowEventListeners() {
    // 当内容加载完成后再显示窗口
    this.win.once('ready-to-show', () => {
      this.hideLoadingOverlay();
      this.win.show();
      if (!app.isPackaged) {
        this.win.webContents.openDevTools();
      }
    });

    // 监听页面导航与加载阶段，显示/隐藏加载覆盖层
    this.win.webContents.on('did-start-navigation', () => {
      this._navStartTime = Date.now();
      this.showLoadingOverlay();
    });

    // 拦截页面导航，规范化哈希命名的 file:// URL（补充 .html 扩展名）
    this.win.webContents.on('will-navigate', (event, navigationUrl) => {
      const normalized = this.normalizeFileUrl(navigationUrl);
      if (normalized !== navigationUrl) {
        log.info('[导航] URL已规范化:', navigationUrl, '->', normalized);
        event.preventDefault();
        this.win.loadURL(normalized);
      }
    });
    this.win.webContents.on('did-start-loading', () => {
      this.showLoadingOverlay();
    });
    this.win.webContents.on('dom-ready', () => {
      this.hideLoadingOverlay();
    });
    this.win.webContents.on('did-stop-loading', () => {
      this.hideLoadingOverlay();
    });
    // 窗口大小改变时调整加载界面
    this.win.on('resize', () => {
      if (!this.loadingView) return;
      try {
        const attached = (typeof this.win.getBrowserViews === 'function') ?
          this.win.getBrowserViews().includes(this.loadingView) : false;
        if (attached) {
          const bounds = this.win.getContentBounds();
          this.loadingView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
        }
      } catch {}
    });

    // 添加页面加载错误处理
    this.win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      this.hideLoadingOverlay();
      log.error('页面加载失败:', { errorCode, errorDescription });
      // 尝试重新加载页面
      setTimeout(() => {
        log.info('尝试重新加载页面');
        this.loadLoginPage();
      }, 1000);
    });

    // 监听渲染进程错误
    this.win.webContents.on('render-process-gone', (event, details) => {
      log.error('渲染进程崩溃:', details);
      // 尝试重新创建窗口
      setTimeout(() => {
        log.info('尝试重新创建窗口');
        this.createWindow();
      }, 1000);
    });

    this.win.webContents.on('did-finish-load', async () => {
      const navDuration = Date.now() - this._navStartTime;
      log.warn(`[导航诊断] 本次导航耗时 ${navDuration}ms`);

      if (app.isPackaged) {
        this.injectCustomTitleBar();
      }
    });
  }

  /**
   * 在无边框窗口中注入自定义标题栏（仅生产环境）
   * 每次页面加载完成后调用，通过 insertCSS + executeJavaScript 动态注入
   */
  async injectCustomTitleBar() {
    if (!this.win) return;
    try {
      await this.win.webContents.insertCSS(this.getTitleBarCSS());
      await this.win.webContents.executeJavaScript(this.getTitleBarJS());
    } catch (err) {
      log.error('注入自定义标题栏失败:', err.message);
    }
  }

  getTitleBarCSS() {
    return `
      #electron-custom-titlebar {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: 32px;
        background: #f0f0f0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        -webkit-app-region: drag;
        z-index: 99999;
        user-select: none;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-size: 12px;
        color: #333;
        border-bottom: 1px solid #ddd;
      }
      #electron-custom-titlebar .titlebar-title {
        padding-left: 12px;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #electron-custom-titlebar .titlebar-controls {
        display: flex;
        height: 100%;
        -webkit-app-region: no-drag;
      }
      #electron-custom-titlebar .titlebar-btn {
        width: 46px;
        height: 100%;
        border: none;
        background: transparent;
        color: #333;
        font-size: 11px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s;
        outline: none;
      }
      #electron-custom-titlebar .titlebar-btn:hover {
        background: #e0e0e0;
      }
      #electron-custom-titlebar .titlebar-btn.close:hover {
        background: #e81123;
        color: #fff;
      }
      #electron-custom-titlebar .titlebar-btn svg {
        width: 10px;
        height: 10px;
        fill: currentColor;
      }
      body {
        padding-top: 32px !important;
      }
    `;
  }

  getTitleBarJS() {
    return `(function() {
      if (document.getElementById('electron-custom-titlebar')) return;
      var bar = document.createElement('div');
      bar.id = 'electron-custom-titlebar';
      bar.innerHTML = \`
        <div class="titlebar-title">\${document.title || 'HR管理系统'}</div>
        <div class="titlebar-controls">
          <button class="titlebar-btn minimize" title="最小化">
            <svg viewBox="0 0 10 1"><rect width="10" height="1"/></svg>
          </button>
          <button class="titlebar-btn maximize" title="最大化">
            <svg viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>
          </button>
          <button class="titlebar-btn close" title="关闭">
            <svg viewBox="0 0 10 10">
              <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/>
              <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2"/>
            </svg>
          </button>
        </div>
      \`;
      document.body.prepend(bar);
      bar.querySelector('.minimize').addEventListener('click', function() {
        window.electronAPI.windowMinimize();
      });
      bar.querySelector('.maximize').addEventListener('click', function() {
        window.electronAPI.windowMaximize();
      });
      bar.querySelector('.close').addEventListener('click', function() {
        window.electronAPI.windowClose();
      });
      window.electronAPI.onWindowMaximizeChange(function(isMax) {
        var btn = bar.querySelector('.maximize');
        if (isMax) {
          btn.innerHTML = '<svg viewBox="0 0 10 10"><rect x="2" y="0" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1"/><rect x="0" y="2" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
          btn.title = '还原';
        } else {
          btn.innerHTML = '<svg viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
          btn.title = '最大化';
        }
      });
    })();`;
  }

  /**
   * 设置页面导航记录
   * 监听页面导航事件，将最后访问的业务页面路径持久化
   * 用于下次启动时恢复关闭前的页面
   */
  setupNavigationTracking() {
    if (!this.dataStore) {
      log.warn('dataStore 未设置，无法记录页面导航');
      return;
    }

    // 监听主框架导航
    this.win.webContents.on('did-navigate', (event, url) => {
      this.saveLastVisitedUrl(url);
    });

    // 监听页面内导航（SPA hash路由等）
    this.win.webContents.on('did-navigate-in-page', (event, url) => {
      this.saveLastVisitedUrl(url);
    });
  }

  /**
   * 保存最后访问的页面URL
   * 排除登录页面，只记录业务页面
   * @param {string} url - 页面URL
   */
  saveLastVisitedUrl(url) {
    if (!this.dataStore) return;

    // 排除登录页面
    if (url.includes('login.html')) return;
    // 排除空白页和data协议页面
    if (!url || url.startsWith('data:') || url === 'about:blank') return;

    try {
      this.dataStore.set('lastVisitedUrl', url);
      // 写入后立即回读验证
      const verify = this.dataStore.get('lastVisitedUrl');
      log.info('[导航] 记录页面:', url, '| 回读验证:', verify === url ? '一致' : `不一致(${verify})`);
    } catch (error) {
      log.error('保存最后访问页面失败:', error);
    }
  }

  /**
   * 获取最后访问的页面URL
   * @returns {string|null} 最后访问的URL或null
   */
  getLastVisitedUrl() {
    if (!this.dataStore) {
      log.warn('[导航] getLastVisitedUrl: dataStore 未设置');
      return null;
    }
    try {
      const url = this.dataStore.get('lastVisitedUrl');
      log.info('[导航] getLastVisitedUrl: 读取到 =', url || '(空)');
      return url || null;
    } catch (error) {
      log.error('获取最后访问页面失败:', error);
      return null;
    }
  }

  /**
   * 清除最后访问的页面记录
   */
  clearLastVisitedUrl() {
    if (!this.dataStore) return;
    try {
      this.dataStore.delete('lastVisitedUrl');
      // 已清除最后访问页面记录
    } catch (error) {
      log.error('清除最后访问页面记录失败:', error);
    }
  }

  /**
   * 规范化 file:// URL，确保哈希命名的页面路径包含 .html 扩展名
   * 例如：file:///D:/dist/7959445c...?token=null -> file:///D:/dist/7959445c....html?token=null
   * @param {string} url
   * @returns {string}
   */
  normalizeFileUrl(url) {
    if (!url || !url.startsWith('file://')) return url;
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const lastSegment = pathname.split('/').pop();
      // 如果路径末段是哈希命名（32位以上十六进制）且没有扩展名，补充 .html
      if (lastSegment && /^[0-9a-f]{32,}$/i.test(lastSegment)) {
        urlObj.pathname = pathname + '.html';
        return urlObj.toString();
      }
    } catch (e) {
      // ignore
    }
    return url;
  }

  /**
   * 加载指定URL（用于恢复上次页面）
   * @param {string} url - 要加载的URL
   * @returns {Promise} 加载结果
   */
  loadUrl(url) {
    const startTime = Date.now();
    try {
      const normalizedUrl = this.normalizeFileUrl(url);
      if (normalizedUrl !== url) {
        log.info('[导航] URL已规范化:', url, '->', normalizedUrl);
      }
      log.info('[导航] 加载:', normalizedUrl);
      this.showLoadingOverlay();
      return this.win.loadURL(normalizedUrl).then(() => {
        log.info(`[导航耗时] 加载URL完成，耗时 ${Date.now() - startTime}ms | ${normalizedUrl}`);
      }).catch(err => {
        log.error(`[导航耗时] 加载URL失败，耗时 ${Date.now() - startTime}ms | ${normalizedUrl}`, err);
        this.loadLoginPage();
      });
    } catch (error) {
      log.error(`[导航耗时] 加载URL异常，耗时 ${Date.now() - startTime}ms`, error);
      this.loadLoginPage();
    }
  }

  /**
   * 设置加载界面（仅显示loading，不加载具体页面）
   */
  setupLoadingInterface() {
    this.showLoadingOverlay();
  }

  /**
   * 加载启动页面
   * 根据token状态决定加载登录页还是恢复上次页面
   * 由外部调用，传入决策结果
   * @param {string|null} restoreUrl - 要恢复的URL，null则加载登录页
   */
  loadStartPage(restoreUrl) {
    if (restoreUrl) {
      log.info('[导航] 恢复页面:', restoreUrl);
      this.loadUrl(restoreUrl);
    } else {
      this.loadLoginPage();
    }
  }

  /**
   * 确保加载视图存在
   * @returns {BrowserView} 加载视图
   */
  ensureLoadingView() {
    if (this.loadingView) return this.loadingView;

    this.loadingView = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      }
    });

    const loadingHtml = this.getLoadingHtml();
    try {
      this.loadingView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHtml)}`);
    } catch {}

    return this.loadingView;
  }

  /**
   * 获取加载界面HTML
   * @returns {string} 加载界面的HTML内容
   */
  getLoadingHtml() {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;">
  <style>
    html, body {
      height: 100%;
      margin: 0;
      background: #ffffff;
      color: #000;
      overflow: hidden;
    }

    .wrap {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    }

    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      position: relative;
    }

    /* 主加载动画 */
    .spinner-container {
      position: relative;
      width: 80px;
      height: 80px;
      margin-bottom: 32px;
    }

    .spinner {
      width: 80px;
      height: 80px;
      border: 3px solid rgba(79, 154, 241, 0.1);
      border-top: 3px solid #4e9af1;
      border-radius: 50%;
      animation: spin 1.2s cubic-bezier(0.4, 0.0, 0.2, 1) infinite;
      position: relative;
    }

    .spinner::before {
      content: '';
      position: absolute;
      top: -3px;
      left: -3px;
      right: -3px;
      bottom: -3px;
      border: 3px solid transparent;
      border-top: 3px solid rgba(79, 154, 241, 0.3);
      border-radius: 50%;
      animation: spin 2s cubic-bezier(0.4, 0.0, 0.2, 1) infinite reverse;
    }

    /* 内部装饰圆点 */
    .inner-dot {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 8px;
      height: 8px;
      background: #4e9af1;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      animation: pulse 1.5s ease-in-out infinite;
    }

    /* 脉冲波纹效果 */
    .ripple {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 120px;
      height: 120px;
      border: 1px solid rgba(79, 154, 241, 0.2);
      border-radius: 50%;
      transform: translate(-50%, -50%);
      animation: ripple 2s ease-out infinite;
    }

    .ripple:nth-child(2) {
      animation-delay: 0.5s;
    }

    .ripple:nth-child(3) {
      animation-delay: 1s;
    }

    /* 文字样式 */
    .tip {
      text-align: center;
      color: #333;
      font-size: 16px;
      font-weight: 500;
      letter-spacing: 0.5px;
      opacity: 0;
      animation: fadeInUp 0.8s ease-out 0.5s forwards;
    }

    .subtitle {
      margin-top: 8px;
      font-size: 13px;
      color: #666;
      font-weight: 400;
      opacity: 0;
      animation: fadeInUp 0.8s ease-out 0.8s forwards;
    }

    /* 背景装饰元素 */
    .bg-decoration {
      position: absolute;
      width: 300px;
      height: 300px;
      border: 1px solid rgba(79, 154, 241, 0.05);
      border-radius: 50%;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      animation: rotate 20s linear infinite;
    }

    .bg-decoration::before {
      content: '';
      position: absolute;
      width: 200px;
      height: 200px;
      border: 1px solid rgba(79, 154, 241, 0.08);
      border-radius: 50%;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      animation: rotate 15s linear infinite reverse;
    }

    /* 动画定义 */
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    @keyframes pulse {
      0%, 100% {
        transform: translate(-50%, -50%) scale(0.8);
        opacity: 1;
      }
      50% {
        transform: translate(-50%, -50%) scale(1.2);
        opacity: 0.6;
      }
    }

    @keyframes ripple {
      0% {
        transform: translate(-50%, -50%) scale(0.8);
        opacity: 0.6;
      }
      100% {
        transform: translate(-50%, -50%) scale(1.5);
        opacity: 0;
      }
    }

    @keyframes fadeInUp {
      0% {
        opacity: 0;
        transform: translateY(20px);
      }
      100% {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes rotate {
      0% { transform: translate(-50%, -50%) rotate(0deg); }
      100% { transform: translate(-50%, -50%) rotate(360deg); }
    }

    /* 响应式设计 */
    @media (max-width: 480px) {
      .spinner-container {
        width: 60px;
        height: 60px;
      }

      .spinner {
        width: 60px;
        height: 60px;
      }

      .tip {
        font-size: 14px;
      }

      .subtitle {
        font-size: 12px;
      }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="bg-decoration"></div>
    <div class="loading-container">
      <div class="spinner-container">
        <div class="ripple"></div>
        <div class="ripple"></div>
        <div class="ripple"></div>
        <div class="spinner">
          <div class="inner-dot"></div>
        </div>
      </div>
      <div class="tip">正在加载应用</div>
      <div class="subtitle">请稍候，马上就好...</div>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * 显示加载覆盖层
   */
  showLoadingOverlay() {
    if (!this.win) return;
    const view = this.ensureLoadingView();
    if (!view) return;
    try {
      this.win.setBrowserView(view);
      const bounds = this.win.getContentBounds();
      view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
      view.setAutoResize({ width: true, height: true });
    } catch {}
  }

  /**
   * 隐藏加载覆盖层
   */
  hideLoadingOverlay() {
    if (!this.win || !this.loadingView) return;
    try {
      // 仅在叠加层已附加时移除
      const attached = (typeof this.win.getBrowserViews === 'function') ?
        this.win.getBrowserViews().includes(this.loadingView) : false;
      if (attached) {
        this.win.setBrowserView(null);
      }
    } catch {}
  }

  /**
   * 加载登录页面
   */
  loadLoginPage() {
    const startTime = Date.now();
    try {
      let loginPath;
      if (app.isPackaged) {
        // 打包后 dist 在 asar 归档内，通过 app.getAppPath() 访问
        loginPath = path.join(app.getAppPath(), 'dist', 'login.html');
      } else {
        // 在开发环境中使用 __dirname
        loginPath = path.join(__dirname, '../../../dist', 'login.html');
      }

      log.info('[导航] 加载登录页:', loginPath);

      if (!require('fs').existsSync(loginPath)) {
        log.error('登录页面文件不存在');
        this.win.webContents.loadURL(`data:text/html;charset=utf-8,
          <html>
            <body>
              <h1>错误：找不到登录页面</h1>
              <p>路径: ${loginPath}</p>
              <p>请确保应用程序安装正确。</p>
            </body>
          </html>
        `);
        return;
      }

      this.win.loadFile(loginPath).then(() => {
        log.info(`[导航耗时] 加载登录页完成，耗时 ${Date.now() - startTime}ms`);
      }).catch(err => {
        log.error(`[导航耗时] 加载登录页失败，耗时 ${Date.now() - startTime}ms`, err);
        this.win.webContents.loadURL(`data:text/html;charset=utf-8,
          <html>
            <body>
              <h1>加载失败</h1>
              <p>请检查应用程序日志以获取详细信息。</p>
              <p>错误信息: ${err.message}</p>
            </body>
          </html>
        `);
      });
    } catch (error) {
      log.error(`[导航耗时] 加载登录页异常，耗时 ${Date.now() - startTime}ms`, error);
    }
  }

  /**
   * 导航到指定页面
   * @param {string} htmlPath - HTML文件路径（不含扩展名）
   */
  navigate(htmlPath) {
    const startTime = Date.now();
    const distBase = app.isPackaged ? path.join(app.getAppPath(), 'dist') : path.join(__dirname, '../../../dist');
    const filePath = path.join(distBase, `${htmlPath}.html`);
    log.info(`[导航] navigate -> ${filePath}`);
    this.win.loadFile(filePath).then(() => {
      log.info(`[导航耗时] navigate完成，耗时 ${Date.now() - startTime}ms | ${htmlPath}`);
    }).catch(err => {
      log.error(`[导航耗时] navigate失败，耗时 ${Date.now() - startTime}ms | ${htmlPath}`, err);
    });
  }

  /**
   * 导航到示例页面
   */
  navigateToExample() {
    const startTime = Date.now();
    const distBase = app.isPackaged ? path.join(app.getAppPath(), 'dist') : path.join(__dirname, '../../../dist');
    const filePath = path.join(distBase, 'example.html');
    this.win.loadFile(filePath).then(() => {
      log.info(`[导航耗时] navigateToExample完成，耗时 ${Date.now() - startTime}ms`);
    }).catch(err => {
      log.error(`[导航耗时] navigateToExample失败，耗时 ${Date.now() - startTime}ms`, err);
    });
  }

  /**
   * 获取窗口实例
   * @returns {BrowserWindow} 窗口实例
   */
  getWindow() {
    return this.win;
  }
}


module.exports = WindowManager;
