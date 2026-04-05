/**
 * 应用生命周期管理模块
 * 负责应用的启动、退出和Squirrel事件处理
 */

const { app, globalShortcut, Menu } = require('electron');
const ChildProcess = require('child_process');
const path = require('path');

const log = require('../../utils/logger');

/**
 * 应用生命周期管理类
 * 提供应用启动、退出、事件处理等功能
 */
class AppLifecycle {
  constructor() {
    this.refreshTimeout = null;
  }

  /**
   * 处理Squirrel事件，用于处理应用的安装、更新、卸载相关操作
   * @returns {boolean} 如果处理了Squirrel事件则返回true，否则返回false
   */
  handleSquirrelEvent() {
    if (process.argv.length === 1) return false;

    const appFolder = path.resolve(process.execPath, '..');
    const rootFolder = path.resolve(appFolder, '..');
    const updateExe = path.join(rootFolder, 'Update.exe');
    const exeName = path.basename(process.execPath);
    const squirrelEvent = process.argv[1];

    switch (squirrelEvent) {
      case '--squirrel-install':
      case '--squirrel-updated':
        // 创建快捷方式
        ChildProcess.spawn(updateExe, ['--createShortcut', exeName], { detached: true });
        // 安装或更新完成后不要启动主程序，直接退出
        setTimeout(() => {
          app.quit();
        }, 1000);
        return true;
      case '--squirrel-uninstall':
        ChildProcess.spawn(updateExe, ['--removeShortcut', exeName], { detached: true });
        setTimeout(() => app.quit(), 1000);
        return true;
      case '--squirrel-obsolete':
        app.quit();
        return true;
      default:
        return false;
    }
  }

  /**
   * 记录应用启动信息
   */
  logAppStartupInfo() {
      log.info('应用启动 | Electron:', process.versions.electron, '| 打包:', app.isPackaged);
    }


  /**
   * 注册全局快捷键
   */
  registerGlobalShortcuts() {
    // 注册全局快捷键 Esc 用于退出全屏
    globalShortcut.register('Escape', () => {
      app.quit();
    });

    // 注册全局快捷键：Alt+Left 实现后退功能
    globalShortcut.register('Alt+Left', () => {
      const focusedWindow = require('electron').BrowserWindow.getFocusedWindow();
      if (focusedWindow && focusedWindow.webContents.canGoBack()) {
        focusedWindow.webContents.goBack();
      }
    });

    // 注册全局快捷键：Alt+Right 实现前进功能
    globalShortcut.register('Alt+Right', () => {
      const focusedWindow = require('electron').BrowserWindow.getFocusedWindow();
      if (focusedWindow && focusedWindow.webContents.canGoForward()) {
        focusedWindow.webContents.goForward();
      }
    });
  }

  /**
   * 设置应用菜单
   */
  setupApplicationMenu() {
    const template = [
      {
        label: '文件',
        submenu: [
          { role: 'toggleDevTools', label: '打开开发者工具' },
          { role: 'reload', label: '重新加载' },
          { role: 'quit', label: '退出' }
        ]
      },
      {
        label: '编辑',
        submenu: [
          { role: 'undo', label: '撤销' },
          { role: 'redo', label: '重做' },
        ]
      }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }

  /**
   * 设置应用事件监听器
   * @param {Function} createWindowCallback - 创建窗口的回调函数
   */
  setupAppEventListeners(createWindowCallback, tokenManager = null) {
    app.whenReady().then(() => {
      log.info('应用程序就绪');
      createWindowCallback();
      this.registerGlobalShortcuts();
      this.setupApplicationMenu();
    });

    app.on('will-quit', () => {
      globalShortcut.unregisterAll();
      // 清除token刷新定时器
      if (this.refreshTimeout) {
        clearTimeout(this.refreshTimeout);
      }
      if (tokenManager && typeof tokenManager.clearPersistedTokensIfEphemeral === 'function') {
        tokenManager.clearPersistedTokensIfEphemeral();
      }
    });

    app.on('window-all-closed', () => {
      log.info('所有窗口已关闭');
      if (process.platform !== 'darwin') app.quit();
    });
  }

  /**
   * 设置刷新超时
   * @param {number} timeout - 超时ID
   */
  setRefreshTimeout(timeout) {
    this.refreshTimeout = timeout;
  }

  /**
   * 清除刷新超时
   */
  clearRefreshTimeout() {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = null;
    }
  }
}

module.exports = AppLifecycle;
