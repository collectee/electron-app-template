// 格式化iat和exp为YYYY-MM-DD hh:mm:ss
function formatTimestamp(ts) {
    if (!ts) return ts;
    const date = new Date(ts * 1000);
    const pad = n => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

module.exports = { formatTimestamp };