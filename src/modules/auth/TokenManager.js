/**
 * Token管理模块
 * 负责JWT token的生成、验证、加密存储和刷新
 */

const crypto = require('crypto');
const { safeStorage } = require('electron');
const { net } = require('electron');
const { formatTimestamp } = require('../../utils/format');
const logger = require('../../utils/logger');

/**
 * Token管理器类
 * 提供token的安全存储、解密、刷新等功能
 */
class TokenManager {
  constructor(dataStore, configManager) {
      this.dataStore = dataStore;
      this.configManager = configManager;
      this.refreshTimeout = null;
      this.keyManager = this.createKeyManager();

      // 内存缓存：避免每次请求都执行解密（safeStorage + AES）
      this._tokenCache = null;   // 缓存的解密结果
      this._cacheTime = 0;       // 缓存写入时间戳
      this._cacheTTL = 60000;    // 缓存有效期 60 秒
    }

  /**
   * 创建密钥管理器
   * @returns {Object} 密钥管理器对象
   */
  createKeyManager() {
    const dataStore = this.dataStore;
    return {
      // 生成并存储加密密钥
      async generateAndStoreKey() {
        try {
          const key = crypto.randomBytes(32);
          const encryptedKey = safeStorage.encryptString(key.toString('hex'));
          dataStore.set('encryptedKey', encryptedKey.toString('base64'));
          return key.toString('hex');
        } catch (error) {
          logger.error('生成和存储密钥失败:', error);
          throw error;
        }
      },

      // 获取存储的加密密钥
      async getStoredKey() {
        try {
          const encryptedKeyBase64 = dataStore.get('encryptedKey');
          if (!encryptedKeyBase64) {
            return null;
          }
          
          const encryptedKey = Buffer.from(encryptedKeyBase64, 'base64');
          const decryptedKey = safeStorage.decryptString(encryptedKey);
          return decryptedKey;
        } catch (error) {
          logger.error('获取存储的密钥失败:', error);
          return null;
        }
      },

      // 删除存储的密钥
      async deleteStoredKey() {
        try {
          dataStore.delete('encryptedKey');
        } catch (error) {
          logger.error('删除存储的密钥失败:', error);
        }
      }
    };
  }

  /**
   * 保存tokens到加密存储
   * @param {string} accessToken - 访问令牌
   * @param {string} refreshToken - 刷新令牌
   * @param {number} accessExp - 访问令牌过期时间
   * @param {number} refreshExp - 刷新令牌过期时间
   * @param {string} indexUrl - 主页URL（可选，默认为/index）
   */
  async saveTokens(accessToken, refreshToken, accessExp, refreshExp, indexUrl = '/index') {
        try {
          const tokenData = { accessToken, refreshToken, accessExp, refreshExp, indexUrl };

          let key = await this.keyManager.getStoredKey();
          if (!key) {
            key = await this.keyManager.generateAndStoreKey();
          }

          const iv = crypto.randomBytes(16);
          const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'hex'), iv);
          const encrypted = Buffer.concat([
            cipher.update(JSON.stringify(tokenData)), 
            cipher.final()
          ]);
          // 拼接 IV 和密文
          const encryptedData = Buffer.concat([iv, encrypted]);
          this.dataStore.set('encryptedData', encryptedData.toString('base64'));

          // 同步更新内存缓存，后续 decryptTokens 直接走缓存
          this._tokenCache = { ...tokenData };
          this._cacheTime = Date.now();

          logger.info('Tokens 已保存 | accessExp:', formatTimestamp(accessExp), '| refreshExp:', formatTimestamp(refreshExp));
        } catch (error) {
          logger.error('保存 tokens 时出错:', error);
          throw error;
        }
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
   * 从持久化存储解密tokens
   * @returns {Object} 解密后的tokens对象，包含accessToken、refreshToken、accessExp、refreshExp、indexUrl
   */
  async decryptTokens() {
        // 优先使用内存缓存，避免重复解密
        const now = Date.now();
        if (this._tokenCache && (now - this._cacheTime) < this._cacheTTL) {
          return this._tokenCache;
        }

        try {
          if (!safeStorage.isEncryptionAvailable()) {
            logger.error('safeStorage 不可用');
            return { accessToken: null, refreshToken: null, accessExp: null, refreshExp: null };
          }

          const key = await this.keyManager.getStoredKey();
          if (!key) {
            return { accessToken: null, refreshToken: null, accessExp: null, refreshExp: null };
          }

          const encryptedData = this.dataStore.get('encryptedData');
          if (!encryptedData) {
            return { accessToken: null, refreshToken: null, accessExp: null, refreshExp: null };
          }

          const encryptedBuffer = Buffer.from(encryptedData, 'base64');
          const iv = encryptedBuffer.subarray(0, 16);
          const ciphertext = encryptedBuffer.subarray(16);

          const decipher = crypto.createDecipheriv(
            'aes-256-cbc', 
            Buffer.from(key, 'hex'),
            iv
          );

          let decrypted = decipher.update(ciphertext);
          decrypted = Buffer.concat([decrypted, decipher.final()]);

          const result = JSON.parse(decrypted.toString('utf8'));

          // 向后兼容：如果缺少exp信息，尝试从token中解析
          if (result.accessToken && !result.accessExp) {
            result.accessExp = this.extractExpFromToken(result.accessToken);
          }

          if (result.refreshToken && !result.refreshExp) {
            result.refreshExp = this.extractExpFromToken(result.refreshToken);
          }

          if (!result.indexUrl) {
            result.indexUrl = '/index';
          }

          // 写入内存缓存
          this._tokenCache = result;
          this._cacheTime = now;

          return result;

        } catch (error) {
          logger.error('Token 解密失败:', error);
          this.dataStore.delete('encryptedData');
          this.keyManager.deleteStoredKey();
          this._tokenCache = null;
          return { accessToken: null, refreshToken: null, accessExp: null, refreshExp: null, indexUrl: '/index' };
        }
      }

  /**
   * 刷新Access Token
   */
  async refreshAccessToken() {
      if (this._refreshing) {
        logger.info('[认证] refreshAccessToken: 已有刷新任务运行中，跳过');
        return;
      }
      this._refreshing = true;
      const startTime = Date.now();
      try {
        const { refreshToken, refreshExp, indexUrl } = await this.decryptTokens();
        if (!refreshToken || !refreshExp) {
          logger.info(`[认证] refreshAccessToken: 没有可用的刷新token，耗时 ${Date.now() - startTime}ms`);
          return;
        }

        const newTokens = await this.fetchRefreshTokens(refreshToken, refreshExp); 
        if (!newTokens || !newTokens.access_token || !newTokens.accessExp) {
          logger.error(`[认证] refreshAccessToken: 服务器响应无效，耗时 ${Date.now() - startTime}ms`);
          return;
        }

        const finalRefreshToken = newTokens.refresh_token || refreshToken;
        const finalRefreshExp = newTokens.refreshExp || refreshExp;
        const newIndexUrl = newTokens.indexUrl || indexUrl || '/index';
        await this.saveTokens(newTokens.access_token, finalRefreshToken, newTokens.accessExp, finalRefreshExp, newIndexUrl);
        logger.info(`[认证] refreshAccessToken: 刷新成功，耗时 ${Date.now() - startTime}ms | 新accessExp:`, formatTimestamp(newTokens.accessExp));

        // 设置下次刷新（提前5分钟）
        if (newTokens.accessExp) {
          const expiresIn = (newTokens.accessExp * 1000) - Date.now() - 300000;
          if (expiresIn > 0) {
            this.refreshTimeout = setTimeout(() => this.refreshAccessToken(), expiresIn);
            logger.info(`[认证] 下次刷新: ${Math.floor(expiresIn / 1000 / 60)} 分钟后`);
          }
        }
      } catch (error) {
        logger.error(`[认证] refreshAccessToken: 刷新失败，耗时 ${Date.now() - startTime}ms |`, error);
      } finally {
        this._refreshing = false;
      }
    }

  /**
   * 获取新的tokens
   * @param {string} refreshToken - 刷新令牌
   * @param {number} refreshExp - 刷新令牌过期时间
   * @returns {Object|null} 新的tokens或null
   */
  async fetchRefreshTokens(refreshToken, refreshExp) {
        const startTime = Date.now();
        try {
          const url = `http://${this.configManager.get('SERVER')}:${this.configManager.get('SERVER_PORT')}/auth/refresh`;
          logger.info(`[认证] fetchRefreshTokens: 开始请求 ${url}`);
          const response = await net.fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ refresh_token: refreshToken })
          });

          if (!response.ok) {
            logger.error(`[认证] fetchRefreshTokens: 请求失败 ${response.status}，耗时 ${Date.now() - startTime}ms`);
            return null;
          }

          const result = await response.json();
          logger.info(`[认证] fetchRefreshTokens: 请求成功，耗时 ${Date.now() - startTime}ms`);
          return result;
        } catch (error) {
          logger.error(`[认证] fetchRefreshTokens: 请求异常，耗时 ${Date.now() - startTime}ms |`, error);
          return null;
        }
      }


  /**
   * 保存JWT到加密存储
   * @param {string} jwt - JWT token
   */
  async saveJwt(jwt) {
    try {
      let key = await this.keyManager.getStoredKey();
      if (!key) {
        key = await this.keyManager.generateAndStoreKey();
      }
      
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'hex'), iv);
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify({ jwt, timestamp: Date.now() })), 
        cipher.final()
      ]);
      // 拼接 IV 和密文
      const encryptedData = Buffer.concat([iv, encrypted]);
      this.dataStore.set('encryptedJwt', encryptedData.toString('base64'));
      // console.log('JWT 加密保存成功');
    } catch (error) {
      logger.error('保存 JWT 时出错:', error);
      throw error;
    }
  }

  /**
   * 从加密存储获取JWT
   * @returns {string|null} 解密后的JWT或null
   */
  async getEncryptedJwt() {
    try {
      // 1. 从安全存储获取主密钥
      const key = await this.keyManager.getStoredKey();
      if (!key) {
        return null;
      }

      const encryptedData = this.dataStore.get('encryptedJwt');
      if (!encryptedData) {
        return null;
      }

      // 3. 分离IV和密文（加密时IV存储在数据头部）
      const encryptedBuffer = Buffer.from(encryptedData, 'base64');
      const iv = encryptedBuffer.subarray(0, 16); // 前16字节为IV
      const ciphertext = encryptedBuffer.subarray(16); // 剩余为密文

      // 4. 创建解密器
      const decipher = crypto.createDecipheriv(
        'aes-256-cbc', 
        Buffer.from(key, 'hex'), // 密钥需转为二进制
        iv
      );

      // 5. 执行解密
      let decrypted = decipher.update(ciphertext);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      // 6. 解析为JSON对象并返回JWT
      const data = JSON.parse(decrypted.toString('utf8'));
      return data.jwt;
      
    } catch (error) {
      logger.error('JWT 解密失败:', error);
      // 清除损坏的JWT数据
      this.dataStore.delete('encryptedJwt');
      return null;
    }
  }

  /**
   * 删除存储的JWT
   */
  async deleteJwt() {
    try {
      this.dataStore.delete('encryptedJwt');
    } catch (error) {
      logger.error('删除 JWT 时出错:', error);
    }
  }

  /**
   * 清除刷新定时器
   */
  clearRefreshTimeout() {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = null;
    }
  }
  /**
   * 清除内存中的 token 缓存
   * 在登出或 token 失效时调用
   */
  invalidateTokenCache() {
    this._tokenCache = null;
    this._cacheTime = 0;
  }
}

module.exports = TokenManager;
