# electron-sample-app 部署与打包指南

## 1. 前提条件

构建 Electron 应用前，需要先完成依赖子项目的构建：

```bash
# 1. 构建 login-page（生成 dist/login.html）
cd ../login-page
npm run build

# 2. 构建 front-2.1（生成 dist/[hash].html 和 dist/asset/）
cd ../front-2.1
npm run build

# 3. 将构建产物复制到 electron-sample-app/dist/
#    确保 dist/ 目录包含：
#    - login.html（来自 login-page）
#    - [contenthash].html（来自 front-2.1）
#    - asset/css/、asset/js/（来自 front-2.1）
```

## 2. 构建命令

```bash
# 开发运行
npm start                    # 直接启动 Electron
npm run start:utf8           # UTF-8 控制台（中文支持）

# 生产打包
npm run build                # electron-builder — NSIS Windows 安装器
npm run dist                 # electron-builder — Windows x64

# 开发打包（备选）
npm run package              # electron-forge (NODE_ENV=production)
npm run make                 # electron-forge 安装器制作（300s 超时）

# 测试
npm test                     # Jest 单元测试
```

## 3. 构建配置

### electron-builder（主构建工具）

配置在 `package.json` 的 `build` 字段中：

- **appId**: `com.zyukyun.hrm`
- **产品名称**: `HR管理系统`
- **目标**: NSIS Windows 安装器
- **ASAR 打包**: 启用（`electron-store` 和 `jose` 解包）
- **输出目录**: `release/`

### 输出产物

```
release/
├── HR管理系统 Setup x.x.x.exe      # NSIS 安装程序
├── HR管理系统 Setup x.x.x.exe.blockmap  # 增量更新映射
└── win-unpacked/                    # 解包目录（调试用）
```

## 4. 环境配置

构建时根据 `NODE_ENV` / `app.isPackaged` 自动选择配置：

| 环境 | 配置文件 | SERVER 地址 |
|------|---------|------------|
| 开发 | `env.config.js` | `localhost:3000` |
| 生产 | `env.prod.config.js` | `119.23.253.225:80` |

**生产发布前需要检查的配置项：**

| 配置键 | 说明 |
|--------|------|
| `SERVER` | 后端 API 服务器地址 |
| `SERVER_PORT` | 后端 API 端口 |
| `RSA_PUBLIC_KEY` | JWT RS256 公钥（用于验证 access_token） |
| `ENCRYPTION_KEY` | Token 本地加密密钥（AES-256-CBC） |
| `DIRECT_LOAD_LAST_PAGE` | 是否直接恢复上次页面（跳过登录） |
| `DEVTOOLS_NETWORK_VISIBLE` | 是否显示 DevTools |

## 5. 版本发布流程

```
代码开发 & 测试
  │
  ├── 1. npm test（确保所有测试通过）
  ├── 2. 更新 package.json 中的 version 字段
  ├── 3. 构建依赖子项目
  │     ├── cd ../login-page && npm run build
  │     └── cd ../front-2.1 && npm run build
  ├── 4. 同步 dist/ 目录
  │     ├── 复制 login-page/dist/ 产物
  │     └── 复制 front-2.1/dist/ 产物
  ├── 5. npm run build（打包为 NSIS 安装器）
  ├── 6. 测试安装器
  │     └── 在干净的 Windows 环境安装并验证功能
  └── 7. 发布 release/ 目录下的安装程序
```

## 6. 安装与卸载

### 安装

运行 `HR管理系统 Setup x.x.x.exe`，按安装向导完成安装。默认安装目录为 `%LOCALAPPDATA%\HR管理系统\`。

安装过程中 electron-builder 的 NSIS 安装器处理：
- Squirrel 事件（安装、更新、卸载）
- 快捷方式创建（桌面、开始菜单）
- 注册表写入

### 卸载

通过 Windows 控制面板 → 程序和功能 → 卸载，或运行安装目录下的 `Uninstall HR管理系统.exe`。

## 7. 目录结构（安装后）

```
%LOCALAPPDATA%\HR管理系统\
├── HR管理系统.exe              # 主程序入口
├── resources\
│   └── app.asar               # 打包的应用代码
├── dist/                       # 前端资源
│   ├── login.html
│   ├── [contenthash].html
│   └── asset/
└── config.json                 # 用户配置（electron-store）
```

## 8. ASAR 打包说明

应用代码打包为 `app.asar` 归档文件。以下模块因包含原生依赖或需要文件路径引用而**解包**（unpacked）：
- `electron-store` — 需要文件系统访问存储配置
- `jose` — 包含原生加密模块

## 9. 调试打包问题

### 安装后白屏
- 检查 `dist/` 目录是否包含所有需要的 HTML 和资源文件
- 检查 `env.prod.config.js` 中的 `SERVER` 地址是否正确
- 打开 DevTools（设置 `DEVTOOLS_NETWORK_VISIBLE: true`）查看控制台错误

### 网络请求失败
- 确认后端服务 `SERVER:SERVER_PORT` 可达
- 检查防火墙是否阻止了出站连接
- 验证 `RSA_PUBLIC_KEY` 与服务器端的私钥匹配

### 打包体积过大
- 确认 `node_modules` 中没有不必要的开发依赖
- electron-builder 自动排除 `devDependencies`
- 大型资源文件考虑外部加载而非打包

## 10. 持续集成（可选）

可通过 GitHub Actions 实现自动化构建：

```yaml
# .github/workflows/build.yml 示例要点
# 1. Windows runner
# 2. 构建 login-page 和 front-2.1
# 3. 复制 dist/ 产物
# 4. npm run build（electron-builder）
# 5. 上传 release/ 产物
```

## 11. 技术参考

| 工具 | 版本 | 用途 |
|------|------|------|
| Electron | 34.2.0 | 桌面应用框架 |
| electron-builder | 26 | Windows 安装器打包 |
| electron-forge | 7.6 | 开发打包（备选） |
| electron-store | 10 | 配置持久化 |
| jose | 6 | JWT 验证库 |
| Jest | 30 | 测试框架 |
| fast-check | 4.5 | 属性测试 |
