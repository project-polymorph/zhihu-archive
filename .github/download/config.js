const path = require('path');

module.exports = {
  // 输出目录
  outputDir: path.join(__dirname, 'output'),

  // 超时设置
  timeout: 60000,

  // 视窗大小
  viewport: { width: 1920, height: 1080 },

  // User-Agent 列表（随机选择）
  userAgents: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  ],

  // 延迟配置
  delay: {
    min: 1000,
    max: 3000,
    scroll: { min: 100, max: 200 },
  },

  // 默认 URL
  defaultUrl: 'https://www.zhihu.com/topic/27814732/hot',
};
