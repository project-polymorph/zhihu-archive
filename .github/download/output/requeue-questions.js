/**
 * 将已爬取的问题重新加入队列
 * 用于重新爬取以获取 SSR 回答和更新 meta.json
 *
 * 用法: node requeue-questions.js
 */

const fs = require('fs');
const path = require('path');
const { ensureDataDirs, VisitedSet, CrawlQueue } = require('./storage');
const { logger } = require('./utils');

const DATA_DIR = path.join(__dirname, 'data');

function requeueQuestions() {
  ensureDataDirs();

  const visited = new VisitedSet();
  const queue = new CrawlQueue();

  const questionsDir = path.join(DATA_DIR, 'questions');

  if (!fs.existsSync(questionsDir)) {
    logger.error('questions 目录不存在');
    return;
  }

  const questionIds = fs.readdirSync(questionsDir).filter(f => {
    const stat = fs.statSync(path.join(questionsDir, f));
    return stat.isDirectory();
  });

  logger.info(`找到 ${questionIds.length} 个已爬取的问题`);

  // 从 visited 中移除这些问题，以便重新爬取
  let removedCount = 0;
  for (const qId of questionIds) {
    const visitKey = `question:${qId}`;
    if (visited.has(visitKey)) {
      visited.remove(visitKey);
      removedCount++;
    }
  }

  logger.info(`从 visited 移除 ${removedCount} 个问题`);
  visited.save();

  // 加入队列
  let addedCount = 0;
  for (const qId of questionIds) {
    queue.add({
      type: 'question',
      id: qId,
      priority: 1,  // 高优先级
      source: 'requeue',
    });
    addedCount++;
  }

  logger.info(`加入队列 ${addedCount} 个问题`);

  // 去重
  queue.compact(visited);

  logger.info(`========================================`);
  logger.info(`重新入队完成`);
  logger.info(`问题数: ${questionIds.length}`);
  logger.info(`队列大小: ${queue.size()}`);
  logger.info(`========================================`);
}

requeueQuestions();
