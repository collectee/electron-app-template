const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    asar: true, // 是否使用 asar 格式打包应用，设置为 true 表示启用
    // 添加网络配置（ECONNRESET 时增大超时与重试）
    download: {
      mirror: 'https://npmmirror.com/mirrors/electron/',
      timeout: 600000, // 10 分钟超时
      retries: 5
    }
  },
  // 添加全局网络配置
  electronDownload: {
    mirror: 'https://npmmirror.com/mirrors/electron/',
    timeout: 600000,
    retries: 5
  },
  rebuildConfig: {
    // 重建配置，如果需要特殊设置可在此添加
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel', // Squirrel.Windows 打包器
      config: {
        authors: "广州新动力", // 应用作者
        description: "HR管理系统", // 应用描述
        shortcutName: "HRms", // 快捷方式名称
      },
    },
    {
      name: '@electron-forge/maker-zip', // MacOS 使用 ZIP 格式打包
      platforms: ['darwin'], // 指定平台
    },
    {
      name: '@electron-forge/maker-deb', // Linux deb 打包器
      config: {
        // ...如有其他 deb 配置...
      },
    },
    {
      name: '@electron-forge/maker-rpm', // Linux rpm 打包器
      config: {
        // ...如有其他 rpm 配置...
      },
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives', // 自动解包原生模块插件
      config: {},
    },
    // 环境变量插件 - 替换dotenv的作用
    {
      name: '@electron-forge/plugin-webpack',
      config: {
        // 主进程配置
        mainConfig: {
          entry: './src/main.js',
          // 与编译时的 NODE_ENV 一致：package/make 须带 NODE_ENV=production，
          // 否则 Webpack 会把 process.env.NODE_ENV 内联为 development，env.loader 会打入 env.config.js（localhost）
          mode: (process.env.NODE_ENV || '').toLowerCase() === 'production' ? 'production' : 'development',
          resolve: {
            extensions: ['.js', '.json']
          },
          // 排除原生模块，这些模块会在运行时动态加载
          externals: {
            'keytar': 'commonjs keytar',
            'electron-store': 'commonjs electron-store',
            'jose': 'commonjs jose'
          },
          // 移除环境变量定义，现在使用 electron-store 管理配置
          plugins: []
        },
        // 渲染进程配置
        renderer: {
          entryPoints: [
            {
              html: './index.html',
              js: './renderer.js',
              name: 'main_window',
              preload: {
                js: './preload.js'
              }
            }
          ],
          config: {
            // 渲染进程的webpack配置
          }
        }
      }
    },
    // Fuses 插件用于在打包时启用/禁用 Electron 的各项功能，在代码签名前执行
    new FusesPlugin({
      version: FuseVersion.V1, // Fuses 插件版本，这里使用 V1 版本
      [FuseV1Options.RunAsNode]: false, // 禁止以 Node.js 模式运行应用
      [FuseV1Options.EnableCookieEncryption]: true, // 启用 cookie 加密
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, // 禁用 NODE_OPTIONS 环境变量
      [FuseV1Options.EnableNodeCliInspectArguments]: false, // 禁用 Node.js CLI inspect 参数
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true, // 开启嵌入式 asar 完整性校验
      [FuseV1Options.OnlyLoadAppFromAsar]: true, // 强制只能从 asar 文件加载应用代码
    }),
  ],
};
