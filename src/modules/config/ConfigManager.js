/**
 * 配置管理模块
 * 负责应用程序配置的存储、读取和管理
 */

// Store将在构造函数中动态导入
const env = require('../../../env.loader.js');

const log = require('../../utils/logger');

/**
 * 配置管理类
 * 提供配置的初始化、获取、设置、重置等功能
 */
class ConfigManager {
  constructor(Store) {
    // 创建配置存储实例（容错：旧密钥数据无法解密时自动清除重建）
    try {
      this.configStore = new Store({
        name: 'app-config',
        encryptionKey: env.ELECTRON_STORE_ENCRYPTION_KEY
      });
      // 触发一次读取以验证数据完整性
      this.configStore.store;
    } catch (err) {
      log.error('配置存储损坏，清除后重建:', err.message);
      const fs = require('fs');
      const tempStore = new Store({ name: 'app-config' });
      try { fs.unlinkSync(tempStore.path); } catch {}
      this.configStore = new Store({
        name: 'app-config',
        encryptionKey: env.ELECTRON_STORE_ENCRYPTION_KEY
      });
    }

    // 直接从 env.loader.js 解析后的配置取默认值，不再重复硬编码
    // 排除仅用于构建的字段（ELECTRON_MIRROR 等）
    const { ELECTRON_MIRROR, ELECTRON_CUSTOM_DIR, ELECTRON_DOWNLOAD_TIMEOUT, ELECTRON_DOWNLOAD_RETRIES, ...appConfig } = env;
    this.defaultConfig = appConfig;
    
    this.initializeConfig();
  }

  /**
   * 初始化配置
   * 将默认配置与存储的配置合并，默认配置优先
   */
  initializeConfig() {
    const currentConfig = this.configStore.get('appConfig', {});
    // 默认配置优先：先加载存储配置，再用默认配置覆盖
    const mergedConfig = { ...currentConfig, ...this.defaultConfig };
    this.configStore.set('appConfig', mergedConfig);
    log.info('配置初始化完成，默认配置已应用');
  }

  /**
   * 获取配置值
   * @param {string} key - 配置键名
   * @returns {any} 配置值
   */
  get(key) {
    const config = this.configStore.get('appConfig', this.defaultConfig);
    return config[key] || this.defaultConfig[key];
  }

  /**
   * 设置配置值
   * @param {string} key - 配置键名
   * @param {any} value - 配置值
   */
  set(key, value) {
    const config = this.configStore.get('appConfig', this.defaultConfig);
    config[key] = value;
    this.configStore.set('appConfig', config);
    log.info(`配置已更新: ${key} = ${value}`);
  }

  /**
   * 获取所有配置
   * @returns {Object} 所有配置对象
   */
  getAll() {
    return this.configStore.get('appConfig', this.defaultConfig);
  }

  /**
   * 重置配置为默认值
   */
  reset() {
    this.configStore.set('appConfig', this.defaultConfig);
    log.info('配置已重置为默认值');
  }

  /**
   * 更新多个配置
   * @param {Object} configs - 要更新的配置对象
   */
  updateMultiple(configs) {
    const currentConfig = this.configStore.get('appConfig', this.defaultConfig);
    const updatedConfig = { ...currentConfig, ...configs };
    this.configStore.set('appConfig', updatedConfig);
    log.info('多个配置已更新');
  }
}

module.exports = ConfigManager;
