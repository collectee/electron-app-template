/**
 * Electron应用主入口文件
 * 重构后的简洁版本，按功能模块组织代码
 */


(async () => {
  // 导入动态模块
  let SignJWT, jwtVerify, decodeJwt;
  try {
    const jose = await import('jose');
    SignJWT = jose.SignJWT;
    jwtVerify = jose.jwtVerify;
    decodeJwt = jose.decodeJwt;
  } catch (error) {
    console.error('导入 jose 模块失败:', error);
    throw error;
  }

  // 动态导入electron-store
  const Store = (await import('electron-store')).default;

  // 导入各功能模块
  const { ConfigManager } = require('./modules/config');
  const { TokenManager, JwtVerifier, DeviceJwtGenerator } = require('./modules/auth');
  const { WindowManager } = require('./modules/window');
  const { RequestProxy, UrlInterceptor } = require('./modules/network');
  const { IpcHandlers } = require('./modules/ipc');
  const { SystemInfo } = require('./modules/system');
  const { AppLifecycle } = require('./modules/app');
  const logger = require('./utils/logger');

  // 记录应用启动信息
  // logger.info('通过 electron-store 加载环境变量');

  // 初始化应用生命周期管理器
  const appLifecycle = new AppLifecycle();
  
  // 处理Squirrel事件
  if (appLifecycle.handleSquirrelEvent()) {
    return; // 如果处理了Squirrel事件，则不继续启动应用
  }

  // 记录应用启动信息
  appLifecycle.logAppStartupInfo();

  // 创建数据存储实例（容错：旧密钥数据无法解密时自动清除重建）
  let dataStore;
  try {
    dataStore = new Store({
      name: 'app-data',
      encryptionKey: require('../env.loader.js').ELECTRON_STORE_ENCRYPTION_KEY
    });
    // 触发一次读取以验证数据完整性
    dataStore.store;
  } catch (err) {
    logger.error('数据存储损坏，清除后重建:', err.message);
    const fs = require('fs');
    const storePath = new Store({ name: 'app-data' }).path;
    try { fs.unlinkSync(storePath); } catch {}
    dataStore = new Store({
      name: 'app-data',
      encryptionKey: require('../env.loader.js').ELECTRON_STORE_ENCRYPTION_KEY
    });
  }

  // 初始化各个模块
  const configManager = new ConfigManager(Store);
  const systemInfo = new SystemInfo();
  const windowManager = new WindowManager();

  // 注入dataStore到windowManager，用于记录最后访问的页面
  windowManager.setDataStore(dataStore);

  // 初始化认证相关模块
  const tokenManager = new TokenManager(dataStore, configManager);
  const jwtVerifier = new JwtVerifier(configManager, tokenManager, systemInfo);
  const deviceJwtGenerator = new DeviceJwtGenerator(systemInfo);

  // 初始化jose模块
  await jwtVerifier.initJose();
  await deviceJwtGenerator.initJose();

  // 初始化网络模块
  const requestProxy = new RequestProxy(configManager, tokenManager);
  const urlInterceptor = new UrlInterceptor(windowManager, configManager, tokenManager);

  // 初始化IPC处理器
  const ipcHandlers = new IpcHandlers(
    systemInfo,
    deviceJwtGenerator,
    jwtVerifier,
    tokenManager,
    configManager,
    requestProxy,
    windowManager,
    dataStore
  );

  // 记录关键配置
  logger.info('SERVER:', configManager.get('SERVER') + ':' + configManager.get('SERVER_PORT'), '| ENV:', configManager.get('NODE_ENV'));

  /**
   * 创建主窗口并设置相关功能
   */
  /**
     * 检查启动时是否可以恢复上次访问的页面
     * 页面恢复与token验证解耦：只要有记录的页面就先恢复，token验证在页面加载后进行
     * @returns {string|null} 恢复的URL，或null表示加载登录页
     */
    async function resolveStartPage() {
      const startTime = Date.now();
      const directLoadEnabled = String(configManager.get('DIRECT_LOAD_LAST_PAGE')).toLowerCase() === 'true';

      if (!directLoadEnabled) {
        logger.info(`[导航耗时] resolveStartPage: DIRECT_LOAD_LAST_PAGE未启用，耗时 ${Date.now() - startTime}ms`);
        return null;
      }

      // 诊断：直接从dataStore读取，确认数据是否存在
      try {
        const rawValue = dataStore.get('lastVisitedUrl');
        logger.info(`[导航诊断] dataStore.get('lastVisitedUrl') =`, rawValue || '(undefined/null)');
        logger.info(`[导航诊断] dataStore 所有键:`, JSON.stringify(Object.keys(dataStore.store || {})));
      } catch (diagErr) {
        logger.error(`[导航诊断] 读取dataStore失败:`, diagErr.message);
      }

      const lastUrl = windowManager.getLastVisitedUrl();
      if (!lastUrl) {
        logger.info(`[导航耗时] resolveStartPage: 无记录页面，耗时 ${Date.now() - startTime}ms`);
        return null;
      }

      // 恢复页面前先检查 refreshToken 是否仍然有效
      try {
        const { refreshToken, refreshExp } = await tokenManager.decryptTokens();
        const currentTime = Math.floor(Date.now() / 1000);

        if (!refreshToken || !refreshExp || currentTime >= refreshExp) {
          logger.info(`[导航] resolveStartPage: refreshToken已过期或不存在，清除记录页面，跳转登录页，耗时 ${Date.now() - startTime}ms`);
          windowManager.clearLastVisitedUrl();
          tokenManager.invalidateTokenCache();
          return null;
        }
      } catch (tokenErr) {
        logger.error(`[导航] resolveStartPage: 检查token失败，跳转登录页，耗时 ${Date.now() - startTime}ms |`, tokenErr.message);
        windowManager.clearLastVisitedUrl();
        return null;
      }

      logger.info(`[导航耗时] resolveStartPage: refreshToken有效，恢复上次页面，耗时 ${Date.now() - startTime}ms |`, lastUrl);
      return lastUrl;
    }

    /**
     * 解码accessToken的payload部分
     * @param {string} accessToken
     * @returns {object|null}
     */
    function decodeAccessTokenPayload(accessToken) {
      try {
        const parts = accessToken.split('.');
        if (parts.length === 3) {
          let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
          while (base64.length % 4) {
            base64 += '=';
          }
          return JSON.parse(Buffer.from(base64, 'base64').toString());
        }
      } catch (decodeError) {
        logger.error('解码accessToken失败:', decodeError);
      }
      return null;
    }

    /**
     * 页面加载完成后的认证处理
     * @param {BrowserWindow} win
     */
    async function onPageLoaded(win) {
              const startTime = Date.now();
              const currentUrl = win.webContents.getURL();
              logger.info('[导航] 页面加载:', currentUrl);

              try {
                // 第一步：检查 JWT 状态
                const jwtPayload = await jwtVerifier.verifyStoredJwt();

                if (!jwtPayload) {
                  // 分支1：JWT 过期或不存在 → 发送 jwt-validated: false，直接返回
                  logger.info(`[认证] onPageLoaded: JWT过期或不存在，发送 jwt-validated: false，耗时 ${Date.now() - startTime}ms`);
                  win.webContents.send('jwt-validated', false, {
                    error: 'No valid JWT found',
                    timestamp: Date.now(),
                    source: 'stored-jwt'
                  });
                  return;
                }

                // 第二步：JWT 有效，检查 refreshToken 状态
                const { accessToken, refreshToken, refreshExp, indexUrl } = await tokenManager.decryptTokens();
                const currentTime = Math.floor(Date.now() / 1000);

                if (!refreshToken || !refreshExp || currentTime >= refreshExp) {
                  // 分支2：JWT 未过期但 refreshToken 过期 → 清除记录、跳转登录页、发送 jwt-validated
                  logger.info(`[认证] onPageLoaded: JWT有效但refreshToken过期，发送 jwt-validated: true，耗时 ${Date.now() - startTime}ms`);
                  windowManager.clearLastVisitedUrl();
                  tokenManager.invalidateTokenCache();
                  win.webContents.send('jwt-validated', true, {
                    payload: jwtPayload,
                    timestamp: Date.now(),
                    source: 'stored-jwt'
                  });
                  if (!currentUrl.includes('login.html')) {
                    windowManager.loadLoginPage();
                  }
                  return;
                }

                // 分支3：JWT 和 refreshToken 都未过期 → 发送 login-validated: true，刷新 accessToken
                const payload = decodeAccessTokenPayload(accessToken);
                logger.info(`[认证] onPageLoaded: JWT和refreshToken都有效，发送 login-validated: true，耗时 ${Date.now() - startTime}ms`);
                win.webContents.send('login-validated', true, {
                  payload,
                  indexUrl: indexUrl || '/index',
                  timestamp: Date.now(),
                  source: 'startup-auth'
                });

                // 刷新并持久化最新的 accessToken
                await tokenManager.refreshAccessToken();
                logger.info(`[认证] onPageLoaded: accessToken刷新完成，总耗时 ${Date.now() - startTime}ms | ${currentUrl}`);
              } catch (error) {
                logger.error(`[认证] onPageLoaded: 认证检查失败，耗时 ${Date.now() - startTime}ms |`, error.message);
                win.webContents.send('jwt-validated', false, {
                  error: error.message,
                  timestamp: Date.now(),
                  source: 'verification-error'
                });
              }
            }




    /**
     * 创建主窗口并设置相关功能
     */
    async function createWindow() {
      const startTime = Date.now();
      const win = windowManager.createWindow();

      urlInterceptor.setupInterceptors();
      ipcHandlers.registerHandlers();

      // 检查是否可以恢复上次页面，否则加载登录页
      const restoreUrl = await resolveStartPage();
      windowManager.loadStartPage(restoreUrl);

      // 页面加载完成后执行认证逻辑
      win.webContents.on('did-finish-load', () => onPageLoaded(win));

      logger.info(`[导航] createWindow: 窗口创建及初始加载启动完成，耗时 ${Date.now() - startTime}ms`);
      return win;
    }


  // 设置应用事件监听器
  appLifecycle.setupAppEventListeners(createWindow);
})().catch(error => {
  console.error('应用启动失败:', error);
  process.exit(1);
});
