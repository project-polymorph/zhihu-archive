/**
 * 临时脚本：对比话题页面 DOM vs API
 *
 * 用法: node tmp-compare-topic.js <topic_id>
 * 示例: node tmp-compare-topic.js 20075371
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { createBrowser, createPage, closeLoginModal } = require('./browser');
const { applyCookies, hasCookies } = require('./login');
const { logger, randomDelay, ensureDir } = require('./utils');

async function compareTopic(topicId) {
  const outputDir = path.join(config.outputDir, 'compare-topic', topicId);
  ensureDir(outputDir);

  logger.info(`对比话题: ${topicId}`);

  const apiResponses = [];
  const feedsApiData = [];
  const browser = await createBrowser();

  try {
    const page = await createPage(browser);

    if (hasCookies()) {
      await applyCookies(page);
    }

    // 拦截 API
    page.on('response', async (response) => {
      const url = response.url();
      if (!url.includes('/api/')) return;

      try {
        const contentType = response.headers()['content-type'] || '';
        if (!contentType.includes('json')) return;

        const body = await response.json().catch(() => null);
        if (body) {
          apiResponses.push({ url, data: body });

          // 特别关注 feeds API
          if (url.includes('/feeds/') || url.includes('/top-answers') || url.includes('/top_activity')) {
            logger.info(`  [API] ${url.slice(0, 100)}...`);
            feedsApiData.push({ url, data: body });
          }
        }
      } catch (e) {}
    });

    // 预热
    await page.goto('https://www.zhihu.com', { waitUntil: 'networkidle2', timeout: config.timeout });
    await randomDelay(2000, 3000);
    await closeLoginModal(page);

    // 访问话题精华页
    const url = `https://www.zhihu.com/topic/${topicId}/top-answers`;
    logger.step(`访问: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: config.timeout });
    await randomDelay(3000, 4000);
    await closeLoginModal(page);

    // 从 DOM 提取问题/回答
    const extractFromDOM = async () => {
      return await page.evaluate(() => {
        const items = [];
        // 话题页面的内容项
        document.querySelectorAll('.ContentItem, .List-item, .TopicFeedItem').forEach((el, idx) => {
          const titleEl = el.querySelector('.ContentItem-title a, h2 a');
          const authorEl = el.querySelector('.AuthorInfo-name a, .AuthorInfo-name span');
          const excerptEl = el.querySelector('.RichContent-inner, .RichText');

          // 尝试获取问题 ID
          let questionId = '';
          if (titleEl) {
            const href = titleEl.getAttribute('href') || '';
            const match = href.match(/question\/(\d+)/);
            if (match) questionId = match[1];
          }

          items.push({
            index: idx,
            questionId,
            title: titleEl?.innerText?.trim() || '',
            author: authorEl?.innerText?.trim() || '',
            excerptPreview: excerptEl?.innerText?.slice(0, 200) || '',
          });
        });
        return items;
      });
    };

    // 初始 DOM 提取
    let domItems = await extractFromDOM();
    logger.info(`初始 DOM 项数: ${domItems.length}`);

    // 滚动
    logger.step('滚动 15 次');
    for (let i = 0; i < 15; i++) {
      await page.evaluate(() => window.scrollBy({ top: 600, behavior: 'smooth' }));
      await randomDelay(1500, 2500);

      if (i % 5 === 0) {
        await closeLoginModal(page);
        const current = await extractFromDOM();
        logger.info(`  滚动 ${i + 1}/15, DOM: ${current.length}, feeds API: ${feedsApiData.length}`);
      }
    }

    // 最终 DOM 提取
    domItems = await extractFromDOM();
    logger.info(`最终 DOM 项数: ${domItems.length}`);

    // 保存结果
    fs.writeFileSync(path.join(outputDir, 'dom_items.json'), JSON.stringify(domItems, null, 2));
    fs.writeFileSync(path.join(outputDir, 'feeds_api.json'), JSON.stringify(feedsApiData, null, 2));
    fs.writeFileSync(path.join(outputDir, 'all_api_urls.json'), JSON.stringify(apiResponses.map(r => r.url), null, 2));

    // 从 feeds API 提取问题
    const apiQuestions = new Map();
    for (const resp of feedsApiData) {
      if (resp.data?.data && Array.isArray(resp.data.data)) {
        for (const item of resp.data.data) {
          const target = item.target || item;
          // 从回答提取问题
          if (target.question && target.question.id) {
            const qId = String(target.question.id);
            if (!apiQuestions.has(qId)) {
              apiQuestions.set(qId, {
                id: qId,
                title: target.question.title || '',
              });
            }
          }
          // 直接是问题
          if (target.type === 'question' && target.id) {
            const qId = String(target.id);
            if (!apiQuestions.has(qId)) {
              apiQuestions.set(qId, {
                id: qId,
                title: target.title || '',
              });
            }
          }
        }
      }
    }

    fs.writeFileSync(path.join(outputDir, 'api_questions.json'), JSON.stringify(Array.from(apiQuestions.values()), null, 2));

    // DOM 中的问题 ID
    const domQuestionIds = new Set(domItems.filter(i => i.questionId).map(i => i.questionId));

    // 汇总
    logger.info('========================================');
    logger.info('对比结果:');
    logger.info(`  DOM 项数: ${domItems.length}`);
    logger.info(`  DOM 问题数 (有ID): ${domQuestionIds.size}`);
    logger.info(`  API 问题数: ${apiQuestions.size}`);
    logger.info(`  feeds API 调用: ${feedsApiData.length}`);
    logger.info(`  总 API 调用: ${apiResponses.length}`);
    logger.info(`  输出: ${outputDir}`);
    logger.info('========================================');

    // 检查差异
    const apiIds = new Set(apiQuestions.keys());
    const onlyInDom = [...domQuestionIds].filter(id => !apiIds.has(id));
    const onlyInApi = [...apiIds].filter(id => !domQuestionIds.has(id));

    if (onlyInDom.length > 0) {
      logger.warn(`DOM 有但 API 无: ${onlyInDom.length} 个`);
      fs.writeFileSync(path.join(outputDir, 'only_in_dom.json'), JSON.stringify(onlyInDom, null, 2));
    }
    if (onlyInApi.length > 0) {
      logger.info(`API 有但 DOM 无: ${onlyInApi.length} 个`);
    }

  } finally {
    await browser.close();
  }
}

const topicId = process.argv[2] || '20075371';
compareTopic(topicId);
