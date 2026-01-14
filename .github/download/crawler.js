/**
 * 随机深度优先爬虫
 *
 * 用法:
 *   node crawler.js                    # 从队列继续爬取
 *   node crawler.js --max 100          # 最多爬取100个
 *   node crawler.js --seed <topic_url> # 添加种子话题
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { createBrowser, createPage, closeLoginModal } = require('./browser');
const { applyCookies, hasCookies } = require('./login');
const { logger, randomDelay, randomInt, ensureDir } = require('./utils');
const {
  ensureDataDirs,
  VisitedSet,
  CrawlQueue,
  Storage,
  showStatus,
} = require('./storage');

// ============ 爬虫配置 ============
const CRAWLER_CONFIG = {
  // 延迟配置（模拟真实用户）
  delay: {
    pageLoad: { min: 3000, max: 6000 },      // 页面加载后等待
    beforeScroll: { min: 1000, max: 2000 },  // 滚动前等待
    afterScroll: { min: 2000, max: 4000 },   // 滚动后等待
    betweenPages: { min: 5000, max: 10000 }, // 页面之间等待
    reading: { min: 8000, max: 15000 },      // 模拟阅读
  },
  // 行为概率
  behavior: {
    readingPause: 0.2,      // 20% 概率长暂停模拟阅读
    mouseMove: 0.3,         // 30% 概率移动鼠标
    randomClick: 0.1,       // 10% 概率随机点击（展开等）
  },
  // 滚动配置
  scroll: {
    distance: { min: 300, max: 600 },
    maxScrolls: 10,  // 每页最多滚动次数
  },
  // 发现新内容的概率
  discovery: {
    followAuthor: 0.1,       // 10% 概率探索作者
    followRecommend: 0.2,    // 20% 概率探索推荐内容
  },
};

// ============ 人类行为模拟 ============
class HumanBehavior {
  constructor(page) {
    this.page = page;
  }

  // 随机延迟
  async delay(type = 'afterScroll') {
    const cfg = CRAWLER_CONFIG.delay[type] || CRAWLER_CONFIG.delay.afterScroll;
    const ms = randomInt(cfg.min, cfg.max);
    logger.info(`  等待 ${(ms / 1000).toFixed(1)}s...`);
    await new Promise(r => setTimeout(r, ms));
  }

  // 移动鼠标
  async moveMouse() {
    if (Math.random() > CRAWLER_CONFIG.behavior.mouseMove) return;

    try {
      const viewport = this.page.viewport();
      const x = randomInt(100, viewport.width - 100);
      const y = randomInt(100, viewport.height - 100);
      await this.page.mouse.move(x, y, { steps: randomInt(10, 30) });
      logger.info(`  移动鼠标到 (${x}, ${y})`);
    } catch (e) {
      // ignore
    }
  }

  // 滚动页面
  async scroll() {
    const distance = randomInt(
      CRAWLER_CONFIG.scroll.distance.min,
      CRAWLER_CONFIG.scroll.distance.max
    );

    const scrollType = Math.random();
    if (scrollType < 0.6) {
      // 平滑滚动
      await this.page.evaluate((d) => {
        window.scrollBy({ top: d, behavior: 'smooth' });
      }, distance);
    } else if (scrollType < 0.9) {
      // 直接滚动
      await this.page.evaluate((d) => {
        window.scrollBy(0, d);
      }, distance);
    } else {
      // 滚动到随机元素
      await this.page.evaluate(() => {
        const items = document.querySelectorAll('.ContentItem, .AnswerItem, .List-item');
        if (items.length > 0) {
          const idx = Math.floor(Math.random() * items.length);
          items[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    }
  }

  // 模拟阅读暂停
  async readingPause() {
    if (Math.random() > CRAWLER_CONFIG.behavior.readingPause) return;

    const ms = randomInt(
      CRAWLER_CONFIG.delay.reading.min,
      CRAWLER_CONFIG.delay.reading.max
    );
    logger.info(`  模拟阅读 ${(ms / 1000).toFixed(1)}s...`);
    await new Promise(r => setTimeout(r, ms));
  }

  // 完整的人类行为序列
  async act() {
    await this.moveMouse();
    await this.delay('beforeScroll');
    await this.scroll();
    await this.delay('afterScroll');
    await this.readingPause();
  }
}

// ============ 问题页面爬取 ============
async function crawlQuestion(page, questionId, visited, queue, human) {
  const url = `https://www.zhihu.com/question/${questionId}`;
  logger.step(`爬取问题: ${questionId}`);

  const savedAnswerIds = new Set();  // 已保存的回答 ID
  const relatedQuestions = [];
  let questionInfo = null;
  let totalCollected = 0;
  let newSaved = 0;

  // 设置 API 拦截 - 立刻保存
  const apiHandler = async (response) => {
    const respUrl = response.url();

    try {
      const contentType = response.headers()['content-type'] || '';
      if (!contentType.includes('json')) return;

      // 拦截回答列表 API - 立刻保存每个回答
      if (respUrl.includes(`/questions/${questionId}/feeds`) ||
          respUrl.includes(`/questions/${questionId}/answers`)) {
        const body = await response.json().catch(() => null);
        if (body && body.data && Array.isArray(body.data)) {
          for (const item of body.data) {
            const target = item.target || item;
            if (target.id && target.type === 'answer') {
              const answerId = String(target.id);
              totalCollected++;

              // 检查是否已保存
              if (savedAnswerIds.has(answerId)) continue;
              const visitKey = `answer:${answerId}`;
              if (visited.has(visitKey)) {
                savedAnswerIds.add(answerId);
                continue;
              }

              // 立刻保存回答
              const hotComment = target.hot_comment;
              const answerData = {
                id: answerId,
                content: target.content || '',
                excerpt: target.excerpt || '',
                voteupCount: target.voteup_count || 0,
                commentCount: target.comment_count || 0,
                createdTime: target.created_time,
                updatedTime: target.updated_time,
                author: target.author ? {
                  id: target.author.id,
                  name: target.author.name,
                  headline: target.author.headline || '',
                  avatarUrl: target.author.avatar_url || '',
                } : {},
                hotComment: hotComment ? {
                  id: hotComment.id,
                  content: hotComment.content,
                  likeCount: hotComment.like_count,
                  author: hotComment.author ? { name: hotComment.author.name } : null,
                } : null,
              };

              // 立刻保存到文件
              Storage.saveAnswer(questionId, answerId, answerData);
              visited.add(visitKey);
              savedAnswerIds.add(answerId);
              newSaved++;

              // 保存作者
              if (target.author && target.author.id) {
                Storage.saveAuthor(target.author.id, {
                  id: target.author.id,
                  name: target.author.name,
                  headline: target.author.headline || '',
                  avatarUrl: target.author.avatar_url || '',
                });
              }
            }
          }
          logger.info(`  [API] 收集 ${totalCollected} 回答, 新保存 ${newSaved}`);
          // 立刻持久化 visited
          visited.save();
        }
      }

      // 拦截相关问题 API
      if (respUrl.includes('/similar-questions')) {
        const body = await response.json().catch(() => null);
        if (body && body.data && Array.isArray(body.data)) {
          for (const q of body.data) {
            if (q.id) {
              relatedQuestions.push({
                id: String(q.id),
                title: q.title || '',
                answerCount: q.answer_count || 0,
              });
            }
          }
          if (relatedQuestions.length > 0) {
            logger.info(`  [API] 发现 ${relatedQuestions.length} 个相关问题`);
            // 立刻保存相关问题到问题 meta
            Storage.saveQuestion(questionId, { relatedQuestions });
          }
        }
      }
    } catch (e) {
      // ignore
    }
  };

  page.on('response', apiHandler);

  try {
    // 访问页面
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: config.timeout,
    });
    await human.delay('pageLoad');
    await closeLoginModal(page);

    // 提取问题信息
    questionInfo = await page.evaluate(() => {
      return {
        title: document.querySelector('.QuestionHeader-title')?.innerText?.trim() || '',
        detail: document.querySelector('.QuestionRichText')?.innerHTML || '',
        followerCount: parseInt(
          document.querySelector('.NumberBoard-itemValue')?.innerText?.replace(/,/g, '') || '0'
        ),
        topics: Array.from(document.querySelectorAll('.QuestionHeader-topics .TopicLink')).map(
          el => el.innerText?.trim()
        ),
      };
    });

    logger.info(`  标题: ${questionInfo.title.slice(0, 40)}...`);

    // 滚动加载更多回答
    const maxScrolls = CRAWLER_CONFIG.scroll.maxScrolls;
    for (let i = 0; i < maxScrolls; i++) {
      await human.act();

      // 每隔几次关闭弹窗
      if (i % 3 === 0) {
        await closeLoginModal(page);
      }

      logger.info(`  滚动 ${i + 1}/${maxScrolls}, 已保存 ${newSaved} 回答`);
    }

  } finally {
    page.off('response', apiHandler);
  }

  // 保存问题元数据（回答已在 API handler 中立刻保存）
  Storage.saveQuestion(questionId, {
    title: questionInfo?.title || '',
    detail: questionInfo?.detail || '',
    followerCount: questionInfo?.followerCount || 0,
    topics: questionInfo?.topics || [],
    url: url,
    needsFetch: false,
  });

  // 标记问题为已访问
  visited.add(`question:${questionId}`);
  visited.save();

  logger.done(`  问题完成: 新增 ${newSaved} 回答, 总计 ${totalCollected}, 相关问题 ${relatedQuestions.length}`);

  return { newAnswers: newSaved, totalAnswers: totalCollected, relatedQuestions: relatedQuestions.length };
}

// ============ 文章页面爬取 ============
async function crawlArticle(page, articleId, visited, queue, human) {
  const url = `https://zhuanlan.zhihu.com/p/${articleId}`;
  logger.step(`爬取文章: ${articleId}`);

  const recommendations = [];
  const articleComments = [];

  // 设置 API 拦截
  const apiHandler = async (response) => {
    const respUrl = response.url();

    try {
      const contentType = response.headers()['content-type'] || '';
      if (!contentType.includes('json')) return;

      // 拦截推荐文章 API
      if (respUrl.includes(`/articles/${articleId}/recommendation`)) {
        const body = await response.json().catch(() => null);
        if (body && body.data && Array.isArray(body.data)) {
          for (const item of body.data) {
            const article = item.article || item;
            if (article.id) {
              recommendations.push({
                id: String(article.id),
                title: article.title || '',
                voteupCount: article.voteup_count || 0,
              });
            }
          }
          if (recommendations.length > 0) {
            logger.info(`  [API] 发现 ${recommendations.length} 篇推荐文章`);
          }
        }
      }

      // 拦截文章评论 API
      if (respUrl.includes(`/articles/${articleId}`) && respUrl.includes('/root_comment')) {
        const body = await response.json().catch(() => null);
        if (body && body.data && Array.isArray(body.data)) {
          const topComments = body.data.slice(0, 2).map(c => ({
            id: c.id,
            content: c.content,
            likeCount: c.like_count || 0,
            author: c.author ? { name: c.author.name } : null,
          }));
          articleComments.push(...topComments);
          if (topComments.length > 0) {
            logger.info(`  [API] 收集到 ${topComments.length} 条评论`);
          }
        }
      }
    } catch (e) {
      // ignore
    }
  };

  page.on('response', apiHandler);

  let articleInfo = null;

  try {
    // 访问页面
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: config.timeout,
    });
    await human.delay('pageLoad');
    await closeLoginModal(page);

    // 提取文章信息
    articleInfo = await page.evaluate(() => {
      return {
        title: document.querySelector('.Post-Title')?.innerText?.trim() || '',
        content: document.querySelector('.Post-RichTextContainer')?.innerHTML || '',
        author: {
          name: document.querySelector('.AuthorInfo-name')?.innerText?.trim() || '',
          headline: document.querySelector('.AuthorInfo-detail')?.innerText?.trim() || '',
        },
        voteupCount: parseInt(
          document.querySelector('.VoteButton--up')?.innerText?.replace(/[^\d]/g, '') || '0'
        ),
        commentCount: parseInt(
          document.querySelector('.Comments-titleText')?.innerText?.replace(/[^\d]/g, '') || '0'
        ),
      };
    });

    logger.info(`  标题: ${articleInfo.title.slice(0, 40)}...`);

    // 滚动页面（模拟阅读）
    for (let i = 0; i < 3; i++) {
      await human.act();
    }

  } finally {
    page.off('response', apiHandler);
  }

  // 保存文章
  const visitKey = `article:${articleId}`;
  if (visited.add(visitKey)) {
    Storage.saveArticle(articleId, {
      title: articleInfo?.title || '',
      content: articleInfo?.content || '',
      voteupCount: articleInfo?.voteupCount || 0,
      commentCount: articleInfo?.commentCount || 0,
      author: articleInfo?.author || {},
      url: url,
      // 保存评论（如果有）
      topComments: articleComments.length > 0 ? articleComments : undefined,
      // 保存推荐文章列表（如果有）
      recommendations: recommendations.length > 0 ? recommendations.slice(0, 5) : undefined,
    });
  }

  visited.save();

  logger.done(`  文章完成: ${articleInfo?.title?.slice(0, 30)}..., 评论 ${articleComments.length}, 推荐 ${recommendations.length}`);

  return { title: articleInfo?.title, comments: articleComments.length, recommendations: recommendations.length };
}

// ============ 主爬虫 ============
async function crawl(options = {}) {
  const maxItems = options.max || Infinity;

  ensureDataDirs();

  // 加载状态
  const visited = new VisitedSet();
  const queue = new CrawlQueue();

  logger.info(`已访问: ${visited.size()} 项`);
  logger.info(`队列: ${queue.size()} 项`);

  if (queue.size() === 0) {
    logger.warn('队列为空，请先添加种子或运行 init');
    showStatus();
    return;
  }

  const browser = await createBrowser();
  let crawledCount = 0;

  // 安全退出处理
  let shouldStop = false;
  const cleanup = async () => {
    if (shouldStop) return;
    shouldStop = true;
    logger.warn('正在安全退出...');
    visited.save();
    Storage.saveStats();
    await browser.close();
    showStatus();
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    const page = await createPage(browser);
    const human = new HumanBehavior(page);

    // 登录
    if (hasCookies()) {
      logger.step('应用登录状态');
      await applyCookies(page);
    }

    // 先访问首页预热
    logger.step('访问首页预热');
    await page.goto('https://www.zhihu.com', {
      waitUntil: 'networkidle2',
      timeout: config.timeout,
    });
    await human.delay('pageLoad');
    await closeLoginModal(page);

    // 主循环
    while (!shouldStop && crawledCount < maxItems) {
      // 随机选择下一个目标
      const next = queue.pickNext(visited);
      if (!next) {
        logger.info('队列已空');
        break;
      }

      const itemKey = `${next.type}:${next.id}`;
      if (visited.has(itemKey)) {
        continue;
      }

      crawledCount++;
      logger.info(`\n[${crawledCount}/${maxItems}] 爬取 ${itemKey}`);

      try {
        if (next.type === 'question') {
          await crawlQuestion(page, next.id, visited, queue, human);
        } else if (next.type === 'article') {
          await crawlArticle(page, next.id, visited, queue, human);
        } else {
          logger.warn(`未知类型: ${next.type}`);
          visited.add(itemKey);
          continue;
        }

        // 页面之间的延迟
        await human.delay('betweenPages');

      } catch (err) {
        logger.error(`爬取失败: ${err.message}`);
        // 不标记为已访问，以便重试
      }

      // 定期保存状态
      if (crawledCount % 5 === 0) {
        visited.save();
        Storage.saveStats();
        logger.info(`  [保存状态] 已爬取 ${crawledCount} 项`);
      }
    }

  } catch (err) {
    logger.error(`爬虫错误: ${err.message}`);
  } finally {
    await cleanup();
  }
}

// ============ CLI ============
function printUsage() {
  console.log('随机深度优先爬虫');
  console.log('');
  console.log('用法:');
  console.log('  node crawler.js                 从队列继续爬取');
  console.log('  node crawler.js --max <n>       最多爬取 n 个');
  console.log('  node crawler.js --status        查看状态');
  console.log('');
  console.log('示例:');
  console.log('  node crawler.js --max 10');
}

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  if (args.includes('--status')) {
    showStatus();
    process.exit(0);
  }

  const options = {};

  const maxIdx = args.indexOf('--max');
  if (maxIdx !== -1 && args[maxIdx + 1]) {
    options.max = parseInt(args[maxIdx + 1]);
  }

  crawl(options);
}

module.exports = { crawl, crawlQuestion, crawlArticle };
