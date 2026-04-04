/**
 * 系统信息模块
 * 负责获取系统相关信息，如MAC地址、设备ID、CPU信息等
 */

const os = require('os');
const ChildProcess = require('child_process');

/**
 * 系统信息类
 * 提供获取各种系统信息的方法
 */
class SystemInfo {
  static MAC_PRIORITY = ['以太网', 'Ethernet', 'WLAN', 'Wi-Fi'];

  /**
   * 获取 MAC 地址，返回 "网卡名=MAC" 格式。
   *
   * @param {string} [interfaceName] - 指定网卡名称。
   *   传入时仅查询该网卡；不传时按 MAC_PRIORITY 顺序查找，
   *   优先级列表都未命中则按名称排序取第一个可用网卡。
   * @returns {string} "网卡名=MAC" 或 'MAC Address Not Found'
   */
  getMAC(interfaceName) {
    const interfaces = os.networkInterfaces();

    if (interfaceName) {
      const mac = this._findMac(interfaces, interfaceName);
      if (mac) return `${interfaceName}=${mac}`;
      return 'MAC Address Not Found';
    }

    for (const name of SystemInfo.MAC_PRIORITY) {
      const mac = this._findMac(interfaces, name);
      if (mac) return `${name}=${mac}`;
    }

    for (const name of Object.keys(interfaces).sort()) {
      const mac = this._findMac(interfaces, name);
      if (mac) return `${name}=${mac}`;
    }

    return 'MAC Address Not Found';
  }

  /** @private */
  _findMac(interfaces, name) {
    if (!interfaces[name]) return null;
    for (const iface of interfaces[name]) {
      if (!iface.internal && iface.mac !== '00:00:00:00:00:00') {
        return iface.mac;
      }
    }
    return null;
  }

  /**
   * 获取设备唯一识别码
   * @returns {string} 设备主机名
   */
  getDeviceId() {
    const hostname = os.hostname();
    return hostname;
  }

  /**
   * 获取CPU唯一码
   * @returns {string} CPU型号或错误信息
   */
  getCpuId() {
    const cpus = os.cpus();
    if (cpus && cpus.length > 0) {
      const cpu = cpus[0];
      return cpu.model;
    }
    return 'CPU ID Not Found';
  }

  /**
   * 获取磁盘唯一码
   * @returns {string} 磁盘序列号或错误信息
   */
  getDiskId() {
    try {
      let diskSerial = '';
      if (process.platform === 'win32') {
        // 使用wmic获取磁盘序列号（适用于Windows）
        const stdout = ChildProcess.execSync('wmic diskdrive get SerialNumber /format:list', { encoding: 'utf8' });
        const lines = stdout.split('\n').filter(line => line.includes('SerialNumber'));
        if (lines.length > 0) {
          diskSerial = lines[0].split('=')[1].trim();
        }
      } else {
        // 对于非Windows平台，返回默认的磁盘码或实现特定平台的逻辑
        diskSerial = 'nonWindowsDiskId';
      }
      if (!diskSerial) diskSerial = 'Disk Code Not Found';
      return diskSerial;
    } catch (error) {
      return 'Disk Code Not Found';
    }
  }

  /**
   * 获取所有系统信息
   * @returns {Object} 包含所有系统信息的对象
   */
  getAllSystemInfo() {
    return {
      mac: this.getMAC(),
      deviceId: this.getDeviceId(),
      cpuId: this.getCpuId(),
      diskId: this.getDiskId(),
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      hostname: os.hostname(),
      userInfo: os.userInfo()
    };
  }
}

module.exports = SystemInfo;
