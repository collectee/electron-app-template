/**
 * 日志工具模块
 * 根据 env.loader.js 加载的配置中 LOG_* 开关控制各类别日志的输出
 * 
 * 类别匹配规则（按日志内容中的关键词自动识别）：
 *   LOG_PROXY      -> 包含 [代理]
 *   LOG_NAVIGATION -> 包含 [导航] 或 [导航耗时]
 *   LOG_INTERCEPT  -> 包含 [拦截] 或 [UrlInterceptor]
 *   LOG_IPC        -> 包含 [IPC]
 *   LOG_AUTH       -> 包含 token/jwt/密钥/认证 等关键词
 *   LOG_GENERAL    -> 不匹配以上任何类别的日志
 */

const env = require('../../env.loader.js');

// 类别匹配规则：[configKey, regex]
const CATEGORY_RULES = [
  ['LOG_PROXY',      /\[代理\]/],
  ['LOG_NAVIGATION', /\[导航/],
  ['LOG_INTERCEPT',  /\[拦截\]|\[UrlInterceptor\]/],
  ['LOG_IPC',        /\[IPC\]/],
  ['LOG_AUTH',       /token|jwt|密钥|认证|refresh|设备JWT/i],
];

/**
 * 判断一条日志是否应该输出
 * @param  {...any} args - 日志参数
 * @returns {boolean}
 */
function shouldLog(...args) {
  const message = args.map(a => (typeof a === 'string' ? a : '')).join(' ');

  for (const [key, regex] of CATEGORY_RULES) {
    if (regex.test(message)) {
      return env[key] !== false;
    }
  }

  // 未匹配任何类别，走 LOG_GENERAL
  return env.LOG_GENERAL !== false;
}

/**
 * 包装原始console方法，加入类别过滤
 */
function wrap(fn) {
  return (...args) => {
    if (shouldLog(...args)) {
      fn(...args);
    }
  };
}

const logger = {
  info:  wrap(console.log),
  error: wrap(console.error),
  warn:  wrap(console.warn),
  debug: wrap(console.log),
};

module.exports = logger;
