/**
 * 网络模块入口文件
 * 导出网络请求相关的所有功能
 */

const RequestProxy = require('./RequestProxy');
const UrlInterceptor = require('./UrlInterceptor');

module.exports = {
  RequestProxy,
  UrlInterceptor
};
