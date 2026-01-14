/**
 * 话题种子爬取 - 收集话题下所有问题加入队列
 *
 * 作为 crawler.js 的子命令使用:
 *   node crawler.js topic <url>
 *   node crawler.js topic https://www.zhihu.com/topic/20075371
 */

const config = require('./config');
const { randomDelay, logger, randomInt } = require('./utils');
const { createBrowser, createPage, closeLoginModal } = require('./browser');
const { applyCookies, hasCookies } = require('./login');
const {
  ensureDataDirs,
  VisitedSet,
  CrawlQueue,
  Storage,
} = require('./storage');

// 话题页面的所有标签
const TOPIC_TABS = [
  { name: '精华', path: '/top-answers' },
  { name: '讨论', path: '/hot' },
  { name: '最新', path: '/newest' },
  // { name: '待回答', path: '/unanswered' },  // 通常内容少，跳过
];

// 滚动配置
const SCROLL_CONFIG = {
  minDelay: 2000,
  maxDelay: 4000,
  scrollDistance: { min: 400, max: 800 },
  maxScrollsPerTab: 50,  // 每个标签页最多滚动次数
};

/**
 * 模拟人类滚动行为
 */
async function humanScroll(page) {
  const distance = randomInt(SCROLL_CONFIG.scrollDistance.min, SCROLL_CONFIG.scrollDistance.max);

  if (Math.random() < 0.7) {
    await page.evaluate((d) => {
      window.scrollBy({ top: d, behavior: 'smooth' });
    }, distance);
  } else {
    await page.evaluate((d) => {
      window.scrollBy(0, d);
    }, distance);
  }

  await randomDelay(SCROLL_CONFIG.minDelay, SCROLL_CONFIG.maxDelay);

  // 偶尔移动鼠标
  if (Math.random() < 0.2) {
    try {
      const viewport = page.viewport();
      const x = randomInt(100, viewport.width - 100);
      const y = randomInt(100, viewport.height - 100);
      await page.mouse.move(x, y, { steps: randomInt(5, 15) });
    } catch (e) {
      // ignore
    }
  }
}

/**
 * 爬取单个标签页，收集问题和文章
 */
async function crawlTab(page, topicId, tabPath, tabName, collectedQuestions, collectedArticles) {
  const url = `https://www.zhihu.com/topic/${topicId}${tabPath}`;
  logger.step(`爬取标签: ${tabName} (${url})`);

  const questionsInTab = new Set();
  const articlesInTab = new Set();

  // 设置 API 拦截
  const apiHandler = async (response) => {
    const respUrl = response.url();

    try {
      const contentType = response.headers()['content-type'] || '';
      if (!contentType.includes('json')) return;

      // 拦截话题 feeds API
      if (respUrl.includes('/feeds/') || respUrl.includes('/top-answers') ||
          respUrl.includes('/top_activity')) {
        const body = await response.json().catch(() => null);
        if (body && body.data && Array.isArray(body.data)) {
          for (const item of body.data) {
            const target = item.target || item;

            // 从回答中提取问题
            if (target.question && target.question.id) {
              const qId = String(target.question.id);
              if (!questionsInTab.has(qId)) {
                questionsInTab.add(qId);
                collectedQuestions.set(qId, {
                  id: qId,
                  title: target.question.title || '',
                  source: `topic:${topicId}:${tabPath}`,
                });
              }
            }

            // 直接是问题
            if (target.type === 'question' && target.id) {
              const qId = String(target.id);
              if (!questionsInTab.has(qId)) {
                questionsInTab.add(qId);
                collectedQuestions.set(qId, {
                  id: qId,
                  title: target.title || '',
                  source: `topic:${topicId}:${tabPath}`,
                });
              }
            }

            // 文章
            if (target.type === 'article' && target.id) {
              const aId = String(target.id);
              if (!articlesInTab.has(aId)) {
                articlesInTab.add(aId);
                collectedArticles.set(aId, {
                  id: aId,
                  title: target.title || '',
                  source: `topic:${topicId}:${tabPath}`,
                });
              }
            }
          }
          logger.info(`  [API] 问题 ${questionsInTab.size}, 文章 ${articlesInTab.size}`);
        }
      }
    } catch (e) {
      // ignore
    }
  };

  page.on('response', apiHandler);

  try {
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: config.timeout,
    });
    await randomDelay(2000, 4000);
    await closeLoginModal(page);

    // 滚动加载更多
    let noNewCount = 0;
    let lastCount = collectedQuestions.size + collectedArticles.size;

    for (let i = 0; i < SCROLL_CONFIG.maxScrollsPerTab; i++) {
      await humanScroll(page);

      if (i % 5 === 0) {
        await closeLoginModal(page);
      }

      // 检查是否有新内容
      const currentCount = collectedQuestions.size + collectedArticles.size;
      if (currentCount === lastCount) {
        noNewCount++;
        if (noNewCount >= 5) {
          logger.info(`  连续 ${noNewCount} 次无新内容，切换下一标签`);
          break;
        }
      } else {
        noNewCount = 0;
        lastCount = currentCount;
      }

      if (i % 10 === 0) {
        logger.info(`  [滚动 ${i}] 问题 ${questionsInTab.size}, 文章 ${articlesInTab.size}`);
      }
    }

    // ========== 从 DOM 提取 SSR 文章 ==========
    const ssrArticles = await page.evaluate(() => {
      const articles = [];
      document.querySelectorAll('a[href*="zhuanlan.zhihu.com/p/"]').forEach(el => {
        const href = el.getAttribute('href') || '';
        const match = href.match(/zhuanlan\.zhihu\.com\/p\/(\d+)/);
        if (match) {
          const articleId = match[1];
          // 尝试获取标题
          const titleEl = el.closest('.ContentItem')?.querySelector('.ContentItem-title') ||
                          el.closest('.List-item')?.querySelector('h2');
          articles.push({
            id: articleId,
            title: titleEl?.innerText?.trim() || el.innerText?.trim() || '',
          });
        }
      });
      return articles;
    });

    for (const art of ssrArticles) {
      if (art.id && !articlesInTab.has(art.id)) {
        articlesInTab.add(art.id);
        collectedArticles.set(art.id, {
          id: art.id,
          title: art.title,
          source: `topic:${topicId}:${tabPath}:ssr`,
        });
      }
    }

    if (ssrArticles.length > 0) {
      logger.info(`  [DOM] 提取到 ${ssrArticles.length} 篇 SSR 文章`);
    }

  } finally {
    page.off('response', apiHandler);
  }

  logger.done(`  ${tabName} 完成: 问题 ${questionsInTab.size}, 文章 ${articlesInTab.size}`);
  return { questions: questionsInTab.size, articles: articlesInTab.size };
}

/**
 * 爬取话题 - 收集所有标签页的问题并加入队列
 */
async function seedTopic(topicUrl, options = {}) {
  // 解析 topic ID
  const topicMatch = topicUrl.match(/topic\/(\d+)/);
  if (!topicMatch) {
    throw new Error('无效的话题 URL，格式: https://www.zhihu.com/topic/12345');
  }
  const topicId = topicMatch[1];

  logger.info(`========================================`);
  logger.info(`话题种子爬取: ${topicId}`);
  logger.info(`========================================`);

  ensureDataDirs();

  const visited = new VisitedSet();
  const queue = new CrawlQueue();
  const collectedQuestions = new Map();  // id -> {id, title, source}
  const collectedArticles = new Map();   // id -> {id, title, source}
  let topicName = '';

  const browser = await createBrowser();

  try {
    const page = await createPage(browser);

    // 登录
    if (hasCookies()) {
      logger.step('应用登录状态');
      await applyCookies(page);
    }

    // 预热
    logger.step('访问首页预热');
    await page.goto('https://www.zhihu.com', {
      waitUntil: 'networkidle2',
      timeout: config.timeout,
    });
    await randomDelay(2000, 4000);
    await closeLoginModal(page);

    // 访问话题主页获取话题信息
    logger.step('获取话题信息');
    await page.goto(`https://www.zhihu.com/topic/${topicId}`, {
      waitUntil: 'networkidle2',
      timeout: config.timeout,
    });
    await randomDelay(2000, 3000);
    await closeLoginModal(page);

    const topicInfo = await page.evaluate(() => {
      return {
        name: document.querySelector('.TopicMetaCard-title, h1')?.innerText?.trim() || '',
        description: document.querySelector('.TopicMetaCard-description')?.innerText?.trim() || '',
        followerCount: document.querySelector('.NumberBoard-itemValue')?.innerText?.trim() || '',
      };
    });

    topicName = topicInfo.name;
    logger.info(`话题名称: ${topicName}`);
    logger.info(`关注人数: ${topicInfo.followerCount}`);

    // 保存话题信息
    Storage.saveTopic(topicId, {
      id: topicId,
      name: topicInfo.name,
      description: topicInfo.description,
      followerCount: topicInfo.followerCount,
      url: `https://www.zhihu.com/topic/${topicId}`,
    });

    // 爬取每个标签页
    for (const tab of TOPIC_TABS) {
      try {
        await crawlTab(page, topicId, tab.path, tab.name, collectedQuestions, collectedArticles);
        await randomDelay(3000, 5000);  // 标签页之间休息
      } catch (err) {
        logger.error(`标签 ${tab.name} 爬取失败: ${err.message}`);
      }
    }

  } finally {
    await browser.close();
  }

  // 将收集的问题和文章加入队列
  logger.step('将问题和文章加入队列');

  let addedQuestions = 0;
  let addedArticles = 0;
  let skippedCount = 0;

  // 问题
  for (const [qId, qInfo] of collectedQuestions) {
    const visitKey = `question:${qId}`;
    if (visited.has(visitKey)) {
      skippedCount++;
      continue;
    }

    queue.add({
      type: 'question',
      id: qId,
      priority: 2,
      source: qInfo.source,
      title: qInfo.title,
    });
    addedQuestions++;
  }

  // 文章
  for (const [aId, aInfo] of collectedArticles) {
    const visitKey = `article:${aId}`;
    if (visited.has(visitKey)) {
      skippedCount++;
      continue;
    }

    queue.add({
      type: 'article',
      id: aId,
      priority: 3,
      source: aInfo.source,
      title: aInfo.title,
    });
    addedArticles++;
  }

  // 清理队列去重
  queue.compact(visited);

  // 更新话题信息，保存问题和文章列表
  const questionList = Array.from(collectedQuestions.values()).map(q => ({
    id: q.id,
    title: q.title,
    source: q.source,
  }));

  const articleList = Array.from(collectedArticles.values()).map(a => ({
    id: a.id,
    title: a.title,
    source: a.source,
  }));

  Storage.saveTopic(topicId, {
    id: topicId,
    name: topicName,
    url: `https://www.zhihu.com/topic/${topicId}`,
    questions: questionList,
    questionCount: questionList.length,
    articles: articleList,
    articleCount: articleList.length,
    crawledAt: new Date().toISOString(),
  });

  logger.info(`========================================`);
  logger.info(`话题种子爬取完成`);
  logger.info(`话题: ${topicName || topicId}`);
  logger.info(`收集问题: ${collectedQuestions.size}`);
  logger.info(`收集文章: ${collectedArticles.size}`);
  logger.info(`新增队列: ${addedQuestions} 问题, ${addedArticles} 文章`);
  logger.info(`已访问跳过: ${skippedCount}`);
  logger.info(`当前队列: ${queue.size()} 项`);
  logger.info(`========================================`);

  return {
    topicId,
    collectedQuestions: collectedQuestions.size,
    collectedArticles: collectedArticles.size,
    addedQuestions,
    addedArticles,
    skipped: skippedCount,
  };
}

module.exports = { seedTopic, TOPIC_TABS };
