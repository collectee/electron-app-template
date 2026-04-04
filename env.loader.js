/**
 * 按环境加载配置：development → env.config.js，production → env.prod.config.js
 *
 * 判定（依次）：
 * 1) NODE_ENV === 'production'
 * 2) Electron app.isPackaged === true
 * 3) 主进程且非「electron .」启动：process.defaultApp !== true（安装包 exe 一般为 undefined，
 *    个别 electron-builder 场景下 isPackaged 曾误判，此条作补充）
 *
 * 仅与 electron-forge + Webpack 有关：编译主进程时 NODE_ENV 会被内联，故 package/make 需 NODE_ENV=production
 *（见 package.json）；npm run build（electron-builder）不走该 Webpack 流程，运行时走上面 2) 3)。
 */

'use strict';

function useProductionConfig() {
  if (process.env.NODE_ENV === 'production') {
    return true;
  }
  try {
    const { app } = require('electron');
    if (app && app.isPackaged) {
      return true;
    }
  } catch (_) {
    // 非 Electron 主进程（如 Jest、纯 Node 脚本）
  }
  // 安装包独立进程：不是「把应用目录传给 electron 可执行文件」的开发启动方式
  if (
    process.type === 'browser' &&
    process.defaultApp !== true &&
    process.versions &&
    process.versions.electron
  ) {
    return true;
  }
  return false;
}

module.exports = useProductionConfig()
  ? require('./env.prod.config.js')
  : require('./env.config.js');
