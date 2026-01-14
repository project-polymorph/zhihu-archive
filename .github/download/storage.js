/**
 * 数据存储模块
 *
 * 文件结构:
 * data/
 * ├── questions/{qid}/
 * │   ├── meta.json
 * │   └── answers/{aid}.json
 * ├── articles/{id}.json
 * ├── authors/{id}.json
 * ├── topics/{id}.json
 * └── .state/
 *     ├── queue.jsonl
 *     ├── visited.json
 *     └── stats.json
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { logger } = require('./utils');

// ============ 路径工具 ============
const PATHS = {
  data: config.dataDir,
  questions: path.join(config.dataDir, 'questions'),
  articles: path.join(config.dataDir, 'articles'),
  authors: path.join(config.dataDir, 'authors'),
  topics: path.join(config.dataDir, 'topics'),
  state: path.join(config.dataDir, '.state'),
  queue: path.join(config.dataDir, '.state', 'queue.jsonl'),
  visited: path.join(config.dataDir, '.state', 'visited.json'),
  stats: path.join(config.dataDir, '.state', 'stats.json'),
};

// ============ 目录初始化 ============
function ensureDataDirs() {
  const dirs = [
    PATHS.questions,
    PATHS.articles,
    PATHS.authors,
    PATHS.topics,
    PATHS.state,
  ];
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

// ============ JSON 工具 ============
function readJson(filepath, defaultValue = null) {
  try {
    if (fs.existsSync(filepath)) {
      return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    }
  } catch (e) {
    logger.warn(`读取 JSON 失败: ${filepath}`);
  }
  return defaultValue;
}

function writeJson(filepath, data) {
  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
}

function appendJsonl(filepath, item) {
  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.appendFileSync(filepath, JSON.stringify(item) + '\n', 'utf-8');
}

// ============ Visited 集合管理 ============
class VisitedSet {
  constructor() {
    this.set = new Set();
    this.load();
  }

  load() {
    const data = readJson(PATHS.visited, []);
    this.set = new Set(data);
  }

  save() {
    writeJson(PATHS.visited, Array.from(this.set));
  }

  has(key) {
    return this.set.has(key);
  }

  add(key) {
    if (!this.set.has(key)) {
      this.set.add(key);
      return true;
    }
    return false;
  }

  size() {
    return this.set.size;
  }
}

// ============ 队列管理 ============
class CrawlQueue {
  constructor() {
    this.items = [];
    this.load();
  }

  load() {
    if (!fs.existsSync(PATHS.queue)) {
      this.items = [];
      return;
    }
    const lines = fs.readFileSync(PATHS.queue, 'utf-8').trim().split('\n');
    this.items = lines.filter(l => l).map(l => {
      try {
        return JSON.parse(l);
      } catch (e) {
        return null;
      }
    }).filter(Boolean);
  }

  add(item) {
    // 检查是否已存在
    const key = `${item.type}:${item.id}`;
    if (this.items.some(i => `${i.type}:${i.id}` === key)) {
      return false;
    }
    this.items.push(item);
    appendJsonl(PATHS.queue, item);
    return true;
  }

  // 随机深度优先选择
  pickNext(visited) {
    // 过滤已访问的
    const available = this.items.filter(item => {
      const key = `${item.type}:${item.id}`;
      return !visited.has(key);
    });

    if (available.length === 0) return null;

    // 70% 深度优先（选最近的），30% 随机跳转
    if (Math.random() < 0.7) {
      // 从最后5个中随机选
      const recentCount = Math.min(5, available.length);
      const recentItems = available.slice(-recentCount);
      return recentItems[Math.floor(Math.random() * recentItems.length)];
    } else {
      // 完全随机
      return available[Math.floor(Math.random() * available.length)];
    }
  }

  size() {
    return this.items.length;
  }

  // 重写队列文件（清理已访问的）
  compact(visited) {
    const originalCount = this.items.length;
    const remaining = this.items.filter(item => {
      const key = `${item.type}:${item.id}`;
      return !visited.has(key);
    });
    this.items = remaining;

    // 重写文件
    if (fs.existsSync(PATHS.queue)) {
      fs.unlinkSync(PATHS.queue);
    }
    if (remaining.length > 0) {
      const content = remaining.map(item => JSON.stringify(item)).join('\n') + '\n';
      fs.writeFileSync(PATHS.queue, content, 'utf-8');
    }

    const removed = originalCount - remaining.length;
    if (removed > 0) {
      logger.info(`队列清理: 移除 ${removed} 项, 剩余 ${remaining.length} 项`);
    }

    return remaining.length;
  }
}

// ============ 数据存储 ============
const Storage = {
  // 保存问题
  saveQuestion(questionId, data) {
    const dir = path.join(PATHS.questions, questionId);
    const metaFile = path.join(dir, 'meta.json');

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.mkdirSync(path.join(dir, 'answers'), { recursive: true });
    }

    const existing = readJson(metaFile, {});
    const merged = {
      ...existing,
      ...data,
      id: questionId,
      updatedAt: new Date().toISOString(),
    };
    if (!existing.crawledAt) {
      merged.crawledAt = new Date().toISOString();
    }

    writeJson(metaFile, merged);
    return metaFile;
  },

  // 保存回答
  saveAnswer(questionId, answerId, data) {
    const dir = path.join(PATHS.questions, questionId, 'answers');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const file = path.join(dir, `${answerId}.json`);
    const doc = {
      ...data,
      id: answerId,
      questionId,
      crawledAt: new Date().toISOString(),
    };
    writeJson(file, doc);
    return file;
  },

  // 保存文章
  saveArticle(articleId, data) {
    const file = path.join(PATHS.articles, `${articleId}.json`);
    const doc = {
      ...data,
      id: articleId,
      crawledAt: new Date().toISOString(),
    };
    writeJson(file, doc);
    return file;
  },

  // 保存作者
  saveAuthor(authorId, data) {
    if (!authorId) return null;

    const file = path.join(PATHS.authors, `${authorId}.json`);
    // 不覆盖已有的
    if (fs.existsSync(file)) {
      return file;
    }

    const doc = {
      ...data,
      id: authorId,
      crawledAt: new Date().toISOString(),
    };
    writeJson(file, doc);
    return file;
  },

  // 保存话题
  saveTopic(topicId, data) {
    const file = path.join(PATHS.topics, `${topicId}.json`);
    const existing = readJson(file, {});
    const merged = {
      ...existing,
      ...data,
      id: topicId,
      updatedAt: new Date().toISOString(),
    };
    if (!existing.crawledAt) {
      merged.crawledAt = new Date().toISOString();
    }
    writeJson(file, merged);
    return file;
  },

  // 检查是否存在
  hasQuestion(questionId) {
    return fs.existsSync(path.join(PATHS.questions, questionId, 'meta.json'));
  },

  hasAnswer(questionId, answerId) {
    return fs.existsSync(path.join(PATHS.questions, questionId, 'answers', `${answerId}.json`));
  },

  hasArticle(articleId) {
    return fs.existsSync(path.join(PATHS.articles, `${articleId}.json`));
  },

  // 获取统计
  getStats() {
    const stats = {
      questions: 0,
      answers: 0,
      articles: 0,
      authors: 0,
      topics: 0,
    };

    if (fs.existsSync(PATHS.questions)) {
      const questions = fs.readdirSync(PATHS.questions);
      stats.questions = questions.length;
      questions.forEach(qid => {
        const answersDir = path.join(PATHS.questions, qid, 'answers');
        if (fs.existsSync(answersDir)) {
          stats.answers += fs.readdirSync(answersDir).filter(f => f.endsWith('.json')).length;
        }
      });
    }

    if (fs.existsSync(PATHS.articles)) {
      stats.articles = fs.readdirSync(PATHS.articles).filter(f => f.endsWith('.json')).length;
    }

    if (fs.existsSync(PATHS.authors)) {
      stats.authors = fs.readdirSync(PATHS.authors).filter(f => f.endsWith('.json')).length;
    }

    if (fs.existsSync(PATHS.topics)) {
      stats.topics = fs.readdirSync(PATHS.topics).filter(f => f.endsWith('.json')).length;
    }

    return stats;
  },

  // 保存统计到文件
  saveStats(extra = {}) {
    const stats = this.getStats();
    const doc = {
      ...stats,
      ...extra,
      lastUpdated: new Date().toISOString(),
    };
    writeJson(PATHS.stats, doc);
    return doc;
  },
};

// ============ 从 topic feed item 解析并存储 ============
function processTopicFeedItem(item, topicId, visited, queue) {
  const itemType = item.type;
  const itemId = item.id;

  if (!itemId) return { saved: false };

  // 保存作者
  if (item.author && item.author.id) {
    Storage.saveAuthor(item.author.id, {
      name: item.author.name,
      headline: item.author.headline,
      avatarUrl: item.author.avatarUrl,
      url: item.author.url,
    });
  }

  const result = { saved: false, type: itemType };

  if (itemType === 'answer') {
    const question = item.question || {};
    const questionId = question.id;

    if (questionId) {
      // 保存问题元数据
      if (!Storage.hasQuestion(questionId)) {
        Storage.saveQuestion(questionId, {
          title: question.title || '',
          url: question.url || '',
          source: `topic_feed:${topicId}`,
          needsFetch: true,
        });

        // 添加到队列：获取问题完整信息
        queue.add({
          type: 'question',
          id: questionId,
          priority: 2,
          source: `topic_feed:${topicId}`,
        });
      }

      // 保存回答
      const visitKey = `answer:${itemId}`;
      if (visited.add(visitKey)) {
        Storage.saveAnswer(questionId, itemId, {
          content: item.content || '',
          excerpt: item.excerpt || '',
          title: item.title || '',
          voteupCount: item.voteupCount || 0,
          commentCount: item.commentCount || 0,
          createdTime: item.createdTime,
          updatedTime: item.updatedTime,
          author: item.author || {},
          url: item.url || '',
        });
        result.saved = true;
        result.questionId = questionId;
      }
    }
  } else if (itemType === 'article') {
    const visitKey = `article:${itemId}`;
    if (visited.add(visitKey)) {
      Storage.saveArticle(itemId, {
        title: item.title || '',
        content: item.content || '',
        excerpt: item.excerpt || '',
        voteupCount: item.voteupCount || 0,
        commentCount: item.commentCount || 0,
        createdTime: item.createdTime,
        updatedTime: item.updatedTime,
        author: item.author || {},
        url: item.url || '',
        imageUrl: item.imageUrl || '',
        source: `topic_feed:${topicId}`,
      });
      result.saved = true;
    }
  }

  return result;
}

// ============ 显示状态 ============
function showStatus(verbose = false) {
  ensureDataDirs();

  const stats = Storage.getStats();
  const visited = new VisitedSet();
  const queue = new CrawlQueue();

  console.log('');
  console.log('='.repeat(60));
  console.log('数据状态');
  console.log('='.repeat(60));
  console.log(`问题: ${stats.questions}`);
  console.log(`回答: ${stats.answers}`);
  console.log(`文章: ${stats.articles}`);
  console.log(`作者: ${stats.authors}`);
  console.log(`话题: ${stats.topics}`);
  console.log('');
  console.log(`待爬队列: ${queue.size()} 项`);
  console.log(`已访问: ${visited.size()} 项`);

  // Dry run report
  console.log('');
  console.log('='.repeat(60));
  console.log('Dry Run Report - 队列分析');
  console.log('='.repeat(60));

  // 统计队列类型
  const queueByType = {};
  const queueBySource = {};
  queue.items.forEach(item => {
    queueByType[item.type] = (queueByType[item.type] || 0) + 1;
    const src = item.source || 'unknown';
    queueBySource[src] = (queueBySource[src] || 0) + 1;
  });

  console.log('队列按类型:');
  Object.entries(queueByType).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });

  console.log('');
  console.log('队列按来源:');
  Object.entries(queueBySource).forEach(([src, count]) => {
    console.log(`  ${src}: ${count}`);
  });

  // 过滤已访问的，计算实际待爬
  const pendingItems = queue.items.filter(item => {
    const key = `${item.type}:${item.id}`;
    return !visited.has(key);
  });

  console.log('');
  console.log(`实际待爬: ${pendingItems.length} 项 (过滤已访问后)`);

  // 显示下一个要爬的（模拟 pickNext）
  if (pendingItems.length > 0) {
    console.log('');
    console.log('下一批可能爬取的目标 (随机深度优先):');
    const recentCount = Math.min(5, pendingItems.length);
    const recentItems = pendingItems.slice(-recentCount);
    recentItems.forEach((item, i) => {
      console.log(`  [${i + 1}] ${item.type}:${item.id} (from ${item.source})`);
    });
  }

  // 去重检查
  console.log('');
  console.log('='.repeat(60));
  console.log('去重机制');
  console.log('='.repeat(60));
  console.log('visited 集合:');
  const visitedByType = { answer: 0, article: 0, question: 0, other: 0 };
  visited.set.forEach(key => {
    const [type] = key.split(':');
    if (visitedByType[type] !== undefined) {
      visitedByType[type]++;
    } else {
      visitedByType.other++;
    }
  });
  Object.entries(visitedByType).filter(([, v]) => v > 0).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });

  // 文件系统去重
  console.log('');
  console.log('文件系统:');
  console.log(`  questions/ 目录: ${stats.questions} 个问题`);
  console.log(`  articles/ 目录: ${stats.articles} 篇文章`);
  console.log(`  authors/ 目录: ${stats.authors} 个作者`);

  console.log('');
  console.log('='.repeat(60));
  console.log('');
}

// ============ 显示队列详情 ============
function showQueue() {
  ensureDataDirs();
  const queue = new CrawlQueue();
  const visited = new VisitedSet();

  console.log('');
  console.log('='.repeat(60));
  console.log(`队列详情 (共 ${queue.size()} 项)`);
  console.log('='.repeat(60));

  queue.items.forEach((item, i) => {
    const key = `${item.type}:${item.id}`;
    const status = visited.has(key) ? '[已访问]' : '[待爬]';
    console.log(`${i + 1}. ${status} ${item.type}:${item.id}`);
    console.log(`   来源: ${item.source || 'unknown'}`);
    console.log(`   优先级: ${item.priority || 'N/A'}`);
  });
  console.log('');
}

module.exports = {
  PATHS,
  ensureDataDirs,
  readJson,
  writeJson,
  appendJsonl,
  VisitedSet,
  CrawlQueue,
  Storage,
  processTopicFeedItem,
  showStatus,
  showQueue,
};
