const { createBrowser, createPage, closeLoginModal } = require('./browser');
const { applyCookies, hasCookies } = require('./login');
const config = require('./config');
const fs = require('fs');

async function debug() {
  const browser = await createBrowser();
  const page = await createPage(browser);

  if (hasCookies()) {
    await applyCookies(page);
  }

  await page.goto('https://www.zhihu.com/question/475290957', {
    waitUntil: 'networkidle2',
    timeout: config.timeout,
  });

  await new Promise(r => setTimeout(r, 5000));
  await closeLoginModal(page);

  // 保存 HTML
  const html = await page.content();
  fs.writeFileSync('output/debug-475290957.html', html);
  console.log('HTML 已保存');

  // 检查 AnswerItem
  const info = await page.evaluate(() => {
    const items = document.querySelectorAll('.AnswerItem');
    const results = [];
    items.forEach((el, i) => {
      const dataZop = el.getAttribute('data-zop');
      const voteBtn = el.querySelector('.VoteButton--up');
      const authorEl = el.querySelector('.AuthorInfo-name');

      results.push({
        index: i,
        dataZop: dataZop ? dataZop.slice(0, 50) + '...' : null,
        voteText: voteBtn?.innerText || '',
        voteClass: voteBtn?.className || '',
        author: authorEl?.innerText || '',
      });
    });
    return {
      answerItemCount: items.length,
      items: results,
    };
  });

  console.log('AnswerItem 数量:', info.answerItemCount);
  console.log(JSON.stringify(info.items, null, 2));

  await browser.close();
}

debug();
