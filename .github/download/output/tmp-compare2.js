/**
 * 临时脚本：更多滚动测试 + 更好的 DOM 提取
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { createBrowser, createPage, closeLoginModal } = require('../browser');
const { applyCookies, hasCookies } = require('../login');
const { logger, randomDelay, ensureDir } = require('../utils');

async function compare(questionId) {
  const outputDir = path.join(config.outputDir, 'compare2', questionId);
  ensureDir(outputDir);

  logger.info(`对比问题: ${questionId}`);

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

          // 特别关注 feeds/answers API
          if (url.includes('/feeds') || url.includes('/answers')) {
            logger.info(`  [API] ${url.slice(0, 80)}...`);
            feedsApiData.push({ url, data: body });
          }
        }
      } catch (e) {}
    });

    // 预热
    await page.goto('https://www.zhihu.com', { waitUntil: 'networkidle2', timeout: config.timeout });
    await randomDelay(2000, 3000);
    await closeLoginModal(page);

    // 访问问题
    const url = `https://www.zhihu.com/question/${questionId}`;
    logger.step(`访问: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: config.timeout });
    await randomDelay(3000, 4000);
    await closeLoginModal(page);

    // 更好的 DOM 提取
    const extractAnswers = async () => {
      return await page.evaluate(() => {
        const answers = [];
        // 使用更精确的选择器
        document.querySelectorAll('.AnswerItem').forEach((el, idx) => {
          const authorEl = el.querySelector('.AuthorInfo-name a, .AuthorInfo-name span');
          const contentEl = el.querySelector('.RichContent-inner');
          const voteEl = el.querySelector('.VoteButton--up');
          const dataZop = el.getAttribute('data-zop');

          let answerId = '';
          if (dataZop) {
            try {
              const zop = JSON.parse(dataZop);
              answerId = zop.itemId || '';
            } catch(e) {}
          }

          answers.push({
            index: idx,
            answerId,
            author: authorEl?.innerText?.trim() || '',
            contentPreview: contentEl?.innerText?.slice(0, 300) || '',
            voteup: voteEl?.innerText?.trim() || '',
            hasContent: !!contentEl,
          });
        });
        return answers;
      });
    };

    // 初始提取
    let domAnswers = await extractAnswers();
    logger.info(`初始 DOM 回答数: ${domAnswers.length}`);

    // 大量滚动
    logger.step('滚动 20 次');
    for (let i = 0; i < 20; i++) {
      await page.evaluate(() => window.scrollBy({ top: 800, behavior: 'smooth' }));
      await randomDelay(1500, 2500);

      if (i % 5 === 0) {
        await closeLoginModal(page);
        const current = await extractAnswers();
        logger.info(`  滚动 ${i + 1}/20, DOM 回答: ${current.length}, feeds API: ${feedsApiData.length}`);
      }
    }

    // 最终提取
    domAnswers = await extractAnswers();
    logger.info(`最终 DOM 回答数: ${domAnswers.length}`);

    // 保存结果
    fs.writeFileSync(path.join(outputDir, 'dom_answers.json'), JSON.stringify(domAnswers, null, 2));
    fs.writeFileSync(path.join(outputDir, 'feeds_api.json'), JSON.stringify(feedsApiData, null, 2));
    fs.writeFileSync(path.join(outputDir, 'all_api.json'), JSON.stringify(apiResponses.map(r => r.url), null, 2));

    // 从 feeds API 提取回答
    const apiAnswers = [];
    for (const resp of feedsApiData) {
      if (resp.data?.data && Array.isArray(resp.data.data)) {
        for (const item of resp.data.data) {
          const target = item.target || item;
          if (target.type === 'answer' && target.id) {
            apiAnswers.push({
              id: String(target.id),
              author: target.author?.name || '',
              excerpt: (target.excerpt || '').slice(0, 200),
              voteup: target.voteup_count || 0,
            });
          }
        }
      }
    }
    fs.writeFileSync(path.join(outputDir, 'api_answers.json'), JSON.stringify(apiAnswers, null, 2));

    // 汇总
    logger.info('========================================');
    logger.info('对比结果:');
    logger.info(`  DOM 回答数: ${domAnswers.length}`);
    logger.info(`  API 回答数: ${apiAnswers.length}`);
    logger.info(`  feeds API 调用: ${feedsApiData.length}`);
    logger.info(`  总 API 调用: ${apiResponses.length}`);
    logger.info(`  输出: ${outputDir}`);
    logger.info('========================================');

  } finally {
    await browser.close();
  }
}

const questionId = process.argv[2] || '475290957';
compare(questionId);
