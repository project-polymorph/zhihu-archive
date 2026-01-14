/**
 * 临时脚本：对比 HTML 内容和 API 响应
 *
 * 用法: node tmp-compare.js <question_id>
 * 示例: node tmp-compare.js 475290957
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { createBrowser, createPage, closeLoginModal } = require('../browser');
const { applyCookies, hasCookies } = require('../login');
const { logger, randomDelay, ensureDir } = require('../utils');

async function compare(questionId) {
  const outputDir = path.join(config.outputDir, 'compare', questionId);
  ensureDir(outputDir);

  logger.info(`对比问题: ${questionId}`);
  logger.info(`输出目录: ${outputDir}`);

  const apiResponses = [];
  const browser = await createBrowser();

  try {
    const page = await createPage(browser);

    // 登录
    if (hasCookies()) {
      logger.step('应用登录状态');
      await applyCookies(page);
    }

    // 拦截所有 API 响应
    page.on('response', async (response) => {
      const url = response.url();
      if (!url.includes('/api/')) return;

      try {
        const contentType = response.headers()['content-type'] || '';
        if (!contentType.includes('json')) return;

        const body = await response.json().catch(() => null);
        if (body) {
          apiResponses.push({
            url: url,
            status: response.status(),
            data: body,
          });
        }
      } catch (e) {}
    });

    // 预热
    logger.step('访问首页');
    await page.goto('https://www.zhihu.com', {
      waitUntil: 'networkidle2',
      timeout: config.timeout,
    });
    await randomDelay(2000, 3000);
    await closeLoginModal(page);

    // 访问问题页
    const url = `https://www.zhihu.com/question/${questionId}`;
    logger.step(`访问问题页: ${url}`);
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: config.timeout,
    });
    await randomDelay(3000, 5000);
    await closeLoginModal(page);

    // 保存初始 HTML
    const html1 = await page.content();
    fs.writeFileSync(path.join(outputDir, '1_initial.html'), html1, 'utf-8');
    logger.info('保存初始 HTML: 1_initial.html');

    // 滚动几次
    logger.step('滚动加载更多');
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => {
        window.scrollBy({ top: 500, behavior: 'smooth' });
      });
      await randomDelay(2000, 3000);
      logger.info(`  滚动 ${i + 1}/5`);
    }

    // 保存滚动后 HTML
    const html2 = await page.content();
    fs.writeFileSync(path.join(outputDir, '2_after_scroll.html'), html2, 'utf-8');
    logger.info('保存滚动后 HTML: 2_after_scroll.html');

    // 从 DOM 提取回答
    const domAnswers = await page.evaluate(() => {
      const answers = [];
      document.querySelectorAll('.AnswerItem, .List-item').forEach(el => {
        const authorEl = el.querySelector('.AuthorInfo-name, .UserLink-link');
        const contentEl = el.querySelector('.RichContent-inner, .RichText');
        const voteEl = el.querySelector('.VoteButton--up');

        if (contentEl) {
          answers.push({
            author: authorEl?.innerText?.trim() || '',
            contentPreview: contentEl?.innerText?.slice(0, 200) || '',
            voteup: voteEl?.innerText?.trim() || '',
          });
        }
      });
      return answers;
    });

    // 从 DOM 提取问题信息
    const domQuestion = await page.evaluate(() => {
      return {
        title: document.querySelector('.QuestionHeader-title')?.innerText?.trim() || '',
        detail: document.querySelector('.QuestionRichText')?.innerText?.trim() || '',
        answerCount: document.querySelector('.List-headerText span')?.innerText?.trim() || '',
        topics: Array.from(document.querySelectorAll('.QuestionHeader-topics .TopicLink')).map(
          el => el.innerText?.trim()
        ),
      };
    });

    // 保存 DOM 提取结果
    fs.writeFileSync(
      path.join(outputDir, '3_dom_question.json'),
      JSON.stringify(domQuestion, null, 2),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(outputDir, '4_dom_answers.json'),
      JSON.stringify(domAnswers, null, 2),
      'utf-8'
    );
    logger.info(`DOM 提取: 问题信息 + ${domAnswers.length} 个回答`);

    // 保存 API 响应
    fs.writeFileSync(
      path.join(outputDir, '5_api_responses.json'),
      JSON.stringify(apiResponses, null, 2),
      'utf-8'
    );
    logger.info(`API 响应: ${apiResponses.length} 个`);

    // 从 API 提取回答
    const apiAnswers = [];
    for (const resp of apiResponses) {
      if (resp.url.includes('/feeds') || resp.url.includes('/answers')) {
        if (resp.data?.data && Array.isArray(resp.data.data)) {
          for (const item of resp.data.data) {
            const target = item.target || item;
            if (target.type === 'answer' && target.id) {
              apiAnswers.push({
                id: target.id,
                author: target.author?.name || '',
                contentPreview: (target.content || target.excerpt || '').slice(0, 200).replace(/<[^>]+>/g, ''),
                voteup: target.voteup_count || 0,
              });
            }
          }
        }
      }
    }

    fs.writeFileSync(
      path.join(outputDir, '6_api_answers.json'),
      JSON.stringify(apiAnswers, null, 2),
      'utf-8'
    );

    // 汇总对比
    const summary = {
      questionId,
      url,
      domQuestion,
      comparison: {
        domAnswerCount: domAnswers.length,
        apiAnswerCount: apiAnswers.length,
        apiResponseCount: apiResponses.length,
      },
      apiEndpoints: apiResponses.map(r => r.url),
    };

    fs.writeFileSync(
      path.join(outputDir, '0_summary.json'),
      JSON.stringify(summary, null, 2),
      'utf-8'
    );

    logger.info('========================================');
    logger.info('对比结果:');
    logger.info(`  DOM 回答数: ${domAnswers.length}`);
    logger.info(`  API 回答数: ${apiAnswers.length}`);
    logger.info(`  API 请求数: ${apiResponses.length}`);
    logger.info(`  输出目录: ${outputDir}`);
    logger.info('========================================');

  } finally {
    await browser.close();
  }
}

// CLI
const questionId = process.argv[2];
if (!questionId) {
  console.log('用法: node tmp-compare.js <question_id>');
  console.log('示例: node tmp-compare.js 475290957');
  process.exit(1);
}

compare(questionId).catch(err => {
  console.error('错误:', err.message);
  process.exit(1);
});
