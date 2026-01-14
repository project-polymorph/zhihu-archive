const fs = require('fs');
const path = require('path');
const config = require('./config');
const { logger, ensureDir } = require('./utils');
const { createBrowser, createPage, getBrowserArgs } = require('./browser');

const COOKIES_FILE = path.join(__dirname, 'cookies.json');
const QR_CODE_FILE = path.join(__dirname, 'output', 'qrcode.png');

// ============ Cookie 管理 ============
function saveCookies(cookies) {
  fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
  logger.done(`Cookies 已保存到: ${COOKIES_FILE}`);
}

function loadCookies() {
  if (fs.existsSync(COOKIES_FILE)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf-8'));
    logger.info(`已加载 Cookies: ${cookies.length} 条`);
    return cookies;
  }
  return null;
}

function hasCookies() {
  return fs.existsSync(COOKIES_FILE);
}

// ============ 提取二维码 ============
async function extractQRCode(page) {
  ensureDir(path.dirname(QR_CODE_FILE));

  logger.step('等待二维码加载...');

  // 等待页面稳定
  await new Promise(r => setTimeout(r, 2000));

  // 直接截取整个页面（更可靠）
  const fullPageFile = path.join(path.dirname(QR_CODE_FILE), 'login-page.png');
  await page.screenshot({ path: fullPageFile, fullPage: false });
  logger.done(`登录页面已保存: ${fullPageFile}`);

  // 同时尝试提取二维码元素
  try {
    const qrSelectors = [
      '.Qrcode-img',
      'img[alt*="二维码"]',
      'img[src*="qrcode"]',
      '.Login-qrcode img',
    ];

    for (const selector of qrSelectors) {
      try {
        const qrElement = await page.$(selector);
        if (qrElement) {
          await qrElement.screenshot({ path: QR_CODE_FILE });
          logger.done(`二维码已保存: ${QR_CODE_FILE}`);
          break;
        }
      } catch (e) {
        // ignore
      }
    }
  } catch (err) {
    // ignore
  }

  return fullPageFile;
}

// ============ 等待登录成功 ============
async function waitForLogin(page, timeout = 120000) {
  logger.step('等待扫码登录...');
  logger.info('请使用知乎 App 扫描二维码');
  logger.info(`二维码位置: ${QR_CODE_FILE}`);
  logger.info(`超时时间: ${timeout / 1000} 秒`);

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      // 检查是否已登录（URL 变化或出现用户头像）
      const url = page.url();

      // 如果页面跳转到首页，说明登录成功
      if (url === 'https://www.zhihu.com/' || (url.includes('zhihu.com') && !url.includes('signin'))) {
        await new Promise(r => setTimeout(r, 2000));
        const cookies = await page.cookies();
        const hasZc0 = cookies.some(c => c.name === 'z_c0');
        if (hasZc0) {
          logger.done('登录成功!');
          return true;
        }
      }

      // 检查登录成功的标志
      const isLoggedIn = await page.evaluate(() => {
        const avatar = document.querySelector('.Avatar, .AppHeader-profile, [class*="ProfileAvatar"]');
        const loginBtn = document.querySelector('.SignContainer, .AppHeader-login');
        const hasToken = document.cookie.includes('z_c0');
        return (avatar && !loginBtn) || hasToken;
      }).catch(() => false);

      if (isLoggedIn) {
        await new Promise(r => setTimeout(r, 2000));
        const cookies = await page.cookies();
        const hasZc0 = cookies.some(c => c.name === 'z_c0');
        if (hasZc0) {
          logger.done('登录成功!');
          return true;
        }
      }

      // 检查二维码是否过期
      const isExpired = await page.evaluate(() => {
        const expiredText = document.body.innerText;
        return expiredText.includes('二维码已过期') || expiredText.includes('刷新');
      }).catch(() => false);

      if (isExpired) {
        logger.warn('二维码已过期，正在刷新...');
        await page.evaluate(() => {
          const refreshBtn = document.querySelector('[class*="refresh"], [class*="Refresh"]');
          if (refreshBtn) refreshBtn.click();
        }).catch(() => {});
        await new Promise(r => setTimeout(r, 2000));
        await extractQRCode(page);
      }

    } catch (err) {
      // 页面可能发生了跳转，检查 cookies
      try {
        const cookies = await page.cookies();
        const hasZc0 = cookies.some(c => c.name === 'z_c0');
        if (hasZc0) {
          logger.done('登录成功! (页面已跳转)');
          return true;
        }
      } catch (e) {
        // ignore
      }
    }

    await new Promise(r => setTimeout(r, 2000));
    process.stdout.write('.');
  }

  logger.error('登录超时');
  return false;
}

// ============ 截图辅助函数 ============
async function takeScreenshot(page, name) {
  const filepath = path.join(__dirname, 'output', `${name}.png`);
  try {
    await page.screenshot({ path: filepath, fullPage: false });
    logger.done(`截图已保存: ${filepath}`);
  } catch (e) {
    logger.warn(`截图失败: ${name}`);
  }
  return filepath;
}

// ============ 主登录函数 ============
async function login() {
  logger.info('启动知乎扫码登录');
  ensureDir(path.join(__dirname, 'output'));

  const browser = await createBrowser();

  try {
    const page = await createPage(browser);

    // 步骤1: 访问知乎登录页
    logger.step('步骤1: 打开知乎登录页...');
    await page.goto('https://www.zhihu.com/signin', {
      waitUntil: 'networkidle2',
      timeout: config.timeout,
    });
    await new Promise(r => setTimeout(r, 3000));
    await takeScreenshot(page, 'step1-signin-page');

    // 步骤2: 切换到二维码登录
    logger.step('步骤2: 切换到二维码登录...');
    await page.evaluate(() => {
      const qrLoginBtns = document.querySelectorAll('[class*="QRCode"], [class*="qrcode"], span');
      qrLoginBtns.forEach(btn => {
        if (btn.innerText && btn.innerText.includes('二维码')) {
          btn.click();
        }
      });
    });
    await new Promise(r => setTimeout(r, 2000));
    await takeScreenshot(page, 'step2-qrcode-page');

    // 步骤3: 提取二维码
    logger.step('步骤3: 提取二维码...');
    await extractQRCode(page);

    // 打印二维码路径
    console.log('\n========================================');
    console.log('请打开以下文件查看二维码：');
    console.log(QR_CODE_FILE);
    console.log('使用知乎 App 扫描登录');
    console.log('========================================\n');

    // 步骤4: 等待登录
    logger.step('步骤4: 等待扫码...');
    const success = await waitForLogin(page);

    if (success) {
      // 步骤5: 登录成功，截图
      logger.step('步骤5: 登录成功，保存状态...');
      await takeScreenshot(page, 'step5-login-success');

      // 保存 cookies
      const cookies = await page.cookies();
      saveCookies(cookies);

      // 访问首页确认
      logger.step('步骤6: 访问首页确认登录状态...');
      await page.goto('https://www.zhihu.com', {
        waitUntil: 'networkidle2',
        timeout: config.timeout,
      });
      await new Promise(r => setTimeout(r, 2000));
      await takeScreenshot(page, 'step6-homepage-loggedin');

      return true;
    }

    // 登录失败截图
    await takeScreenshot(page, 'login-failed');
    return false;

  } finally {
    await browser.close();
    logger.info('浏览器已关闭');
  }
}

// ============ 应用已保存的 Cookies ============
async function applyCookies(page) {
  const cookies = loadCookies();
  if (cookies) {
    await page.setCookie(...cookies);
    logger.info('已应用保存的 Cookies');
    return true;
  }
  return false;
}

// ============ CLI ============
if (require.main === module) {
  login()
    .then((success) => {
      if (success) {
        console.log('\n登录成功! 现在可以下载需要登录的页面了。');
      } else {
        console.log('\n登录失败或超时。');
      }
      process.exit(success ? 0 : 1);
    })
    .catch((err) => {
      logger.error(err.message);
      process.exit(1);
    });
}

module.exports = {
  login,
  loadCookies,
  saveCookies,
  applyCookies,
  hasCookies,
  COOKIES_FILE,
};
