/**
 * URL拦截器模块
 * 负责拦截和重写网络请求的URL和请求头
 */

const logger = require('../../utils/logger');

/**
 * URL拦截器类
 * 提供请求头修改、URL重写、CORS处理等功能
 */
class UrlInterceptor {
  constructor(windowManager, configManager, tokenManager) {
    this.windowManager = windowManager;
    this.configManager = configManager;
    this.tokenManager = tokenManager;
  }

  /**
   * 判断页面URL是否为哈希命名页面或index页面
   * @param {string} pageUrl - 页面URL
   * @returns {boolean}
   */
  isHashOrIndexPage(pageUrl) {
    try {
      let pagePath;
      if (pageUrl.startsWith('file://')) {
        pagePath = new URL(pageUrl).pathname;
      } else if (pageUrl.startsWith('http://') || pageUrl.startsWith('https://')) {
        pagePath = new URL(pageUrl).pathname;
      } else {
        return false;
      }
      const pageFile = pagePath.split('/').pop();
      if (!pageFile) return false;
      const baseName = pageFile.includes('.') ? pageFile.substring(0, pageFile.lastIndexOf('.')) : pageFile;
      // 哈希命名文件或 index.html
      return this.isHashFilename(baseName) || pageFile === 'index.html';
    } catch (e) {
      return false;
    }
  }

  /**
   * 判断文件名是否为哈希命名
   * @param {string} filename - 不含扩展名的文件名
   * @returns {boolean}
   */
  isHashFilename(filename) {
    return /^[0-9a-f]{32,}$/i.test(filename);
  }

  /**
   * 规范化 file:// URL，确保哈希命名的页面路径包含 .html 扩展名
   * 例如：file:///D:/dist/7959445c...?token=null -> file:///D:/dist/7959445c....html?token=null
   * @param {string} url
   * @returns {string|null} 规范化后的 URL，如果不需要规范化则返回 null
   */
  normalizeFileUrl(url) {
    if (!url || !url.startsWith('file://')) return null;
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const lastSegment = pathname.split('/').pop();
      // 如果路径末段是哈希命名（32位以上十六进制）且没有扩展名，补充 .html
      if (lastSegment && /^[0-9a-f]{32,}$/i.test(lastSegment)) {
        urlObj.pathname = pathname + '.html';
        return urlObj.toString();
      }
    } catch (e) {
      // ignore
    }
    return null;
  }

  /**
   * 判断 URL 是否为静态资源请求
   * @param {string} url - 请求 URL
   * @returns {boolean}
   */
  isStaticResource(url) {
    const DEFAULT_STATIC_EXTENSIONS = ['.js', '.css', '.html', '.woff', '.ttf', '.png', '.jpg', '.svg', '.ico', '.gif', '.woff2', '.eot', '.map'];
    let extensions;
    try {
      extensions = this.configManager && this.configManager.get('STATIC_RESOURCE_EXTENSIONS');
    } catch (e) {
      extensions = null;
    }
    if (!Array.isArray(extensions)) {
      extensions = DEFAULT_STATIC_EXTENSIONS;
    }

    try {
      // Extract pathname from URL - handle both absolute and relative URLs
      let pathname;
      if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://')) {
        pathname = new URL(url).pathname;
      } else {
        // Relative URL - strip query string and fragment
        pathname = url.split('?')[0].split('#')[0];
      }

      const lastSegment = pathname.split('/').pop();
      if (!lastSegment || !lastSegment.includes('.')) {
        return false;
      }
      const ext = '.' + lastSegment.split('.').pop().toLowerCase();
      return extensions.includes(ext);
    } catch (e) {
      return false;
    }
  }

  /**
   * 设置请求拦截器
   * 为窗口的webContents设置各种请求拦截器
   */
  setupInterceptors() {
      const win = this.windowManager.getWindow();
      if (!win) return;

      // 调试模式：DEVTOOLS_NETWORK_VISIBLE 为 true 时跳过代理拦截，
      // 让请求直接从渲染进程发出，DevTools Network 面板可见
      let devtoolsNetworkVisible = false;
      try {
        devtoolsNetworkVisible = this.configManager && this.configManager.get('DEVTOOLS_NETWORK_VISIBLE');
      } catch (e) {
        devtoolsNetworkVisible = false;
      }

      if (devtoolsNetworkVisible === true || devtoolsNetworkVisible === 'true') {
        logger.info('[UrlInterceptor] DEVTOOLS_NETWORK_VISIBLE=true，跳过请求拦截代理，DevTools Network 可见');

        // 仅保留 CORS 响应头处理，不做请求重写和 header 注入
        win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
          details.responseHeaders['Access-Control-Allow-Origin'] = ['*'];
          callback({ cancel: false, responseHeaders: details.responseHeaders });
        });
        return;
      }

      // 拦截请求头，注入 Authorization
      // 仅对 http(s) 且非静态资源的请求注入，file:// 请求直接放行
      win.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
        try {
          const { url } = details;

          // file:// 请求（本地静态资源）直接放行，不经过任何异步逻辑
          if (url.startsWith('file://')) {
            callback({ cancel: false, requestHeaders: details.requestHeaders });
            return;
          }

          // 静态资源（.js/.css/.png 等）直接放行
          if (this.isStaticResource(url)) {
            details.requestHeaders['X-Custom-Header'] = 'MyValue';
            callback({ cancel: false, requestHeaders: details.requestHeaders });
            return;
          }

          // 非静态 http(s) 请求：注入 Authorization（异步）
          details.requestHeaders['X-Custom-Header'] = 'MyValue';

          const pageUrl = win.webContents.getURL();
          if (this.isHashOrIndexPage(pageUrl) && this.tokenManager) {
            this.tokenManager.decryptTokens().then(({ accessToken }) => {
              if (accessToken) {
                details.requestHeaders['Authorization'] = `Bearer ${accessToken}`;
              }
              callback({ cancel: false, requestHeaders: details.requestHeaders });
            }).catch(() => {
              callback({ cancel: false, requestHeaders: details.requestHeaders });
            });
            return;
          }

          callback({ cancel: false, requestHeaders: details.requestHeaders });
        } catch (error) {
          logger.error('[UrlInterceptor] 注入Authorization失败:', error);
          callback({ cancel: false, requestHeaders: details.requestHeaders });
        }
      });

      // 拦截请求URL，仅对 file:// 请求做规范化（补充 .html 扩展名）
      // http(s) 请求不需要经过这层
      win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
        try {
          const { url } = details;

          // 只处理 file:// 协议的 URL
          if (url.startsWith('file://')) {
            // 修复协议相对URL被错误解析的问题：
            // 页面中 //at.alicdn.com/... 在 file:// 下会变成 file://at.alicdn.com/...
            // 检测 file:// 后跟域名（含点号）的情况，重定向到 https://
            const afterProtocol = url.slice(7); // 去掉 "file://"
            const firstSlash = afterProtocol.indexOf('/');
            const host = firstSlash > 0 ? afterProtocol.slice(0, firstSlash) : afterProtocol;
            if (host && host.includes('.') && !host.includes(':') && !host.includes('\\')) {
              const httpsUrl = 'https://' + afterProtocol;
              logger.info(`[拦截] 协议相对URL修复: ${url} -> ${httpsUrl}`);
              callback({ redirectURL: httpsUrl });
              return;
            }

            // 哈希文件名规范化（补充 .html 扩展名）
            const normalizedUrl = this.normalizeFileUrl(url);
            if (normalizedUrl) {
              logger.info(`[拦截] URL规范化: ${url} -> ${normalizedUrl}`);
              callback({ redirectURL: normalizedUrl });
              return;
            }
          }

          // 其它请求直接放行
          callback({ cancel: false });
        } catch (error) {
          logger.error('URL处理异常:', error);
          callback({ cancel: false });
        }
      });

      // 拦截响应头，修改响应头以绕过 CORS 限制
      win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        details.responseHeaders['Access-Control-Allow-Origin'] = ['*'];
        callback({ cancel: false, responseHeaders: details.responseHeaders });
      });
    }


  /**
   * 自定义URL重写规则
   * @param {string} originalUrl - 原始URL
   * @param {Object} rewriteRules - 重写规则对象
   * @returns {string} 重写后的URL
   */
  rewriteUrl(originalUrl, rewriteRules = {}) {
    let newUrl = originalUrl;

    // 应用重写规则
    for (const [pattern, replacement] of Object.entries(rewriteRules)) {
      const regex = new RegExp(pattern, 'g');
      newUrl = newUrl.replace(regex, replacement);
    }

    return newUrl;
  }

  /**
   * 添加自定义请求头
   * @param {Object} headers - 现有请求头
   * @param {Object} customHeaders - 要添加的自定义请求头
   * @returns {Object} 合并后的请求头
   */
  addCustomHeaders(headers, customHeaders = {}) {
    return {
      ...headers,
      ...customHeaders
    };
  }

  /**
   * 处理CORS响应头
   * @param {Object} responseHeaders - 原始响应头
   * @param {Object} corsOptions - CORS选项
   * @returns {Object} 处理后的响应头
   */
  handleCorsHeaders(responseHeaders, corsOptions = {}) {
    const defaultCorsOptions = {
      'Access-Control-Allow-Origin': ['*'],
      'Access-Control-Allow-Methods': ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      'Access-Control-Allow-Headers': ['Content-Type', 'Authorization', 'X-Requested-With'],
      'Access-Control-Allow-Credentials': ['true']
    };

    const finalCorsOptions = { ...defaultCorsOptions, ...corsOptions };

    return {
      ...responseHeaders,
      ...finalCorsOptions
    };
  }
}


module.exports = UrlInterceptor;
