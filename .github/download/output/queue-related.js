#!/usr/bin/env node
/**
 * 把所有已爬取问题的 relatedQuestions 加入队列
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const QUESTIONS_DIR = path.join(DATA_DIR, 'questions');
const QUEUE_FILE = path.join(DATA_DIR, '.state', 'queue.jsonl');
const VISITED_FILE = path.join(DATA_DIR, '.state', 'visited.json');

// 读取已访问集合
function loadVisited() {
  const set = new Set();
  if (fs.existsSync(VISITED_FILE)) {
    try {
      const arr = JSON.parse(fs.readFileSync(VISITED_FILE, 'utf-8'));
      for (const key of arr) {
        set.add(key);
      }
    } catch (e) {}
  }
  return set;
}

// 读取现有队列
function loadQueue() {
  const set = new Set();
  if (fs.existsSync(QUEUE_FILE)) {
    const lines = fs.readFileSync(QUEUE_FILE, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        set.add(`${item.type}:${item.id}`);
      } catch (e) {}
    }
  }
  return set;
}

// 主逻辑
function main() {
  const visited = loadVisited();
  const queueSet = loadQueue();

  console.log(`已访问: ${visited.size} 项`);
  console.log(`队列中: ${queueSet.size} 项`);

  const questionDirs = fs.readdirSync(QUESTIONS_DIR).filter(d => {
    return fs.statSync(path.join(QUESTIONS_DIR, d)).isDirectory();
  });

  console.log(`已爬取问题: ${questionDirs.length} 个`);

  let added = 0;
  let skipped = 0;
  const toAdd = [];

  for (const qid of questionDirs) {
    const metaFile = path.join(QUESTIONS_DIR, qid, 'meta.json');
    if (!fs.existsSync(metaFile)) continue;

    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
      const related = meta.relatedQuestions || [];

      for (const rq of related) {
        const key = `question:${rq.id}`;
        if (visited.has(key) || queueSet.has(key)) {
          skipped++;
          continue;
        }

        toAdd.push({
          type: 'question',
          id: rq.id,
          priority: 2,
          source: `related:${qid}`,
          title: rq.title || '',
        });
        queueSet.add(key);
        added++;
      }
    } catch (e) {
      console.error(`读取 ${qid}/meta.json 失败:`, e.message);
    }
  }

  // 写入队列
  if (toAdd.length > 0) {
    const content = toAdd.map(item => JSON.stringify(item)).join('\n') + '\n';
    fs.appendFileSync(QUEUE_FILE, content);
  }

  console.log(`\n结果:`);
  console.log(`  新增: ${added} 个问题`);
  console.log(`  跳过: ${skipped} 个（已访问或已在队列）`);
}

main();
