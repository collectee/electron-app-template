/**
 * 开发环境应用配置
 *
 * 生产环境使用 env.prod.config.js，由根目录 env.loader.js 按 NODE_ENV / app.isPackaged 自动选择。
 * ConfigManager 启动时会读取 loader 合并后的默认配置，并通过 electron-store 持久化。
 *
 * 注意：.env 文件已废弃，不会被读取。
 */
module.exports = {
  // ===== 服务器配置 =====
  SERVER: 'localhost',
  SERVER_PORT: '3000',
  NODE_ENV: 'development',

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
  // 是否在token有效时直接恢复上次打开的页面（true=直接恢复, false=始终加载登录页）
  DIRECT_LOAD_LAST_PAGE: true,

  // ===== 调试配置 =====
  // 设为 true 时禁用请求拦截代理，使请求直接从渲染进程发出，
  // 这样 DevTools Network 面板可以看到所有请求（仅用于调试）
  DEVTOOLS_NETWORK_VISIBLE: true,

  // ===== 静态资源扩展名（不走代理的文件类型） =====
  STATIC_RESOURCE_EXTENSIONS: [
    '.js', '.css', '.html', '.woff', '.ttf', '.png',
    '.jpg', '.svg', '.ico', '.gif', '.woff2', '.eot', '.map'
  ],

  // ===== 日志输出控制 =====
  // 控制各类别日志是否输出到终端（true=输出, false=静默）
  LOG_PROXY: false,          // [代理] 网络代理请求日志
  LOG_NAVIGATION: true,     // [导航] 页面导航及耗时日志
  LOG_INTERCEPT: false,      // [拦截] URL拦截处理日志
  LOG_IPC: false,            // [IPC] 进程间通信日志
  LOG_AUTH: true,            // 认证/Token相关日志
  LOG_GENERAL: false,         // 其他通用日志

  // ===== Electron 构建/下载配置 =====
  ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/',
  ELECTRON_CUSTOM_DIR: '34.2.0',
  ELECTRON_DOWNLOAD_TIMEOUT: '300000',
  ELECTRON_DOWNLOAD_RETRIES: '3'
};
