/**
 * 探索脚本 - 用于 debug 页面结构和 API
 *
 * 用法:
 *   node explore.js question <id>
 *   node explore.js article <id>
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { createBrowser, createPage, closeLoginModal } = require('./browser');
const { applyCookies, hasCookies } = require('./login');
const { logger, ensureDir, randomDelay } = require('./utils');

const OUTPUT_DIR = path.join(__dirname, 'output', 'explore_' + Date.now());

async function explore(type, id) {
  ensureDir(OUTPUT_DIR);
  logger.info(`探索 ${type}: ${id}`);
  logger.info(`输出目录: ${OUTPUT_DIR}`);

  const apiLogs = [];
  const browser = await createBrowser();

  try {
    const page = await createPage(browser);

    // 监听 API
    page.on('response', async response => {
      const url = response.url();
      if (url.includes('/api/')) {
        try {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('json')) {
            const body = await response.json().catch(() => null);
            if (body) {
              apiLogs.push({
                url: url,
                status: response.status(),
                body: body,
              });
              // 简化日志
              const shortUrl = url.replace('https://www.zhihu.com', '').slice(0, 80);
              logger.info(`[API] ${shortUrl}...`);
            }
          }
        } catch (e) {}
      }
    });

    // 登录
    if (hasCookies()) {
      logger.step('应用登录状态');
      await applyCookies(page);
    }

    // 先访问首页
    logger.step('访问首页');
    await page.goto('https://www.zhihu.com', {
      waitUntil: 'networkidle2',
      timeout: config.timeout,
    });
    await randomDelay(2000, 3000);
    await closeLoginModal(page);

    // 构建目标 URL
    let targetUrl;
    if (type === 'question') {
      targetUrl = `https://www.zhihu.com/question/${id}`;
    } else if (type === 'article') {
      targetUrl = `https://zhuanlan.zhihu.com/p/${id}`;
    } else {
      throw new Error(`未知类型: ${type}`);
    }

    // 访问目标页面
    logger.step(`访问: ${targetUrl}`);
    await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: config.timeout,
    });
    await randomDelay(3000, 5000);
    await closeLoginModal(page);

    // 截图
    await page.screenshot({
      path: path.join(OUTPUT_DIR, 'page.png'),
      fullPage: false,
    });
    logger.done('截图已保存');

    // 如果是问题页，滚动加载更多回答
    if (type === 'question') {
      logger.step('滚动加载更多回答...');
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => {
          window.scrollBy({ top: 800, behavior: 'smooth' });
        });
        await randomDelay(2000, 3000);
        logger.info(`滚动 ${i + 1}/5`);
      }
    }

    // 提取页面信息
    const pageInfo = await page.evaluate(() => {
      if (document.querySelector('.QuestionHeader')) {
        // 问题页
        return {
          type: 'question',
          title: document.querySelector('.QuestionHeader-title')?.innerText || '',
          detail: document.querySelector('.QuestionRichText')?.innerHTML || '',
          followerCount: document.querySelector('.NumberBoard-itemValue')?.innerText || '',
          answerCount: document.querySelectorAll('.AnswerItem, .Answer').length,
        };
      } else if (document.querySelector('.Post-Main')) {
        // 文章页
        return {
          type: 'article',
          title: document.querySelector('.Post-Title')?.innerText || '',
          content: document.querySelector('.Post-RichTextContainer')?.innerHTML || '',
          author: document.querySelector('.AuthorInfo-name')?.innerText || '',
        };
      }
      return { type: 'unknown' };
    });

    logger.info(`页面类型: ${pageInfo.type}`);
    if (pageInfo.title) {
      logger.info(`标题: ${pageInfo.title.slice(0, 50)}...`);
    }

    // 保存结果
    const result = {
      type,
      id,
      url: targetUrl,
      pageInfo,
      apiLogs,
      crawledAt: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'result.json'),
      JSON.stringify(result, null, 2),
      'utf-8'
    );
    logger.done(`结果已保存到 ${OUTPUT_DIR}/result.json`);

    // 分析 API
    console.log('\n' + '='.repeat(60));
    console.log('API 分析');
    console.log('='.repeat(60));

    const relevantApis = apiLogs.filter(log => {
      const url = log.url;
      return url.includes('/questions/') ||
             url.includes('/answers') ||
             url.includes('/articles/') ||
             url.includes('/members/');
    });

    relevantApis.forEach(api => {
      const shortUrl = api.url.replace('https://www.zhihu.com', '').replace('https://api.zhihu.com', '');
      console.log(`\n[${api.status}] ${shortUrl}`);
      if (api.body) {
        if (api.body.data && Array.isArray(api.body.data)) {
          console.log(`  data: Array[${api.body.data.length}]`);
          if (api.body.data[0]) {
            console.log(`  data[0] keys: ${Object.keys(api.body.data[0]).join(', ')}`);
          }
        } else if (api.body.id) {
          console.log(`  单个对象, keys: ${Object.keys(api.body).slice(0, 10).join(', ')}...`);
        }
        if (api.body.paging) {
          console.log(`  paging: is_end=${api.body.paging.is_end}, totals=${api.body.paging.totals || 'N/A'}`);
        }
      }
    });

  } catch (err) {
    logger.error(err.message);
  } finally {
    await browser.close();
  }
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('用法:');
    console.log('  node explore.js question <id>');
    console.log('  node explore.js article <id>');
    console.log('');
    console.log('示例:');
    console.log('  node explore.js question 1987770839429554973');
    console.log('  node explore.js article 1890708654895895137');
    process.exit(1);
  }

  explore(args[0], args[1]);
}

module.exports = { explore };
