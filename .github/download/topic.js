const fs = require('fs');
const path = require('path');
const config = require('./config');
const { randomDelay, logger, ensureDir, randomInt } = require('./utils');
const { createBrowser, createPage, closeLoginModal } = require('./browser');
const { applyCookies, hasCookies } = require('./login');

// ============ 配置 ============
const TOPIC_CONFIG = {
  scrollConfig: {
    minDelay: 2000,
    maxDelay: 4000,
    scrollDistance: { min: 300, max: 700 },
    mouseMoveProbability: 0.3,
    pauseProbability: 0.1,
    pauseDuration: { min: 3000, max: 8000 },
  },
};

// ============ 数据收集器 ============
class DataCollector {
  constructor(outputDir) {
    this.outputDir = outputDir;
    this.apiLogs = [];
    this.results = new Map(); // 用 id 去重
    this.apiFile = path.join(outputDir, 'api.json');
    this.resultFile = path.join(outputDir, 'result.json');
    this.seenIds = new Set();
  }

  addApiLog(log) {
    this.apiLogs.push(log);
  }

  addResult(item) {
    const id = item.id;
    if (id && !this.seenIds.has(id)) {
      this.seenIds.add(id);
      this.results.set(id, item);
      return true;
    }
    return false;
  }

  getResultCount() {
    return this.results.size;
  }

  save() {
    // 保存 API 日志
    fs.writeFileSync(this.apiFile, JSON.stringify(this.apiLogs, null, 2), 'utf-8');

    // 保存结果
    const resultData = {
      meta: {
        savedAt: new Date().toISOString(),
        totalItems: this.results.size,
        totalApiCalls: this.apiLogs.length,
      },
      items: Array.from(this.results.values()),
    };
    fs.writeFileSync(this.resultFile, JSON.stringify(resultData, null, 2), 'utf-8');
  }
}

// ============ 创建输出目录 ============
function createTopicOutputDir(topicId) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dirName = `topic_${topicId}_${timestamp}`;
  const outputDir = path.join(config.outputDir, dirName);
  ensureDir(outputDir);
  return outputDir;
}

// ============ 截图 ============
async function takeScreenshot(page, outputDir, name) {
  const filepath = path.join(outputDir, `${name}.png`);
  try {
    await page.screenshot({ path: filepath, fullPage: false });
  } catch (e) {
    // ignore
  }
  return filepath;
}

// ============ 解析 API 响应中的内容项 ============
function parseContentItem(item) {
  try {
    const target = item.target || {};
    const author = target.author || {};

    return {
      id: target.id || item.id,
      type: target.type || item.type,
      feedType: item.type,
      url: target.url || '',
      title: target.excerpt_title || target.title || '',
      excerpt: target.excerpt || '',
      content: target.content || '',
      voteupCount: target.voteup_count || 0,
      commentCount: target.comment_count || 0,
      createdTime: target.created_time || target.created || null,
      updatedTime: target.updated_time || target.updated || null,
      author: {
        id: author.id || '',
        name: author.name || '',
        url: author.url || '',
        avatarUrl: author.avatar_url || '',
        headline: author.headline || '',
      },
      question: target.question ? {
        id: target.question.id,
        title: target.question.title,
        url: target.question.url,
      } : null,
      imageUrl: target.image_url || '',
      thumbnailUrl: target.thumbnail || '',
      rawData: item, // 保留原始数据
    };
  } catch (e) {
    return null;
  }
}

// ============ 模拟真实用户行为 ============
async function humanBehavior(page) {
  const cfg = TOPIC_CONFIG.scrollConfig;

  // 随机滚动距离
  const distance = randomInt(cfg.scrollDistance.min, cfg.scrollDistance.max);

  // 随机选择滚动方式
  const scrollType = Math.random();
  if (scrollType < 0.6) {
    // 平滑滚动
    await page.evaluate((d) => {
      window.scrollBy({ top: d, behavior: 'smooth' });
    }, distance);
  } else if (scrollType < 0.9) {
    // 直接滚动
    await page.evaluate((d) => {
      window.scrollBy(0, d);
    }, distance);
  } else {
    // 滚动到某个元素
    await page.evaluate(() => {
      const items = document.querySelectorAll('.TopicFeedItem, .ContentItem');
      if (items.length > 0) {
        const randomItem = items[Math.floor(Math.random() * items.length)];
        randomItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  // 基础延迟
  await randomDelay(cfg.minDelay, cfg.maxDelay);

  // 随机移动鼠标
  if (Math.random() < cfg.mouseMoveProbability) {
    try {
      const viewport = page.viewport();
      const x = randomInt(100, viewport.width - 100);
      const y = randomInt(100, viewport.height - 100);
      await page.mouse.move(x, y, { steps: randomInt(5, 20) });
    } catch (e) {
      // ignore
    }
  }

  // 偶尔长暂停（模拟阅读）
  if (Math.random() < cfg.pauseProbability) {
    const pauseTime = randomInt(cfg.pauseDuration.min, cfg.pauseDuration.max);
    logger.info(`模拟阅读暂停 ${(pauseTime / 1000).toFixed(1)}s`);
    await new Promise(r => setTimeout(r, pauseTime));
  }
}

// ============ 设置 API 拦截 ============
function setupApiInterceptor(page, collector) {
  // 拦截请求
  page.on('request', request => {
    const url = request.url();
    if (url.includes('/api/') || url.includes('zhihu.com/api')) {
      collector.addApiLog({
        timestamp: new Date().toISOString(),
        type: 'request',
        method: request.method(),
        url: url,
        resourceType: request.resourceType(),
      });
    }
  });

  // 拦截响应并解析数据
  page.on('response', async response => {
    const url = response.url();

    // 只处理 feeds API
    if (url.includes('/feeds/') && url.includes('/api/')) {
      try {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('json')) {
          const body = await response.json().catch(() => null);

          collector.addApiLog({
            timestamp: new Date().toISOString(),
            type: 'response',
            url: url,
            status: response.status(),
            paging: body?.paging || null,
            dataCount: body?.data?.length || 0,
          });

          // 解析并保存数据
          if (body && body.data && Array.isArray(body.data)) {
            let newCount = 0;
            for (const item of body.data) {
              const parsed = parseContentItem(item);
              if (parsed && collector.addResult(parsed)) {
                newCount++;
              }
            }
            if (newCount > 0) {
              logger.info(`[API] 新增 ${newCount} 条，总计 ${collector.getResultCount()} 条`);
              collector.save(); // 每次有新数据就保存
            }
          }
        }
      } catch (e) {
        // ignore parse errors
      }
    }
  });
}

// ============ 主爬取函数 ============
async function crawlTopic(topicUrl, maxScrolls = 2000) {
  // 解析 topic ID
  const topicMatch = topicUrl.match(/topic\/(\d+)/);
  if (!topicMatch) {
    throw new Error('无效的话题 URL');
  }
  const topicId = topicMatch[1];

  logger.info(`开始爬取话题: ${topicId}`);
  logger.info(`最大滚动次数: ${maxScrolls}`);

  // 创建输出目录
  const outputDir = createTopicOutputDir(topicId);
  logger.info(`输出目录: ${outputDir}`);

  // 创建数据收集器
  const collector = new DataCollector(outputDir);

  const browser = await createBrowser();

  try {
    const page = await createPage(browser);

    // 设置 API 拦截
    setupApiInterceptor(page, collector);

    // 应用登录状态
    if (hasCookies()) {
      logger.step('应用登录状态');
      await applyCookies(page);
    }

    // 访问首页
    logger.step('访问知乎首页');
    await page.goto('https://www.zhihu.com', {
      waitUntil: 'networkidle2',
      timeout: config.timeout,
    });
    await randomDelay(2000, 4000);
    await closeLoginModal(page);

    // 访问话题页面
    logger.step('访问话题页面');
    await page.goto(topicUrl, {
      waitUntil: 'networkidle2',
      timeout: config.timeout,
    });
    await randomDelay(3000, 5000);
    await closeLoginModal(page);
    await takeScreenshot(page, outputDir, 'initial');

    // 提取话题基本信息
    const topicInfo = await page.evaluate(() => {
      return {
        name: document.querySelector('.TopicMetaCard-title, h1')?.innerText?.trim() || '',
        description: document.querySelector('.TopicMetaCard-description')?.innerText?.trim() || '',
      };
    });
    logger.info(`话题: ${topicInfo.name}`);

    // 保存话题信息到 collector
    collector.addApiLog({
      type: 'topic_info',
      topicId,
      topicUrl,
      ...topicInfo,
      timestamp: new Date().toISOString(),
    });

    // 开始持续滚动
    logger.step(`开始滚动爬取 (Ctrl+C 停止)`);

    for (let i = 0; i < maxScrolls; i++) {
      // 执行人类化行为
      await humanBehavior(page);

      // 每隔一段时间关闭弹窗
      if (i % 10 === 0) {
        await closeLoginModal(page);
      }

      // 每隔一段时间截图
      if (i % 50 === 0 && i > 0) {
        await takeScreenshot(page, outputDir, `scroll_${i}`);
      }

      // 日志
      if (i % 10 === 0) {
        logger.info(`[滚动 ${i}] 已收集 ${collector.getResultCount()} 条`);
      }
    }

    // 最终截图
    await takeScreenshot(page, outputDir, 'final');

  } catch (err) {
    if (err.message.includes('Target closed')) {
      logger.info('浏览器已关闭');
    } else {
      logger.error(err.message);
    }
  } finally {
    // 最终保存
    collector.save();
    await browser.close();

    logger.info('========================================');
    logger.info(`爬取完成`);
    logger.info(`总计收集: ${collector.getResultCount()} 条`);
    logger.info(`API 日志: ${collector.apiLogs.length} 条`);
    logger.info(`输出目录: ${outputDir}`);
    logger.info('========================================');
  }

  return {
    outputDir,
    itemCount: collector.getResultCount(),
    apiCount: collector.apiLogs.length,
  };
}

// 处理 Ctrl+C
process.on('SIGINT', () => {
  logger.warn('收到停止信号，正在保存...');
  // collector.save() 会在 finally 中调用
  process.exit(0);
});

// ============ CLI ============
function printUsage() {
  console.log('用法: node topic.js <topic_url> [max_scrolls]');
  console.log('');
  console.log('示例:');
  console.log('  node topic.js "https://www.zhihu.com/topic/27814732"');
  console.log('  node topic.js "https://www.zhihu.com/topic/27814732/hot" 500');
}

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.includes('--help') ? 0 : 1);
  }

  const topicUrl = args[0];
  const maxScrolls = parseInt(args[1]) || 2000;

  crawlTopic(topicUrl, maxScrolls);
}

module.exports = { crawlTopic, TOPIC_CONFIG };
