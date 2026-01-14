const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const config = require('./config');
const { randomChoice, randomDelay, randomInt, logger } = require('./utils');

// 启用 stealth 插件
puppeteer.use(StealthPlugin());

// ============ 浏览器启动参数 ============
function getBrowserArgs() {
  return [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    `--window-size=${config.viewport.width},${config.viewport.height}`,
    '--lang=zh-CN,zh',
    '--disable-web-security',
    '--disable-features=IsolateOrigins,site-per-process',
    '--user-data-dir=/tmp/chrome-profile-' + Date.now(),
  ];
}

// ============ HTTP 请求头 ============
function getHeaders() {
  return {
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'sec-ch-ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
  };
}

// ============ 反检测注入 - 核心 ============
async function injectAntiDetection(page) {
  await page.evaluateOnNewDocument(() => {
    // 1. 删除 webdriver 属性
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
    delete navigator.__proto__.webdriver;

    // 2. 伪装 plugins（模拟真实浏览器插件）
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      ],
    });

    // 3. 伪装 languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['zh-CN', 'zh', 'en-US', 'en'],
    });

    // 4. 伪装 platform
    Object.defineProperty(navigator, 'platform', {
      get: () => 'Win32',
    });

    // 5. 伪装 hardwareConcurrency（CPU 核心数）
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => 8,
    });

    // 6. 伪装 deviceMemory
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => 8,
    });

    // 7. 添加 chrome 对象
    window.chrome = {
      runtime: {
        PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
        PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformNaclArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
        RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
        OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
        OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
      },
      loadTimes: function() {
        return {
          requestTime: Date.now() / 1000 - Math.random() * 100,
          startLoadTime: Date.now() / 1000 - Math.random() * 50,
          commitLoadTime: Date.now() / 1000 - Math.random() * 30,
          finishDocumentLoadTime: Date.now() / 1000 - Math.random() * 10,
          finishLoadTime: Date.now() / 1000 - Math.random() * 5,
          firstPaintTime: Date.now() / 1000 - Math.random() * 20,
          firstPaintAfterLoadTime: 0,
          navigationType: 'Other',
        };
      },
      csi: function() {
        return { onloadT: Date.now(), pageT: Date.now() - Math.random() * 10000, startE: Date.now() - Math.random() * 20000, tran: 15 };
      },
      app: {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      },
    };

    // 8. 伪装权限查询
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters)
    );

    // 9. 伪装 WebGL 渲染器
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.call(this, parameter);
    };

    // 10. 覆盖 toString 方法防止检测
    const originalToString = Function.prototype.toString;
    Function.prototype.toString = function() {
      if (this === navigator.permissions.query) {
        return 'function query() { [native code] }';
      }
      return originalToString.call(this);
    };
  });
}

// ============ 关闭登录弹窗 ============
async function closeLoginModal(page) {
  try {
    // 方法1: DOM 操作移除弹窗
    await page.evaluate(() => {
      // 点击关闭按钮
      const closeSelectors = [
        '.Modal-closeButton',
        '.css-1qvk9q3',
        'button[aria-label="关闭"]',
        '.SignFlowModal-close',
        '[class*="Modal"] [class*="close"]',
      ];
      closeSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(btn => btn.click());
      });

      // 直接移除弹窗元素
      const removeSelectors = [
        '.Modal-wrapper',
        '.signFlowModal',
        '[class*="SignFlowModal"]',
        '.Modal-backdrop',
        '.Modal-overlay',
      ];
      removeSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => el.remove());
      });

      // 恢复页面滚动
      document.body.style.overflow = 'auto';
      document.documentElement.style.overflow = 'auto';
    });

    // 方法2: 点击关闭按钮
    const closeButtonSelectors = [
      'button.Modal-closeButton',
      '.Modal-wrapper button.Button--plain',
      'svg.css-1qvk9q3',
      '[class*="close"]',
      '.Button--plain[aria-label="关闭"]',
    ];

    for (const selector of closeButtonSelectors) {
      try {
        const btn = await page.$(selector);
        if (btn) {
          await btn.click();
          await randomDelay(200, 400);
        }
      } catch (e) {
        // ignore
      }
    }

    // 方法3: 按 Escape 键
    await page.keyboard.press('Escape');
    await randomDelay(200, 300);

  } catch (e) {
    // ignore errors
  }
}

// ============ 模拟鼠标移动 ============
async function simulateMouseMovement(page) {
  try {
    const viewport = page.viewport();
    const movements = randomInt(3, 7);

    for (let i = 0; i < movements; i++) {
      const x = randomInt(100, viewport.width - 100);
      const y = randomInt(100, viewport.height - 100);
      await page.mouse.move(x, y, { steps: randomInt(5, 15) });
      await randomDelay(50, 150);
    }
  } catch (e) {
    // ignore
  }
}

// ============ 模拟滚动 ============
async function autoScroll(page, maxHeight = 5000) {
  await page.evaluate(async (max) => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = Math.floor(Math.random() * 200) + 200;
      const baseDelay = 100;

      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        const randomOffset = Math.floor(Math.random() * 50) - 25;
        window.scrollBy(0, distance + randomOffset);
        totalHeight += distance;

        if (totalHeight >= scrollHeight || totalHeight >= max) {
          clearInterval(timer);
          setTimeout(() => {
            window.scrollTo(0, 0);
            resolve();
          }, 500);
        }
      }, baseDelay + Math.floor(Math.random() * 100));
    });
  }, maxHeight);
}

// ============ 创建浏览器实例 ============
async function createBrowser() {
  return puppeteer.launch({
    headless: 'new',
    args: getBrowserArgs(),
  });
}

// ============ 创建页面并配置 ============
async function createPage(browser) {
  const page = await browser.newPage();

  // 注入反检测
  await injectAntiDetection(page);

  // 设置视窗
  await page.setViewport({
    ...config.viewport,
    deviceScaleFactor: 1,
  });

  // 设置请求头
  await page.setExtraHTTPHeaders(getHeaders());

  // 设置 User-Agent
  await page.setUserAgent(randomChoice(config.userAgents));

  return page;
}

module.exports = {
  createBrowser,
  createPage,
  closeLoginModal,
  simulateMouseMovement,
  autoScroll,
  injectAntiDetection,
  getBrowserArgs,
  getHeaders,
};
