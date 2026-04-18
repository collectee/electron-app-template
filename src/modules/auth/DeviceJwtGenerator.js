/**
 * 设备JWT生成模块
 * 负责生成设备相关的 JWE（加密 JWT）
 *
 * 算法：RSA-OAEP-256 + A256GCM
 *  - 客户端内置服务端公钥，对随机生成的内容加密密钥（CEK）做 RSA-OAEP-256 加密
 *  - payload 本身由 CEK 通过 AES-256-GCM 加密
 *  - 解密端（服务端）使用对应的 RSA 私钥解密 CEK，再还原 payload
 *
 * 注意：公钥不是敏感信息，可安全内置到客户端；但绝不能把私钥放到客户端。
 * 公钥来源：env.loader.js → env.config.js / env.prod.config.js 的 JWT_PUBLIC_KEY 字段
 * （支持 PKCS#1 `RSA PUBLIC KEY` 和 SPKI `PUBLIC KEY` 两种 PEM 头）。
 */

const { createPublicKey } = require('crypto');

const env = require('../../../env.loader.js');
const logger = require('../../utils/logger');

/**
 * 设备JWT生成器类
 * 提供基于 JWE 的设备 token 生成能力
 */
class DeviceJwtGenerator {
  /**
   * @param {Object} systemInfo - 系统信息提供者
   * @param {Object} [options]
   * @param {string} [options.publicKeyPem] - 覆盖默认公钥（PEM 字符串）；未传时使用 env.JWT_PUBLIC_KEY
   */
  constructor(systemInfo, options = {}) {
    this.systemInfo = systemInfo;
    this.publicKeyPem = options.publicKeyPem || env.JWT_PUBLIC_KEY;
    this.EncryptJWT = null;
    this.publicKey = null;
  }

  /**
   * 初始化 jose 模块并加载公钥
   */
  async initJose() {
    try {
      if (!this.publicKeyPem || typeof this.publicKeyPem !== 'string') {
        throw new Error('JWT_PUBLIC_KEY 未配置或格式不正确');
      }
      const jose = await import('jose');
      this.EncryptJWT = jose.EncryptJWT;
      // createPublicKey 能自动识别 PKCS#1（BEGIN RSA PUBLIC KEY）与 SPKI（BEGIN PUBLIC KEY）
      this.publicKey = createPublicKey(this.publicKeyPem);
    } catch (error) {
      logger.error('导入 jose 模块或加载公钥失败:', error);
      throw error;
    }
  }

  /**
   * 生成设备 JWE（签发后 7 天过期）
   * @param {Object} [options]
   * @param {string} [options.serialNumber] - 用户输入的设备序列号（非空时写入 payload）
   * @returns {Promise<string>} JWE compact 序列化字符串（5 段 base64url，用 '.' 分隔）
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

    const jwe = await new this.EncryptJWT(payload)
      .setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A256GCM', typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .encrypt(this.publicKey);

    return jwe;
  }
}

module.exports = DeviceJwtGenerator;
