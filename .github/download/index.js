/**
 * 知乎页面下载器
 *
 * 使用方法:
 *   node index.js download <url>    下载页面
 *   node index.js extract <file>    提取文本
 *   node index.js all <url>         下载并提取
 */

const { downloadPage } = require('./download');
const { extractFromFile } = require('./extract');
const { logger } = require('./utils');

async function downloadAndExtract(url) {
  // 下载
  const downloadResult = await downloadPage(url);

  // 提取
  const extractResult = extractFromFile(downloadResult.htmlPath);

  return {
    download: downloadResult,
    extract: extractResult,
  };
}

function printUsage() {
  console.log('知乎页面下载器');
  console.log('');
  console.log('用法:');
  console.log('  node index.js download <url>    下载页面');
  console.log('  node index.js extract <file>    提取文本');
  console.log('  node index.js all <url>         下载并提取');
  console.log('');
  console.log('示例:');
  console.log('  node index.js download "https://www.zhihu.com/question/xxx/answer/xxx"');
  console.log('  node index.js extract output/zhihu-answer-xxx.html');
  console.log('  node index.js all "https://www.zhihu.com/question/xxx/answer/xxx"');
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

      case 'all':
        if (!target) {
          logger.error('请提供 URL');
          process.exit(1);
        }
        await downloadAndExtract(target);
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
  downloadAndExtract,
};
