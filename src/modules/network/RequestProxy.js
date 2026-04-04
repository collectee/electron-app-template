/**
 * 网络请求代理模块
 * 负责HTTP请求的代理、拦截和处理
 */

const { net } = require('electron');
const { performance } = require('perf_hooks');
const logger = require('../../utils/logger');

/**
 * 请求代理类
 * 提供HTTP请求代理和自动token刷新功能
 */
class RequestProxy {
  constructor(configManager, tokenManager) {
      this.configManager = configManager;
      this.tokenManager = tokenManager;

      // 请求去重：相同 GET 请求在 flight 中时，后续调用复用同一个 Promise
      this._inflightRequests = new Map();
    }

  /**
   * 代理HTTP请求
   * @param {Object} requestConfig - 请求配置对象 { url, method?, headers?, data? }
   *   - Authorization 由主进程 tokenManager 注入并覆盖，前端无需传递
   *   - headers 中其它自定义头会保留
   * @returns {Object} 请求结果 { success, data?, error?, status? }
   */
  /**
     * 生成请求去重 key（仅 GET 请求参与去重）
     * @param {Object} requestConfig
     * @param {string} url - 完整 URL
     * @returns {string|null} 去重 key，非 GET 返回 null
     */
    _dedupeKey(requestConfig, url) {
      const method = (requestConfig.method || 'GET').toUpperCase();
      if (method !== 'GET') return null;
      return `${method}:${url}`;
    }

    /**
     * 防御性 URL 清理：检测并修复查询参数中的 [object Object] 序列化错误
     * 前端可能将 JS 对象直接拼入 URL 而未调用 JSON.stringify()，
     * 导致参数值变成 "[object Object]"，后端 JSON.parse() 时会报错。
     * @param {string} url - 待检查的 URL
     * @returns {string} 清理后的 URL
     */
    _sanitizeUrl(url) {
      const OBJECT_OBJECT = '%5Bobject%20Object%5D';
      const OBJECT_OBJECT_RAW = '[object Object]';

      if (!url.includes(OBJECT_OBJECT) && !url.includes(OBJECT_OBJECT_RAW)) {
        return url;
      }

      logger.warn(`[代理] URL 中检测到 [object Object]，前端可能未对参数调用 JSON.stringify(): ${url}`);

      try {
        const urlObj = new URL(url);
        let fixed = false;
        for (const [key, value] of urlObj.searchParams.entries()) {
          if (value === OBJECT_OBJECT_RAW || value === OBJECT_OBJECT) {
            // 无法还原原始对象，将值替换为空 JSON 对象，避免后端 JSON.parse 崩溃
            urlObj.searchParams.set(key, '{}');
            logger.warn(`[代理] 参数 "${key}" 的值为 [object Object]，已替换为 "{}"。请修复前端序列化逻辑。`);
            fixed = true;
          }
        }
        return fixed ? urlObj.toString() : url;
      } catch (e) {
        // URL 解析失败，返回原始 URL
        return url;
      }
    }


    /**
     * 代理HTTP请求
     * @param {Object} requestConfig - 请求配置对象 { url, method?, headers?, data? }
     *   - Authorization 由主进程 tokenManager 注入并覆盖，前端无需传递
     *   - headers 中其它自定义头会保留
     * @returns {Object} 请求结果 { success, data?, error?, status? }
     */
    async proxyRequest(requestConfig) {
        const baseUrl = `http://${this.configManager.get('SERVER')}:${this.configManager.get('SERVER_PORT')}`;
        let url = requestConfig.url.startsWith('http') ? requestConfig.url : `${baseUrl}${requestConfig.url}`;

        // 防御性检测：前端可能将对象直接拼入 URL 导致 [object Object]
        url = this._sanitizeUrl(url);

        const dedupeKey = this._dedupeKey(requestConfig, url);

        // GET 请求去重：如果相同请求正在进行中，直接复用结果
        if (dedupeKey && this._inflightRequests.has(dedupeKey)) {
          logger.info(`[代理] 去重复用: ${url}`);
          return this._inflightRequests.get(dedupeKey);
        }

        const promise = this._doProxyRequest(requestConfig, url);

        if (dedupeKey) {
          this._inflightRequests.set(dedupeKey, promise);
          promise.finally(() => this._inflightRequests.delete(dedupeKey));
        }

        return promise;
      }

    /**
     * 实际执行代理请求
     * @param {Object} requestConfig
     * @param {string} url - 完整 URL
     * @returns {Object}
     */
    async _doProxyRequest(requestConfig, url) {
        const tStart = performance.now();
        const entryDate = new Date();
        const fmtTime = (d) => (d || new Date()).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
        try {
          const tBeforeDecrypt = performance.now();
          const { accessToken, accessExp } = await this.tokenManager.decryptTokens();
          const decryptMs = Math.round(performance.now() - tBeforeDecrypt);

          const fetchConfig = {
            method: requestConfig.method || 'GET',
            headers: {
              'Content-Type': 'application/json',
              ...requestConfig.headers
            }
          };

          if (accessToken) {
            fetchConfig.headers['Authorization'] = `Bearer ${accessToken}`;
            fetchConfig.headers['X-Access-Exp'] = accessExp;
          }

          if (requestConfig.data) {
            fetchConfig.body = JSON.stringify(requestConfig.data);
          }

          const tBeforeFetch = performance.now();
          logger.info(`[代理] ${fetchConfig.method} ${url} [入队: ${fmtTime(entryDate)}] [decrypt: ${decryptMs}ms] [发送: ${fmtTime(new Date())}]`);

          const response = await net.fetch(url, fetchConfig);

          const contentType = response.headers.get('content-type');
          let data;

          if (contentType && contentType.includes('application/json')) {
            data = await response.json();
          } else {
            data = await response.text();
          }

          const tAfterFetch = performance.now();
          const fetchMs = Math.round(tAfterFetch - tBeforeFetch);
          const totalMs = Math.round(tAfterFetch - tStart);
          logger.info(`[代理] ${fetchConfig.method} ${url} [接收: ${fmtTime(new Date())}] [fetch: ${fetchMs}ms] [总耗时: ${totalMs}ms]`);

          if (!response.ok) {
            if (response.status === 401 && accessToken) {
              logger.info('[代理] 401 -> 刷新token...');
              await this.tokenManager.refreshAccessToken();

              const { accessToken: newToken, accessExp: newAccessExp } = await this.tokenManager.decryptTokens();
              if (newToken) {
                fetchConfig.headers['Authorization'] = `Bearer ${newToken}`;
                fetchConfig.headers['X-Access-Exp'] = newAccessExp;
                const retryResponse = await net.fetch(url, fetchConfig);

                if (retryResponse.ok) {
                  const retryTotalMs = Math.round(performance.now() - tStart);
                  logger.info(`[代理] ${fetchConfig.method} ${url} -> ${retryResponse.status} (重试成功) [接收: ${fmtTime(new Date())}] [总耗时: ${retryTotalMs}ms]`);
                  const retryData = await retryResponse.json();
                  return {
                    success: true,
                    data: retryData,
                    status: retryResponse.status,
                    headers: Object.fromEntries(retryResponse.headers.entries())
                  };
                }
              }
            }

            logger.info(`[代理] ${fetchConfig.method} ${url} -> ${response.status} 失败 [时间: ${new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 })}]`);
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          logger.info(`[代理] ${fetchConfig.method} ${url} -> ${response.status} [完成: ${fmtTime(new Date())}] [总耗时: ${totalMs}ms]`);
          return {
            success: true,
            data: data,
            status: response.status,
            headers: Object.fromEntries(response.headers.entries())
          };

        } catch (error) {
          logger.error('[代理] 请求失败:', error.message);
          return {
            success: false,
            error: error.message,
            status: error.status || 500
          };
        }
      }
}

module.exports = RequestProxy;
