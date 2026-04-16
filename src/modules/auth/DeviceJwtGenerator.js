/**
 * 设备JWT生成模块
 * 负责生成设备相关的JWT token
 */

const { formatTimestamp } = require('../../utils/format.js');
const logger = require('../../utils/logger');

/**
 * 设备JWT生成器类
 * 提供设备JWT的生成和验证功能
 */
class DeviceJwtGenerator {
  constructor(systemInfo) {
    this.systemInfo = systemInfo;
    this.SignJWT = null;
    this.decodeJwt = null;
  }

  /**
   * 初始化jose模块
   */
  async initJose() {
    try {
      const jose = await import('jose');
      this.SignJWT = jose.SignJWT;
      this.decodeJwt = jose.decodeJwt;
    } catch (error) {
      logger.error('导入 jose 模块失败:', error);
      throw error;
    }
  }

  /**
   * 生成设备JWT（签发后 7 天过期，含 `exp` 声明供全链路校验）
   * @param {Object} [options]
   * @param {string} [options.serialNumber] - 用户输入的设备序列号（非空时写入 payload）
   * @returns {string} 设备JWT token
   */
  async generateDeviceJwt(options = {}) {
    const raw = options.serialNumber;
    const serialNumber =
      typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;

    const payload = {
      mac: this.systemInfo.getMAC(),
      diskId: this.systemInfo.getDiskId(),
      cpuId: this.systemInfo.getCpuId(),
      deviceId: this.systemInfo.getDeviceId(),
    };
    if (serialNumber) {
      payload.serialNumber = serialNumber;
    }
    
    const secret = new TextEncoder().encode('your_secret_key_here'); // 修改：请替换为安全的密钥
    const jwt = await new this.SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(secret);
    return jwt;
  }

  /**
   * 检查设备JWT是否过期（启动时检查）
   * @param {string} token - JWT token
   * @param {Function} navigateCallback - 导航回调函数
   */
  checkDeviceJwtOnStartup(token, navigateCallback) {
      if (token) {
        try {
          const decoded = this.decodeJwt(token);
          if (decoded && decoded.exp) {
            const currentTime = Math.floor(Date.now() / 1000);
            logger.info('设备JWT | exp:', formatTimestamp(decoded.exp));
            if (currentTime < decoded.exp) {
              if (navigateCallback) {
                navigateCallback('/login');
              }
            }
          }
        } catch (error) {
          logger.error('检查设备 JWT 时出错:', error);
        }
      }
    }

  /**
   * 判断设备JWT是否有效（未过期）
   * @param {string} token - JWT token
   * @returns {boolean} 有效返回true，无效或异常返回false
   */
  isDeviceJwtValid(token) {
    if (!token) return false;
    try {
      const decoded = this.decodeJwt(token);
      if (decoded && decoded.exp) {
        const currentTime = Math.floor(Date.now() / 1000);
        return currentTime < decoded.exp;
      }
    } catch (error) {
      logger.error('检查设备 JWT 有效性时出错:', error);
    }
    return false;
  }


}

module.exports = DeviceJwtGenerator;
