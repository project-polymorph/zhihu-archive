/**
 * 从已爬取的 result.json 初始化数据结构
 *
 * 用法:
 *   node init.js <result.json路径>
 *   node init.js output/topic_27814732_2026-01-14T15-38-05/result.json
 *   node init.js --status
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('./utils');
const {
  ensureDataDirs,
  readJson,
  VisitedSet,
  CrawlQueue,
  Storage,
  processTopicFeedItem,
  showStatus,
} = require('./storage');

// 从文件路径提取话题 ID
function extractTopicId(filepath) {
  const dirname = path.basename(path.dirname(filepath));
  // topic_27814732_2026-01-14T15-38-05
  const match = dirname.match(/topic_(\d+)/);
  return match ? match[1] : null;
}

// 从 result.json 初始化
async function initFromResult(resultFile) {
  if (!fs.existsSync(resultFile)) {
    logger.error(`文件不存在: ${resultFile}`);
    process.exit(1);
  }

  // 读取数据
  const data = readJson(resultFile);
  if (!data || !data.items || data.items.length === 0) {
    logger.error('没有数据可处理');
    process.exit(1);
  }

  logger.info(`读取到 ${data.items.length} 条数据`);

  // 提取话题 ID
  const topicId = extractTopicId(resultFile) || 'unknown';
  logger.info(`话题 ID: ${topicId}`);

  // 初始化目录
  ensureDataDirs();

  // 加载状态
  const visited = new VisitedSet();
  const queue = new CrawlQueue();

  logger.info(`已有 visited: ${visited.size()} 项`);

  // 统计
  const stats = {
    questions: new Set(),
    answers: 0,
    articles: 0,
    authors: new Set(),
  };

  // 处理每条数据
  for (const item of data.items) {
    // 记录作者
    if (item.author && item.author.id) {
      stats.authors.add(item.author.id);
    }

    // 处理内容
    const result = processTopicFeedItem(item, topicId, visited, queue);

    if (result.saved) {
      if (result.type === 'answer') {
        stats.answers++;
        if (result.questionId) {
          stats.questions.add(result.questionId);
        }
      } else if (result.type === 'article') {
        stats.articles++;
      }
    }
  }

  // 保存话题信息
  Storage.saveTopic(topicId, {
    url: `https://www.zhihu.com/topic/${topicId}`,
    feedsCrawled: data.items.length,
  });

  // 保存状态
  visited.save();
  Storage.saveStats({ sources: [`topic_feed:${topicId}`] });

  // 打印结果
  const finalStats = Storage.getStats();

  console.log('');
  console.log('='.repeat(50));
  console.log('初始化完成!');
  console.log('='.repeat(50));
  console.log('');
  console.log('本次新增:');
  console.log(`  问题: ${stats.questions.size}`);
  console.log(`  回答: ${stats.answers}`);
  console.log(`  文章: ${stats.articles}`);
  console.log(`  作者: ${stats.authors.size}`);
  console.log('');
  console.log('总计:');
  console.log(`  问题: ${finalStats.questions}`);
  console.log(`  回答: ${finalStats.answers}`);
  console.log(`  文章: ${finalStats.articles}`);
  console.log(`  作者: ${finalStats.authors}`);
  console.log('');
  console.log(`待爬队列: ${queue.size()} 项`);
  console.log(`已访问: ${visited.size()} 项`);
  console.log('='.repeat(50));
}

// CLI
function printUsage() {
  console.log('从 result.json 初始化数据结构');
  console.log('');
  console.log('用法:');
  console.log('  node init.js <result.json>   从文件初始化');
  console.log('  node init.js --status        查看当前状态');
  console.log('');
  console.log('示例:');
  console.log('  node init.js output/topic_27814732_2026-01-14T15-38-05/result.json');
}

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  if (args[0] === '--status') {
    showStatus();
    process.exit(0);
  }

  initFromResult(args[0]);
}

module.exports = { initFromResult };
