const { contextBridge, ipcRenderer } = require('electron');

// 暴露 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
	// 调用主进程获取 MAC 地址
	getMAC: () => ipcRenderer.invoke('get-mac'),
	// 检查 JWT 是否有效
	checkJwt: (token) => ipcRenderer.invoke('check-jwt', token),
	// 保存 JWT
	saveJwt: (token) => ipcRenderer.invoke('save-jwt', token),	
	// 保存 Access Token 和 Refresh Token
	saveTokens: (accessToken, refreshToken, indexUrl) => ipcRenderer.invoke('save-tokens', accessToken, refreshToken,indexUrl),
	// 获取 Access Token
	getAccessToken: () => ipcRenderer.invoke('get-access-token'),
	// 获取 Refresh Token
	getRefreshToken: () => ipcRenderer.invoke('get-refresh-token'),
	// 导航到指定 HTML 文件
	navigate: (htmlPath) => ipcRenderer.invoke('navigate', htmlPath),
	// 新增：导航到示例页面
	navigateToExample: () => ipcRenderer.invoke('navigate-to-example'),
	// 新增：通用导航方法，支持相对路径和绝对路径
	navigateTo: (path) => {
		if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('file://')) {
			// 绝对路径直接导航
			window.location.href = path;
		} else if (path.endsWith('.html')) {
			// HTML文件通过IPC导航
			return ipcRenderer.invoke('navigate', path.replace('.html', ''));
		} else {
			// 其他情况作为页面名称处理
			return ipcRenderer.invoke('navigate', path);
		}
	},
	// 新增：获取当前页面信息
	getCurrentPage: () => {
		return {
			url: window.location.href,
			title: document.title,
			path: window.location.pathname
		};
	},
	// 新增：浏览器历史操作
	goBack: () => ipcRenderer.invoke('go-back'),
	goForward: () => ipcRenderer.invoke('go-forward'),
	reload: () => ipcRenderer.invoke('reload-page'),
	// 新增：打开外部链接
	openExternal: (url) => ipcRenderer.invoke('open-external', url),
	// 新增：代理HTTP请求
	proxyRequest: (requestConfig) => ipcRenderer.invoke('proxy-request', requestConfig),
	// 新增：配置管理 API
	// 获取配置
	getConfig: (key) => ipcRenderer.invoke('get-config', key),
	// 设置配置
	setConfig: (key, value) => ipcRenderer.invoke('set-config', key, value),
	// 更新多个配置
	updateConfigs: (configs) => ipcRenderer.invoke('update-configs', configs),
	// 重置配置
	resetConfig: () => ipcRenderer.invoke('reset-config'),
	// 监听主进程消息
	onMessage: (callback) => ipcRenderer.on('message', callback),
	// 新增：监听JWT验证结果
	onJwtValidated: (callback) => {
		// 移除之前的监听器避免重复
		ipcRenderer.removeAllListeners('jwt-validated');
		// 添加新的监听器
		ipcRenderer.on('jwt-validated', (event, isValid, jwtData) => {
			callback(isValid, jwtData);
		});
	},
	// 新增：移除JWT验证监听器
	removeJwtValidatedListener: () => {
		ipcRenderer.removeAllListeners('jwt-validated');
	},
	// 新增：监听登录页面验证结果
	onLoginValidated: (callback) => {
		// 移除之前的监听器避免重复
		ipcRenderer.removeAllListeners('login-validated');
		// 添加新的监听器
		ipcRenderer.on('login-validated', (event, isValid, loginData) => {
			callback(isValid, loginData);
		});
	},
	// 新增：移除登录验证监听器
	removeLoginValidatedListener: () => {
		ipcRenderer.removeAllListeners('login-validated');
	},
	// 登出（清除所有认证数据和页面记录，跳转登录页）
	logout: () => ipcRenderer.invoke('logout'),
	// 清除最后访问的页面记录
	clearLastVisited: () => ipcRenderer.invoke('clear-last-visited'),

	verifyStoredJwt: () => ipcRenderer.send('verify-stored-jwt'),

	// 窗口控制 API（无边框模式下的自定义标题栏使用）
	windowMinimize: () => ipcRenderer.invoke('window-minimize'),
	windowMaximize: () => ipcRenderer.invoke('window-maximize'),
	windowClose: () => ipcRenderer.invoke('window-close'),
	windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
	onWindowMaximizeChange: (callback) => {
		ipcRenderer.removeAllListeners('window-maximize-change');
		ipcRenderer.on('window-maximize-change', (event, isMaximized) => {
			callback(isMaximized);
		});
	},

}); 