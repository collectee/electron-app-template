/**
 * IPC处理器模块
 * 负责主进程与渲染进程之间的通信处理
 */

const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs');
const logger = require('../../utils/logger');

/**
 * IPC处理器类
 * 提供各种IPC通信的处理方法
 */
class IpcHandlers {
  constructor(
    systemInfo,
    deviceJwtGenerator, 
    jwtVerifier, 
    tokenManager, 
    configManager, 
    requestProxy, 
    windowManager, 
    dataStore
  ) {
    this.systemInfo = systemInfo;
    this.deviceJwtGenerator = deviceJwtGenerator;
    this.jwtVerifier = jwtVerifier;
    this.tokenManager = tokenManager;
    this.configManager = configManager;
    this.requestProxy = requestProxy;
    this.windowManager = windowManager;
    this.dataStore = dataStore;
  }

  /**
   * 注册所有IPC处理器
   */
  registerHandlers() {
    this.registerSystemHandlers();
    this.registerAuthHandlers();
    this.registerTokenHandlers();
    this.registerConfigHandlers();
    this.registerNetworkHandlers();
    this.registerNavigationHandlers();
    this.registerCleanupHandlers();
    this.registerWindowControlHandlers();
  }

  /**
   * 注册系统相关的IPC处理器
   */
  registerSystemHandlers() {
    // 监听渲染进程请求MAC地址等系统信息
    ipcMain.handle('get-mac', async () => {
      try {
        const mac = await this.deviceJwtGenerator.generateDeviceJwt();
        return { success: true, mac: mac };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
  }

  /**
   * 注册认证相关的IPC处理器
   */
  registerAuthHandlers() {
    // 监听渲染进程请求JWT验证
    ipcMain.handle('check-jwt', async (event, token) => {
      try {
        const decoded = await this.jwtVerifier.verifyJwt(token);
        // JWT验证成功后会自动保存到加密存储（在JwtVerifier中处理）
        // 为了兼容性，也保存到旧的deviceJwt位置
        this.dataStore.set('deviceJwt', token);
        return !!decoded;
      } catch (error) {
        logger.error('验证 JWT 时出错:', error);
        return false;
      }
    });

    // 保存JWT到加密存储
    ipcMain.handle('save-jwt', async (event, token) => {
      try {
        await this.tokenManager.saveJwt(token);
        // 为了兼容性，也保存到旧的deviceJwt位置
        this.dataStore.set('deviceJwt', token);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // 获取加密存储的JWT
    ipcMain.handle('get-encrypted-jwt', async () => {
      try {
        const jwt = await this.tokenManager.getEncryptedJwt();
        return { success: true, jwt };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // 验证存储的JWT
    ipcMain.handle('verify-stored-jwt', async () => {
      try {
        const payload = await this.jwtVerifier.verifyStoredJwt();
        return { success: true, payload, valid: !!payload };
      } catch (error) {
        return { success: false, error: error.message, valid: false };
      }
    });

    // 删除存储的JWT
    ipcMain.handle('delete-jwt', async () => {
      try {
        await this.tokenManager.deleteJwt();
        // 同时删除旧的deviceJwt
        this.dataStore.delete('deviceJwt');
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
  }

  /**
   * 从JWT token中解析出过期时间
   * @param {string} token - JWT token
   * @returns {number|null} 过期时间戳或null
   */
  extractExpFromToken(token) {
    try {
      if (!token) return null;
      
      // JWT由三部分组成，用.分割：header.payload.signature
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      
      // 解码payload部分（第二部分）
      // JWT使用base64url编码，需要转换为标准base64
      let base64 = parts[1]
        .replace(/-/g, '+')
        .replace(/_/g, '/');
      
      // 补充padding
      while (base64.length % 4) {
        base64 += '=';
      }
      
      const payload = JSON.parse(Buffer.from(base64, 'base64').toString());
      return payload.exp || null;
    } catch (error) {
      logger.error('解析JWT token失败:', error);
      return null;
    }
  }

  /**
   * 注册Token相关的IPC处理器
   */
  registerTokenHandlers() {
    // 保存Access Token和Refresh Token
    ipcMain.handle('save-tokens', async (event, accessToken, refreshToken, indexUrl = '/index') => {
      try {
        const accessExp = this.extractExpFromToken(accessToken);
        const refreshExp = this.extractExpFromToken(refreshToken);
        
        logger.info('IPC save-tokens | accessExp:', accessExp, '| refreshExp:', refreshExp);
        
        await this.tokenManager.saveTokens(accessToken, refreshToken, accessExp, refreshExp, indexUrl);

        // 异步调度刷新，不阻塞 IPC 返回，避免登录后导航时 token 被覆盖
        setTimeout(() => {
          this.tokenManager.refreshAccessToken().catch(err => {
            logger.error('[认证] save-tokens 异步刷新失败:', err.message);
          });
        }, 2000);

        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // 获取Access Token
    ipcMain.handle('get-access-token', async () => {
      try {
        const { accessToken, accessExp } = await this.tokenManager.decryptTokens();
        return { success: true, accessToken, accessExp };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // 获取Refresh Token
    ipcMain.handle('get-refresh-token', async () => {
      try {
        const { refreshToken, refreshExp } = await this.tokenManager.decryptTokens();
        return { success: true, refreshToken, refreshExp };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // 手动刷新Access Token
    ipcMain.handle('refresh-token', async () => {
      try {
        await this.tokenManager.refreshAccessToken();
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
  }

  /**
   * 注册配置相关的IPC处理器
   */
  registerConfigHandlers() {
    // 获取配置
    ipcMain.handle('get-config', (event, key) => {
      try {
        if (key) {
          return { success: true, value: this.configManager.get(key) };
        } else {
          return { success: true, config: this.configManager.getAll() };
        }
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // 设置配置
    ipcMain.handle('set-config', (event, key, value) => {
      try {
        this.configManager.set(key, value);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // 更新多个配置
    ipcMain.handle('update-configs', (event, configs) => {
      try {
        this.configManager.updateMultiple(configs);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // 重置配置
    ipcMain.handle('reset-config', () => {
      try {
        this.configManager.reset();
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
  }

  /**
   * 注册网络相关的IPC处理器
   */
  registerNetworkHandlers() {
    // 代理HTTP请求处理器（记录 IPC 接收时间，便于排查主进程排队延迟）
    ipcMain.handle('proxy-request', async (event, requestConfig) => {
      const ipcReceivedAt = Date.now();
      const result = await this.requestProxy.proxyRequest(requestConfig);
      const ipcTotalMs = Date.now() - ipcReceivedAt;
      if (ipcTotalMs > 1000) {
        logger.info(`[IPC] proxy-request 总耗时: ${ipcTotalMs}ms (主进程处理+代理)`);
      }
      return result;
    });
  }

  /**
   * 注册导航相关的IPC处理器
   */
  registerNavigationHandlers() {
    // 通用导航处理器
    ipcMain.handle('navigate', (event, htmlPath) => {
      const startTime = Date.now();
      logger.info(`[导航耗时] IPC navigate: 开始导航到 ${htmlPath}`);
      this.windowManager.navigate(htmlPath);
    });

    // 导航到示例页面
    ipcMain.handle('navigate-to-example', () => {
      logger.info('[导航耗时] IPC navigate-to-example: 开始导航');
      this.windowManager.navigateToExample();
    });

  }

  /**
   * 注册清理相关的IPC处理器
   */
  registerCleanupHandlers() {
    // 登出时根据 JWT 过期状态区分清除范围
    ipcMain.handle('logout', async () => {
      const startTime = Date.now();
      try {
        // 先检查 JWT 是否过期
        const jwtPayload = await this.jwtVerifier.verifyStoredJwt();
        const jwtValid = !!jwtPayload;

        // 两种情况都清除 accessToken/refreshToken
        this.dataStore.delete('encryptedData');

        if (!jwtValid) {
          // JWT 已过期：清除所有认证数据
          await this.tokenManager.deleteJwt();
          this.dataStore.delete('deviceJwt');
          logger.info('logout: JWT 已过期，清除所有认证数据');
        } else {
          // JWT 未过期：保留 encryptedJwt 和 deviceJwt
          logger.info('logout: JWT 未过期，仅清除 tokens，保留 JWT 和 deviceJwt');
        }

        // 两种情况都需要执行的清理操作
        this.tokenManager.clearRefreshTimeout();
        this.tokenManager.invalidateTokenCache();
        this.windowManager.clearLastVisitedUrl();
        this.windowManager.loadLoginPage();

        logger.info(`[导航耗时] logout: 完成，耗时 ${Date.now() - startTime}ms`);
        return { success: true };
      } catch (error) {
        logger.error(`[导航耗时] logout: 失败，耗时 ${Date.now() - startTime}ms |`, error.message);
        return { success: false, error: error.message };
      }
    });

    // 单独清除最后访问页面记录
    ipcMain.handle('clear-last-visited', () => {
      try {
        this.windowManager.clearLastVisitedUrl();
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
  }

  /**
   * 注册窗口控制相关的IPC处理器（无边框模式下的最小化/最大化/关闭）
   */
  registerWindowControlHandlers() {
    const win = this.windowManager.getWindow();

    ipcMain.handle('window-minimize', () => {
      if (win && !win.isDestroyed()) win.minimize();
    });

    ipcMain.handle('window-maximize', () => {
      if (win && !win.isDestroyed()) {
        if (win.isMaximized()) {
          win.unmaximize();
        } else {
          win.maximize();
        }
      }
    });

    ipcMain.handle('window-close', () => {
      if (win && !win.isDestroyed()) win.close();
    });

    ipcMain.handle('window-is-maximized', () => {
      if (win && !win.isDestroyed()) return win.isMaximized();
      return false;
    });

    // 当最大化状态变化时通知渲染进程（用于切换按钮图标）
    if (win && !win.isDestroyed()) {
      win.on('maximize', () => {
        win.webContents.send('window-maximize-change', true);
      });
      win.on('unmaximize', () => {
        win.webContents.send('window-maximize-change', false);
      });
    }
  }

  /**
   * 移除所有IPC处理器
   */
  removeAllHandlers() {
    const handlers = [
      'get-mac',
      'check-jwt',
      'save-jwt',
      'get-encrypted-jwt',
      'verify-stored-jwt',
      'delete-jwt',
      'save-tokens',
      'get-access-token',
      'get-refresh-token',
      'refresh-token',
      'get-config',
      'set-config',
      'update-configs',
      'reset-config',
      'proxy-request',
      'navigate',
      'navigate-to-example',
      'logout',
      'clear-last-visited',
      'window-minimize',
      'window-maximize',
      'window-close',
      'window-is-maximized'
    ];

    handlers.forEach(handler => {
      ipcMain.removeHandler(handler);
    });
  }
}

module.exports = IpcHandlers;
