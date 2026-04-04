/**
 * 生产环境应用配置（与 env.config.js 结构保持一致）
 *
 * 打包/生产运行时由 env.loader.js 加载。请按部署环境修改 SERVER、密钥等敏感项。
 */
module.exports = {
  // ===== 服务器配置 =====
  SERVER: '119.23.253.225',
  SERVER_PORT: '80',
  NODE_ENV: 'production',

  // ===== 认证配置 =====
  JWT_PUBLIC_KEY: `-----BEGIN RSA PUBLIC KEY-----
MIIBCgKCAQEAxvWVEAv+ncQnrdNQki/QZbiEEiJqW0CmPxZRT8eCweLDd6p5nF7X
SfdAmUgUq6ru2zi46goP18HxAzmGDQbGi07CXczkeo01V1GnvtPLjcE7wI2l9mW3
lmAaFXDcGNSeJOP2BkHDD2OeP19/mOBxcrXWADbXhT9XGoMsgIVfnls0yG1AmLMY
tybJm3pkMG8DgbEGCLUyJEdDFIIdbMIex3cMpPJOnnt8V/W7Nlko9Lmu/C4PfS/w
9pHTLV1o7ZycNZsrWYZ8WqUh2vJV8WZmOoUChC8MYId6h44eXALClowWXs1ZE7e0
Fp2D2UnqztfdOUji4vCbwPzIjvRKTOpBIQIDAQAB
-----END RSA PUBLIC KEY-----`,

  // ===== 存储加密 =====
  ELECTRON_STORE_ENCRYPTION_KEY: 'x9$mK2#vL8@qW5nR7*jF3pY6&hT0cBdA',

  // ===== 应用行为 =====
  DIRECT_LOAD_LAST_PAGE: true,

  // ===== 调试配置 =====
  DEVTOOLS_NETWORK_VISIBLE: false,

  // ===== 静态资源扩展名（不走代理的文件类型） =====
  STATIC_RESOURCE_EXTENSIONS: [
    '.js', '.css', '.html', '.woff', '.ttf', '.png',
    '.jpg', '.svg', '.ico', '.gif', '.woff2', '.eot', '.map'
  ],

  // ===== 日志输出控制 =====
  LOG_PROXY: false,
  LOG_NAVIGATION: false,
  LOG_INTERCEPT: false,
  LOG_IPC: false,
  LOG_AUTH: false,
  LOG_GENERAL: false,

  // ===== Electron 构建/下载配置 =====
  ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/',
  ELECTRON_CUSTOM_DIR: '34.2.0',
  ELECTRON_DOWNLOAD_TIMEOUT: '300000',
  ELECTRON_DOWNLOAD_RETRIES: '3'
};
