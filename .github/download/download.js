const fs = require('fs');
const config = require('./config');
const { randomDelay, generateFilename, getOutputPath, logger } = require('./utils');
const { createBrowser, createPage, closeLoginModal, simulateMouseMovement, autoScroll } = require('./browser');
const { applyCookies, hasCookies } = require('./login');

// ============ 保存结果 ============
async function saveResults(page, url) {
  const html = await page.content();
  const basename = generateFilename(url);

  const htmlPath = getOutputPath(basename, '.html');
  const pngPath = getOutputPath(basename, '.png');

  fs.writeFileSync(htmlPath, html, 'utf-8');
  await page.screenshot({ path: pngPath, fullPage: true });

  return {
    basename,
    htmlPath,
    pngPath,
    size: html.length,
  };
}

// ============ 访问知乎首页获取 cookies ============
async function warmup(page) {
  // 如果有保存的 cookies，先应用
  if (hasCookies()) {
    logger.step('应用已保存的登录状态');
    await applyCookies(page);
  }

  logger.step('访问知乎首页');
  await page.goto('https://www.zhihu.com', {
    waitUntil: 'networkidle2',
    timeout: config.timeout,
  });

  await closeLoginModal(page);
  await randomDelay(2000, 3000);
}

// ============ 访问目标页面 ============
async function visitPage(page, url) {
  logger.step('加载目标页面');
  await page.goto(url, {
    waitUntil: 'networkidle2',
    timeout: config.timeout,
  });

  await page.waitForSelector('body', { timeout: 10000 });
  await randomDelay(2000, 3000);
  await closeLoginModal(page);
}

// ============ 模拟用户行为 ============
async function simulateUserBehavior(page) {
  logger.step('模拟用户行为');

  // 鼠标移动
  await simulateMouseMovement(page);
  await randomDelay(500, 1000);

  // 滚动页面
  await autoScroll(page, 5000);
  await randomDelay(2000, 3000);

  // 再次关闭可能出现的弹窗
  await closeLoginModal(page);
}

// ============ 主下载函数 ============
async function downloadPage(url = config.defaultUrl) {
  logger.info(`开始下载: ${url}`);

  const browser = await createBrowser();

  try {
    const page = await createPage(browser);

    // 1. 预热（获取 cookies）
    await warmup(page);

    // 2. 访问目标页面
    await visitPage(page, url);

    // 3. 模拟用户行为
    await simulateUserBehavior(page);

    // 4. 保存结果
    logger.step('保存文件');
    const result = await saveResults(page, url);

    logger.done(`HTML: ${result.htmlPath}`);
    logger.done(`PNG: ${result.pngPath}`);
    logger.done(`大小: ${(result.size / 1024).toFixed(2)} KB`);

    return result;

  } finally {
    await browser.close();
    logger.info('浏览器已关闭');
  }
}

// ============ CLI ============
function printUsage() {
  console.log('用法: node download.js [url]');
  console.log('');
  console.log('示例:');
  console.log('  node download.js');
  console.log('  node download.js "https://www.zhihu.com/question/xxx/answer/xxx"');
}

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const url = args[0] || config.defaultUrl;

  downloadPage(url)
    .then((result) => {
      console.log('\n下载完成!');
      process.exit(0);
    })
    .catch((err) => {
      logger.error(err.message);
      process.exit(1);
    });
}

module.exports = { downloadPage };
