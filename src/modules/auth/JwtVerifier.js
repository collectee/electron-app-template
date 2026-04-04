/**
 * JWT验证模块
 * 负责JWT token的验证和解码
 */

const { formatTimestamp } = require('../../utils/format');
const logger = require('../../utils/logger');

/**
 * JWT验证器类
 * 提供JWT验证、解码等功能
 */
class JwtVerifier {
  constructor(configManager, tokenManager, systemInfo) {
      this.configManager = configManager;
      this.tokenManager = tokenManager;
      this.systemInfo = systemInfo;
      this.SignJWT = null;
      this.jwtVerify = null;
      this.decodeJwt = null;
    }

  /**
   * 初始化jose模块
   */
  async initJose() {
    try {
      const jose = await import('jose');
      this.SignJWT = jose.SignJWT;
      this.jwtVerify = jose.jwtVerify;
      this.decodeJwt = jose.decodeJwt;
    } catch (error) {
      logger.error('导入 jose 模块失败:', error);
      throw error;
    }
  }

  /**
   * 验证JWT token
   * @param {string} token - JWT token
   * @returns {Object} 验证后的payload
   */
  async verifyJwt(token) {
        try {
          if (!token || typeof token !== 'string') {
            logger.error('Invalid JWT token: token must be a non-empty string');
            return false;
          }

          let publicKey = this.configManager.get('JWT_PUBLIC_KEY');

          if (!publicKey) {
            logger.error('JWT_PUBLIC_KEY 配置未设置');
            return false;
          }

          publicKey = this.fixPemFormat(publicKey);

          const crypto = await import('crypto');
          try {
            crypto.createPublicKey({
              key: publicKey,
              format: 'pem',
              type: 'spki'
            });
          } catch (formatError) {
            publicKey = this.handleFormatError(publicKey, formatError);
          }

          const key = crypto.createPublicKey({
            key: publicKey,
            format: 'pem',
            type: 'spki'
          });

          const { payload } = await this.jwtVerify(token, key, {
            algorithms: ['RS256']
          });

          logger.info('JWT 验证成功 | exp:', payload.exp ? formatTimestamp(payload.exp) : 'N/A');

          // 校验设备信息：mac、cpuId、deviceId 必须与本机一致
          if (this.systemInfo) {
            // mac 校验：从 JWT 的 "名称=MAC" 中提取网卡名，回查本机同一网卡
            const jwtMac = payload.mac;
            if (jwtMac) {
              const sepIdx = jwtMac.indexOf('=');
              const ifaceName = sepIdx !== -1 ? jwtMac.substring(0, sepIdx) : null;
              const localMac = this.systemInfo.getMAC(ifaceName);
              if (jwtMac !== localMac) {
                logger.error(`JWT 设备校验失败 | mac 不匹配: payload=${jwtMac}, local=${localMac}`);
                return false;
              }
            }

            const fields = [
              { name: 'cpuId', local: this.systemInfo.getCpuId() },
              { name: 'deviceId', local: this.systemInfo.getDeviceId() },
            ];
            for (const { name, local } of fields) {
              if (payload[name] !== local) {
                logger.error(`JWT 设备校验失败 | ${name} 不匹配: payload=${payload[name]}, local=${local}`);
                return false;
              }
            }
            logger.info('JWT 设备信息校验通过');
          }

          if (this.tokenManager) {
            try {
              await this.tokenManager.saveJwt(token);
            } catch (saveError) {
              logger.error('保存 JWT 到加密存储失败:', saveError);
            }
          }

          return payload;
        } catch (error) {
          logger.error('JWT 验证失败:', error.message);
          return false;
        }
      }


  /**
   * 修复PEM格式
   * @param {string} publicKey - 原始公钥
   * @returns {string} 修复后的公钥
   */
  fixPemFormat(publicKey) {
    publicKey = publicKey.trim();
    
    // 检查并修复PEM格式
    if (!publicKey.startsWith('-----BEGIN')) {
      // console.warn('公钥缺少 BEGIN 标记，尝试修复格式');
      // 如果是RSA公钥但没有正确的PEM标记，添加标记
      if (publicKey.includes('MIIBCgKCAQEA')) {
        publicKey = `-----BEGIN RSA PUBLIC KEY-----\n${publicKey}\n-----END RSA PUBLIC KEY-----`;
      } else {
        // 尝试作为SPKI格式处理
        publicKey = `-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----`;
      }
    }
    
    // 检查公钥是否缺少换行符（这是常见的格式问题）
    if (publicKey.includes('-----BEGIN') && publicKey.includes('-----END') && !publicKey.includes('\n')) {
      // console.warn('公钥缺少换行符，尝试修复格式');
      const beginMatch = publicKey.match(/-----BEGIN.*?-----/);
      const endMatch = publicKey.match(/-----END.*?-----/);
      
      if (beginMatch && endMatch) {
        const beginMarker = beginMatch[0];
        const endMarker = endMatch[0];
        const keyContent = publicKey.substring(beginMarker.length, publicKey.indexOf(endMarker)).trim();
        
        if (keyContent) {
          const formattedContent = keyContent.match(/.{1,64}/g).join('\n');
          publicKey = `${beginMarker}\n${formattedContent}\n${endMarker}`;
          // console.log('JWT 验证 - PEM 格式换行符已修复');  
        }
      }
    }
    
    // 确保公钥有正确的PEM格式起始行
    if (!publicKey.includes('-----BEGIN')) {
      logger.error('公钥格式无效 - 缺少 BEGIN 标记');
      throw new Error('Invalid public key format: missing BEGIN marker');
    }
    
    // 检查公钥是否包含结束标记
    if (!publicKey.includes('-----END')) {
      logger.error('公钥格式无效 - 缺少 END 标记');
      throw new Error('Invalid public key format: missing END marker');
    }
    
    // 确保PEM格式正确（每64个字符换行）
    if (!publicKey.includes('\n') && publicKey.length > 64) {
      const keyContent = publicKey.replace(/-----BEGIN.*-----/, '').replace(/-----END.*-----/, '').trim();
      // console.log('JWT 验证 - 密钥内容长度:', keyContent ? keyContent.length : 0);
      
      if (keyContent && keyContent.length > 0) {
        const matches = keyContent.match(/.{1,64}/g);
        if (matches && matches.length > 0) {
          const formattedKey = matches.join('\n');
          const beginMarker = publicKey.match(/-----BEGIN.*-----/)[0];
          const endMarker = publicKey.match(/-----END.*-----/)[0];
          publicKey = `${beginMarker}\n${formattedKey}\n${endMarker}`;
          // console.log('JWT 验证 - PEM 格式修复成功');
        } else {
          logger.warn('JWT 验证 - 密钥内容正则匹配失败，使用原始格式');
        }
      } else {
        logger.warn('JWT 验证 - 密钥内容为空，使用原始格式');
      }
    }

    return publicKey;
  }

  /**
   * 处理格式错误
   * @param {string} publicKey - 原始公钥
   * @param {Error} formatError - 格式错误
   * @returns {string} 修复后的公钥
   */
  handleFormatError(publicKey, formatError) {
    // 尝试修复常见的格式问题
    if (formatError.code === 'ERR_OSSL_PEM_NO_START_LINE') {
      logger.warn('正在尝试修复 PEM 格式问题...');
      
      // 移除所有空白字符并重新格式化
      const cleanKey = publicKey.replace(/\s+/g, '');
      if (cleanKey.includes('MIIBCgKCAQEA')) {
        // 重新构建RSA公钥格式
        const keyContent = cleanKey.replace(/-----BEGINRSAPUBLICKEY-----/, '').replace(/-----ENDRSAPUBLICKEY-----/, '');
        const formattedContent = keyContent.match(/.{1,64}/g).join('\n');
        publicKey = `-----BEGIN RSA PUBLIC KEY-----\n${formattedContent}\n-----END RSA PUBLIC KEY-----`;
        logger.info('JWT 验证 - RSA 公钥格式已重构');
      }
    } else if (formatError.code === 'ERR_OSSL_UNSUPPORTED') {
      logger.warn('正在尝试修复不支持的格式问题...');
      
      // 尝试修复无换行符的PEM格式
      if (publicKey.includes('-----BEGIN') && publicKey.includes('-----END') && !publicKey.includes('\n')) {
        const beginMatch = publicKey.match(/-----BEGIN.*?-----/);
        const endMatch = publicKey.match(/-----END.*?-----/);
        
        if (beginMatch && endMatch) {
          const beginMarker = beginMatch[0];
          const endMarker = endMatch[0];
          const keyContent = publicKey.substring(beginMarker.length, publicKey.indexOf(endMarker)).trim();
          
          if (keyContent) {
            const formattedContent = keyContent.match(/.{1,64}/g).join('\n');
            publicKey = `${beginMarker}\n${formattedContent}\n${endMarker}`;
            logger.info('JWT 验证 - PEM 格式换行符已重构');
          }
        }
      }
    }

    return publicKey;
  }

  /**
   * 验证存储的JWT是否有效
   * @returns {Object|null} 如果JWT有效返回payload，否则返回null
   */
  async verifyStoredJwt() {
      try {
        if (!this.tokenManager) {
          return null;
        }

        const storedJwt = await this.tokenManager.getEncryptedJwt();
        if (!storedJwt) {
          return null;
        }

        const payload = await this.verifyJwt(storedJwt);

        if (payload.exp) {
          const currentTime = Math.floor(Date.now() / 1000);
          if (currentTime >= payload.exp) {
            logger.info('存储的 JWT 已过期');
            await this.tokenManager.deleteJwt();
            return null;
          }
        }

        return payload;
      } catch (error) {
        logger.error('验证存储的 JWT 时出错:', error);
        if (this.tokenManager) {
          await this.tokenManager.deleteJwt();
        }
        return null;
      }
    }

  /**
   * 解码JWT token（不验证签名）
   * @param {string} token - JWT token
   * @returns {Object} 解码后的payload
   */
  decodeJWT(token) {
      try {
        const decoded = this.decodeJwt(token);
        if (!decoded) {
          throw new Error('Invalid JWT token');
        }
        if (decoded.exp) {
          logger.info('JWT 解码 | exp:', formatTimestamp(decoded.exp));
        }
        return decoded;
      } catch (error) {
        logger.error('解码 JWT 时出错:', error);
        throw error;
      }
    }
}

module.exports = JwtVerifier;
