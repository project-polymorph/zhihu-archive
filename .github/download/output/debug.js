/**
 * 调试脚本 - 捕捉网络流量并手动操作
 */

const fs = require('fs');
const path = require('path');
const { createBrowser, createPage, closeLoginModal } = require('../browser');
const { applyCookies, hasCookies } = require('../login');
const { logger, ensureDir, randomDelay } = require('../utils');
const config = require('../config');

const OUTPUT_DIR = path.join(__dirname, 'output', 'debug_' + Date.now());

// 存储网络请求
const networkLogs = [];
const apiCalls = [];

async function debug(url) {
  ensureDir(OUTPUT_DIR);
  logger.info(`调试模式启动`);
  logger.info(`输出目录: ${OUTPUT_DIR}`);

  const browser = await createBrowser();

  try {
    const page = await createPage(browser);

    // ========== 设置网络监听 ==========
    logger.step('设置网络监听...');

    // 监听所有请求
    page.on('request', request => {
      const reqData = {
        timestamp: new Date().toISOString(),
        type: 'request',
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
        headers: request.headers(),
      };
      networkLogs.push(reqData);

      // 过滤 API 调用
      if (request.url().includes('/api/') ||
          request.url().includes('zhihu.com/api') ||
          request.resourceType() === 'xhr' ||
          request.resourceType() === 'fetch') {
        apiCalls.push(reqData);
        logger.info(`[API] ${request.method()} ${request.url().slice(0, 100)}`);
      }
    });

    // 监听所有响应
    page.on('response', async response => {
      const resData = {
        timestamp: new Date().toISOString(),
        type: 'response',
        status: response.status(),
        url: response.url(),
        headers: response.headers(),
      };

      // 捕捉 API 响应内容
      if (response.url().includes('/api/') ||
          response.url().includes('zhihu.com/api')) {
        try {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('json')) {
            resData.body = await response.json().catch(() => null);
          }
        } catch (e) {
          // ignore
        }
        apiCalls.push(resData);
      }

      networkLogs.push(resData);
    });

    // 应用登录状态
    if (hasCookies()) {
      logger.step('应用登录状态');
      await applyCookies(page);
    }

    // 访问首页
    logger.step('访问知乎首页...');
    await page.goto('https://www.zhihu.com', {
      waitUntil: 'networkidle2',
      timeout: config.timeout,
    });
    await randomDelay(2000, 3000);
    await closeLoginModal(page);

    // 访问目标页面
    logger.step(`访问目标页面: ${url}`);
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: config.timeout,
    });
    await randomDelay(2000, 3000);
    await closeLoginModal(page);

    // 截图
    await page.screenshot({
      path: path.join(OUTPUT_DIR, 'initial.png'),
      fullPage: false
    });
    logger.done('初始截图已保存');

    // ========== 开始滚动测试 ==========
    logger.step('开始滚动测试 (按 Ctrl+C 停止)');
    logger.info('每次滚动会记录网络请求...');

    let scrollCount = 0;
    let previousHeight = 0;
    let previousApiCount = apiCalls.length;

    // 持续滚动直到手动停止
    while (true) {
      scrollCount++;

      // 获取当前页面高度
      const currentHeight = await page.evaluate(() => document.body.scrollHeight);
      const currentApiCount = apiCalls.length;
      const newApis = currentApiCount - previousApiCount;

      logger.info(`[滚动 ${scrollCount}] 高度: ${currentHeight}, 新API: ${newApis}`);

      // 执行滚动
      await page.evaluate(() => {
        const distance = Math.floor(Math.random() * 400) + 300;
        window.scrollBy({ top: distance, behavior: 'smooth' });
      });

      // 随机延迟 (模拟真实用户)
      const delay = Math.floor(Math.random() * 2000) + 1500;
      await new Promise(r => setTimeout(r, delay));

      // 每 10 次滚动保存一次数据
      if (scrollCount % 10 === 0) {
        await saveData(scrollCount);
        await page.screenshot({
          path: path.join(OUTPUT_DIR, `scroll_${scrollCount}.png`),
          fullPage: false
        });
      }

      // 检查是否到底
      if (currentHeight === previousHeight) {
        logger.warn('页面高度不变，可能已到底');
      }

      previousHeight = currentHeight;
      previousApiCount = currentApiCount;

      // 关闭弹窗
      if (scrollCount % 5 === 0) {
        await closeLoginModal(page);
      }
    }

  } catch (err) {
    if (err.message.includes('Target closed') || err.message.includes('Session closed')) {
      logger.info('浏览器已关闭');
    } else {
      logger.error(err.message);
    }
  } finally {
    // 保存最终数据
    await saveData('final');
    await browser.close();
    logger.info('调试结束');
  }
}

async function saveData(suffix) {
  // 保存网络日志
  const networkPath = path.join(OUTPUT_DIR, `network_${suffix}.json`);
  fs.writeFileSync(networkPath, JSON.stringify(networkLogs, null, 2));

  // 保存 API 调用
  const apiPath = path.join(OUTPUT_DIR, `api_${suffix}.json`);
  fs.writeFileSync(apiPath, JSON.stringify(apiCalls, null, 2));

  logger.done(`数据已保存: network_${suffix}.json, api_${suffix}.json`);
  logger.info(`总网络请求: ${networkLogs.length}, API调用: ${apiCalls.length}`);
}

// 处理 Ctrl+C
process.on('SIGINT', async () => {
  logger.warn('收到停止信号，保存数据...');
  await saveData('interrupted');
  process.exit(0);
});

// CLI
if (require.main === module) {
  const url = process.argv[2] || 'https://www.zhihu.com/topic/27814732/hot';
  debug(url);
}

module.exports = { debug };
