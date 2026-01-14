/**
 * 知乎页面下载器
 *
 * 使用方法:
 *   node index.js login             扫码登录
 *   node index.js crawl [--max n]   随机深度优先爬取
 *   node index.js topic <url>       收集话题问题加入队列
 *   node index.js init <file>       从 result.json 初始化数据
 *   node index.js status            查看数据状态
 *   node index.js download <url>    下载单个页面
 *   node index.js extract <file>    提取文本
 */

const { downloadPage } = require('./download');
const { extractFromFile } = require('./extract');
const { seedTopic } = require('./topic');
const { login } = require('./login');
const { initFromResult } = require('./init');
const { showStatus } = require('./storage');
const { crawl } = require('./crawler');
const { logger } = require('./utils');

function printUsage() {
  console.log('知乎页面下载器');
  console.log('');
  console.log('用法:');
  console.log('  node index.js login              扫码登录知乎');
  console.log('  node index.js crawl [--max n]    随机深度优先爬取队列');
  console.log('  node index.js topic <url>        收集话题所有标签页问题加入队列');
  console.log('  node index.js init <file>        从 result.json 初始化数据结构');
  console.log('  node index.js status             查看数据状态');
  console.log('  node index.js download <url>     下载单个页面');
  console.log('  node index.js extract <file>     提取文本');
  console.log('');
  console.log('示例:');
  console.log('  node index.js login');
  console.log('  node index.js crawl --max 10');
  console.log('  node index.js topic https://www.zhihu.com/topic/20075371');
  console.log('  node index.js init output/topic_xxx/result.json');
  console.log('  node index.js status');
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const target = args[1];

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }

  try {
    switch (command) {
      case 'login':
        await login();
        break;

      case 'download':
        if (!target) {
          logger.error('请提供 URL');
          process.exit(1);
        }
        await downloadPage(target);
        break;

      case 'extract':
        if (!target) {
          logger.error('请提供 HTML 文件路径');
          process.exit(1);
        }
        extractFromFile(target);
        break;

      case 'topic':
        if (!target) {
          logger.error('请提供话题 URL');
          process.exit(1);
        }
        await seedTopic(target);
        break;

      case 'init':
        if (!target) {
          logger.error('请提供 result.json 文件路径');
          process.exit(1);
        }
        await initFromResult(target);
        break;

      case 'status':
        showStatus();
        break;

      case 'crawl':
        const crawlOptions = {};
        const maxIdx = args.indexOf('--max');
        if (maxIdx !== -1 && args[maxIdx + 1]) {
          crawlOptions.max = parseInt(args[maxIdx + 1]);
        }
        await crawl(crawlOptions);
        break;

      default:
        logger.error(`未知命令: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (err) {
    logger.error(err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  downloadPage,
  extractFromFile,
  seedTopic,
  login,
  initFromResult,
  showStatus,
  crawl,
};
