const fs = require('fs');
const path = require('path');
const config = require('./config');
const { randomDelay, logger, ensureDir, randomInt } = require('./utils');
const { createBrowser, createPage, closeLoginModal } = require('./browser');
const { applyCookies, hasCookies } = require('./login');

// ============ 配置 ============
const TOPIC_CONFIG = {
  tabs: {
    discussion: { name: '讨论', path: 'hot' },
    featured: { name: '精华', path: 'top-answers' },
  },
  scrollConfig: {
    maxScrolls: 2000,           // 最大滚动次数
    minDelay: 1500,           // 最小延迟 (ms)
    maxDelay: 3500,           // 最大延迟 (ms)
    scrollDistance: { min: 300, max: 600 },
  },
};

// ============ 创建输出目录 ============
function createTopicOutputDir(topicId) {
  const timestamp = new Date().toISOString().slice(0, 10);
  const dirName = `topic_${topicId}_${timestamp}`;
  const outputDir = path.join(config.outputDir, dirName);
  ensureDir(outputDir);
  return outputDir;
}

// ============ 截图函数 ============
async function takeScreenshot(page, outputDir, stepName) {
  const filepath = path.join(outputDir, `${stepName}.png`);
  try {
    await page.screenshot({ path: filepath, fullPage: false });
    logger.done(`截图: ${stepName}.png`);
  } catch (e) {
    logger.warn(`截图失败: ${stepName}`);
  }
  return filepath;
}

// ============ 模拟真实用户滚动 ============
async function humanLikeScroll(page, outputDir, scrollCount = 0) {
  const { scrollDistance, minDelay, maxDelay } = TOPIC_CONFIG.scrollConfig;

  // 随机滚动距离
  const distance = randomInt(scrollDistance.min, scrollDistance.max);

  // 模拟人类滚动行为
  await page.evaluate(async (dist) => {
    // 随机选择滚动方式
    const useSmooth = Math.random() > 0.3;
    if (useSmooth) {
      window.scrollBy({ top: dist, behavior: 'smooth' });
    } else {
      window.scrollBy(0, dist);
    }
  }, distance);

  // 随机暂停（模拟阅读）
  const delay = randomInt(minDelay, maxDelay);
  await new Promise(r => setTimeout(r, delay));

  // 偶尔截图记录
  if (scrollCount % 5 === 0) {
    await takeScreenshot(page, outputDir, `scroll_${scrollCount}`);
  }

  // 偶尔移动鼠标
  if (Math.random() > 0.7) {
    const viewport = page.viewport();
    const x = randomInt(100, viewport.width - 100);
    const y = randomInt(100, viewport.height - 100);
    await page.mouse.move(x, y, { steps: randomInt(5, 15) });
  }
}

// ============ 深度滚动加载更多内容 ============
async function deepScroll(page, outputDir, maxScrolls = TOPIC_CONFIG.scrollConfig.maxScrolls) {
  logger.step(`开始深度滚动加载 (最多 ${maxScrolls} 次)`);

  let previousHeight = 0;
  let noChangeCount = 0;

  for (let i = 0; i < maxScrolls; i++) {
    // 获取当前高度
    const currentHeight = await page.evaluate(() => document.body.scrollHeight);

    // 检查是否还有新内容
    if (currentHeight === previousHeight) {
      noChangeCount++;
      if (noChangeCount >= 3) {
        logger.info(`内容已加载完毕 (滚动 ${i} 次)`);
        break;
      }
    } else {
      noChangeCount = 0;
    }

    previousHeight = currentHeight;

    // 执行人类化滚动
    await humanLikeScroll(page, outputDir, i);

    // 关闭可能出现的弹窗
    if (i % 3 === 0) {
      await closeLoginModal(page);
    }

    logger.info(`滚动进度: ${i + 1}/${maxScrolls}`);
  }

  // 滚回顶部
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await randomDelay(1000, 2000);
}

// ============ 提取话题信息 ============
async function extractTopicInfo(page) {
  return page.evaluate(() => {
    const info = {
      name: '',
      description: '',
      followersCount: '',
      questionsCount: '',
    };

    // 话题名称
    const nameEl = document.querySelector('.TopicMetaCard-title, h1');
    if (nameEl) info.name = nameEl.innerText.trim();

    // 话题描述
    const descEl = document.querySelector('.TopicMetaCard-description');
    if (descEl) info.description = descEl.innerText.trim();

    // 关注数
    const statsEls = document.querySelectorAll('.TopicMetaCard-fansCount, .NumberBoard-itemValue');
    if (statsEls.length >= 1) info.followersCount = statsEls[0]?.innerText?.trim() || '';
    if (statsEls.length >= 2) info.questionsCount = statsEls[1]?.innerText?.trim() || '';

    return info;
  });
}

// ============ 提取内容列表 ============
async function extractContentItems(page) {
  return page.evaluate(() => {
    const items = [];
    const seen = new Set();

    // 查找所有 data-zop 元素
    document.querySelectorAll('[data-zop]').forEach(el => {
      try {
        const zopData = JSON.parse(el.getAttribute('data-zop'));
        const itemId = zopData.itemId;

        // 去重
        if (seen.has(itemId)) return;
        seen.add(itemId);

        const item = {
          id: itemId,
          type: zopData.type || 'unknown',
          title: zopData.title || '',
          authorName: zopData.authorName || '',
          url: '',
          excerpt: '',
          voteCount: '',
          commentCount: '',
          createdTime: '',
        };

        // 查找链接
        const linkEl = el.querySelector('a[href*="/question/"], a[href*="/answer/"], a[href*="/p/"]');
        if (linkEl) {
          item.url = linkEl.href;
        }

        // 查找摘要
        const excerptEl = el.querySelector('.RichContent-inner, .RichText');
        if (excerptEl) {
          item.excerpt = excerptEl.innerText.slice(0, 500).trim();
        }

        // 查找点赞数
        const voteEl = el.querySelector('[class*="VoteButton"] .Button-label, .ContentItem-actions button');
        if (voteEl) {
          const voteText = voteEl.innerText;
          if (voteText && /\d/.test(voteText)) {
            item.voteCount = voteText.trim();
          }
        }

        // 查找评论数
        const commentEl = el.querySelector('[class*="comment"] .Button-label');
        if (commentEl) {
          item.commentCount = commentEl.innerText.trim();
        }

        // 查找时间
        const timeEl = el.querySelector('.ContentItem-time, time, [class*="time"]');
        if (timeEl) {
          item.createdTime = timeEl.innerText.trim();
        }

        items.push(item);
      } catch (e) {
        // ignore parse errors
      }
    });

    return items;
  });
}

// ============ 爬取单个 Tab ============
async function crawlTab(page, outputDir, topicId, tabKey, tabConfig) {
  const tabUrl = `https://www.zhihu.com/topic/${topicId}/${tabConfig.path}`;
  logger.step(`爬取 ${tabConfig.name}: ${tabUrl}`);

  // 访问 tab 页面
  await page.goto(tabUrl, {
    waitUntil: 'networkidle2',
    timeout: config.timeout,
  });

  await randomDelay(2000, 4000);
  await closeLoginModal(page);
  await takeScreenshot(page, outputDir, `${tabKey}_initial`);

  // 深度滚动加载更多
  await deepScroll(page, outputDir);

  // 最终截图
  await takeScreenshot(page, outputDir, `${tabKey}_final`);

  // 提取内容
  const items = await extractContentItems(page);
  logger.done(`${tabConfig.name}: 提取 ${items.length} 条内容`);

  // 保存 HTML
  const html = await page.content();
  const htmlPath = path.join(outputDir, `${tabKey}.html`);
  fs.writeFileSync(htmlPath, html, 'utf-8');

  return {
    tab: tabKey,
    name: tabConfig.name,
    url: tabUrl,
    itemCount: items.length,
    items,
  };
}

// ============ 主爬取函数 ============
async function crawlTopic(topicUrl) {
  // 解析 topic ID
  const topicMatch = topicUrl.match(/topic\/(\d+)/);
  if (!topicMatch) {
    throw new Error('无效的话题 URL');
  }
  const topicId = topicMatch[1];

  logger.info(`开始爬取话题: ${topicId}`);

  // 创建输出目录
  const outputDir = createTopicOutputDir(topicId);
  logger.info(`输出目录: ${outputDir}`);

  const browser = await createBrowser();

  try {
    const page = await createPage(browser);

    // 应用登录状态
    if (hasCookies()) {
      logger.step('应用登录状态');
      await applyCookies(page);
    }

    // 先访问首页
    logger.step('访问知乎首页');
    await page.goto('https://www.zhihu.com', {
      waitUntil: 'networkidle2',
      timeout: config.timeout,
    });
    await randomDelay(2000, 3000);
    await closeLoginModal(page);

    // 访问话题页面
    logger.step('访问话题页面');
    await page.goto(topicUrl, {
      waitUntil: 'networkidle2',
      timeout: config.timeout,
    });
    await randomDelay(2000, 4000);
    await closeLoginModal(page);
    await takeScreenshot(page, outputDir, 'topic_overview');

    // 提取话题信息
    const topicInfo = await extractTopicInfo(page);
    logger.info(`话题: ${topicInfo.name}`);

    // 结果对象
    const result = {
      meta: {
        topicId,
        topicUrl,
        crawledAt: new Date().toISOString(),
        outputDir,
      },
      topic: topicInfo,
      tabs: {},
    };

    // 爬取讨论 tab
    result.tabs.discussion = await crawlTab(
      page, outputDir, topicId,
      'discussion', TOPIC_CONFIG.tabs.discussion
    );
    await randomDelay(3000, 5000);

    // 爬取精华 tab
    result.tabs.featured = await crawlTab(
      page, outputDir, topicId,
      'featured', TOPIC_CONFIG.tabs.featured
    );

    // 保存 JSON 结果
    const jsonPath = path.join(outputDir, 'result.json');
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf-8');
    logger.done(`结果已保存: ${jsonPath}`);

    // 打印统计
    logger.info('========================================');
    logger.info(`话题: ${topicInfo.name}`);
    logger.info(`讨论: ${result.tabs.discussion.itemCount} 条`);
    logger.info(`精华: ${result.tabs.featured.itemCount} 条`);
    logger.info(`输出: ${outputDir}`);
    logger.info('========================================');

    return result;

  } finally {
    await browser.close();
    logger.info('浏览器已关闭');
  }
}

// ============ CLI ============
function printUsage() {
  console.log('用法: node topic.js <topic_url>');
  console.log('');
  console.log('示例:');
  console.log('  node topic.js "https://www.zhihu.com/topic/27814732/hot"');
  console.log('  node topic.js "https://www.zhihu.com/topic/27814732"');
}

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.includes('--help') ? 0 : 1);
  }

  const topicUrl = args[0];

  crawlTopic(topicUrl)
    .then(() => {
      console.log('\n爬取完成!');
      process.exit(0);
    })
    .catch((err) => {
      logger.error(err.message);
      process.exit(1);
    });
}

module.exports = { crawlTopic, TOPIC_CONFIG };
