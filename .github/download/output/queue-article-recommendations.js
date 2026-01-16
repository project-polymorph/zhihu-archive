/**
 * 把现有匹配 topic 的 article 的 recommendations 加入 queue
 */

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const stateDir = path.join(dataDir, '.state');
const articlesDir = path.join(dataDir, 'articles');
const crawlConfigPath = path.join(__dirname, '..', 'crawl-config.json');

// 加载爬取配置
function loadCrawlConfig() {
  try {
    if (fs.existsSync(crawlConfigPath)) {
      return JSON.parse(fs.readFileSync(crawlConfigPath, 'utf-8'));
    }
  } catch (e) {
    console.error('加载 crawl-config.json 失败:', e.message);
  }
  return { topics: [], discovery: {} };
}

// 检查 topics 是否匹配（精确匹配）
function matchesTopicFilter(articleTopics, configTopics) {
  if (!configTopics || configTopics.length === 0) return false;
  if (!articleTopics || articleTopics.length === 0) return false;

  for (const at of articleTopics) {
    for (const ct of configTopics) {
      if (at === ct) {
        return true;
      }
    }
  }
  return false;
}

// 加载 visited 集合 (JSONL 格式)
function loadVisited() {
  const visitedPath = path.join(stateDir, 'visited.jsonl');
  const visited = new Set();
  try {
    if (fs.existsSync(visitedPath)) {
      const lines = fs.readFileSync(visitedPath, 'utf-8').split('\n').filter(l => l.trim());
      for (const line of lines) {
        visited.add(line.trim());
      }
    }
  } catch (e) {
    console.error('加载 visited.jsonl 失败:', e.message);
  }
  return visited;
}

// 加载队列 (JSONL 格式)
function loadQueue() {
  const queuePath = path.join(stateDir, 'queue.jsonl');
  const queue = [];
  try {
    if (fs.existsSync(queuePath)) {
      const lines = fs.readFileSync(queuePath, 'utf-8').split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          queue.push(JSON.parse(line));
        } catch (e) {}
      }
    }
  } catch (e) {
    console.error('加载 queue.jsonl 失败:', e.message);
  }
  return queue;
}

// 追加到队列 (JSONL 格式)
function appendToQueue(items) {
  const queuePath = path.join(stateDir, 'queue.jsonl');
  const lines = items.map(item => JSON.stringify(item)).join('\n');
  if (lines) {
    fs.appendFileSync(queuePath, '\n' + lines);
  }
}

function main() {
  const crawlConfig = loadCrawlConfig();
  const configTopics = crawlConfig.topics || [];

  console.log('Topic 过滤器:', configTopics.join(', '));
  console.log('');

  const visited = loadVisited();
  const queue = loadQueue();

  // 用于快速检查队列中是否已有
  const queueSet = new Set(queue.map(q => `${q.type}:${q.id}`));

  const files = fs.readdirSync(articlesDir).filter(f => f.endsWith('.json'));
  console.log(`找到 ${files.length} 篇文章\n`);

  let matchedArticles = 0;
  let totalRecommendations = 0;
  let addedToQueue = 0;
  let alreadyVisited = 0;
  let alreadyInQueue = 0;

  const newItems = [];  // 收集新增项

  for (const file of files) {
    const filePath = path.join(articlesDir, file);
    try {
      const article = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      // 检查文章的 topics 是否匹配
      if (!matchesTopicFilter(article.topics, configTopics)) {
        continue;
      }

      matchedArticles++;
      const recommendations = article.recommendations || [];

      if (recommendations.length === 0) {
        continue;
      }

      console.log(`✓ ${article.id}: ${article.title?.slice(0, 40)}...`);
      console.log(`  话题: ${(article.topics || []).join(', ')}`);
      console.log(`  推荐: ${recommendations.length} 篇`);

      for (const rec of recommendations) {
        totalRecommendations++;
        const visitKey = `article:${rec.id}`;
        const queueKey = `article:${rec.id}`;

        if (visited.has(visitKey)) {
          alreadyVisited++;
          continue;
        }

        if (queueSet.has(queueKey)) {
          alreadyInQueue++;
          continue;
        }

        // 加入新增列表
        const item = {
          type: 'article',
          id: rec.id,
          priority: 4,
          source: `recommend:${article.id}`,
          title: rec.title || '',
        };
        newItems.push(item);
        queueSet.add(queueKey);
        addedToQueue++;
        console.log(`    + ${rec.id}: ${rec.title?.slice(0, 30)}...`);
      }
      console.log('');
    } catch (e) {
      console.error(`✗ ${file}: ${e.message}`);
    }
  }

  // 追加到队列
  if (newItems.length > 0) {
    appendToQueue(newItems);
  }

  console.log('========== 统计 ==========');
  console.log(`匹配的文章: ${matchedArticles}`);
  console.log(`总推荐数: ${totalRecommendations}`);
  console.log(`新增队列: ${addedToQueue}`);
  console.log(`已访问跳过: ${alreadyVisited}`);
  console.log(`已在队列: ${alreadyInQueue}`);
  console.log(`当前队列大小: ${queue.length + newItems.length}`);
}

main();
