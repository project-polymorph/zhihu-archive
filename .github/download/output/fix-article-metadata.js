/**
 * 修复旧文章的 metadata
 * 从 rawHtml 中的 js-initialData 提取完整数据
 */

const fs = require('fs');
const path = require('path');

const articlesDir = path.join(__dirname, '..', 'data', 'articles');

// 格式化时间戳
function formatTimestamp(ts) {
  if (!ts) return null;
  if (typeof ts === 'string' && ts.match(/^\d{4}-\d{2}-\d{2}/)) return ts;
  if (typeof ts === 'number') {
    const date = new Date(ts * 1000);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }
  return null;
}

// 从 rawHtml 提取 js-initialData
function extractInitialData(rawHtml) {
  if (!rawHtml) return null;

  const scriptMatch = rawHtml.match(/<script[^>]*id="js-initialData"[^>]*>([^<]+)<\/script>/);
  if (!scriptMatch) return null;

  try {
    return JSON.parse(scriptMatch[1]);
  } catch (e) {
    return null;
  }
}

// 从 initialData 获取文章数据
function getArticleData(initialData) {
  if (!initialData?.initialState?.entities?.articles) return null;

  const articles = initialData.initialState.entities.articles;
  const articleId = Object.keys(articles)[0];
  if (!articleId) return null;

  return articles[articleId];
}

// 处理单个文章
function fixArticle(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  if (!data.rawHtml) {
    return { status: 'no_rawHtml', file: path.basename(filePath) };
  }

  const initialData = extractInitialData(data.rawHtml);
  if (!initialData) {
    return { status: 'no_initialData', file: path.basename(filePath) };
  }

  const articleData = getArticleData(initialData);
  if (!articleData) {
    return { status: 'no_articleData', file: path.basename(filePath) };
  }

  // 记录原始值
  const original = {
    voteupCount: data.voteupCount,
    commentCount: data.commentCount,
    topics: data.topics,
    authorId: data.author?.id,
  };

  // 更新数据
  let updated = false;

  // voteupCount
  const newVoteup = articleData.voteupCount ?? articleData.voteup_count;
  if (newVoteup !== undefined && newVoteup !== data.voteupCount) {
    data.voteupCount = newVoteup;
    updated = true;
  }

  // commentCount
  const newComment = articleData.commentCount ?? articleData.comment_count;
  if (newComment !== undefined && newComment !== data.commentCount) {
    data.commentCount = newComment;
    updated = true;
  }

  // topics
  const newTopics = articleData.topics?.map(t => t.name || t) || [];
  if (newTopics.length > 0 && (!data.topics || data.topics.length === 0)) {
    data.topics = newTopics;
    updated = true;
  }

  // author
  if (articleData.author) {
    const newAuthor = {
      id: articleData.author.id || data.author?.id || '',
      name: articleData.author.name || data.author?.name || '',
      url: articleData.author.url || data.author?.url || '',
      avatarUrl: articleData.author.avatar_url || articleData.author.avatarUrl || data.author?.avatarUrl || '',
      headline: articleData.author.headline || data.author?.headline || '',
    };
    if (!data.author?.id && newAuthor.id) {
      data.author = newAuthor;
      updated = true;
    }
  }

  // createdTime
  if (articleData.created && !data.createdTime) {
    data.createdTime = formatTimestamp(articleData.created);
    updated = true;
  }

  // updatedTime
  if (articleData.updated && !data.updatedTime) {
    data.updatedTime = formatTimestamp(articleData.updated);
    updated = true;
  }

  // 添加 updatedAt 标记
  if (updated) {
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  return {
    status: updated ? 'updated' : 'no_change',
    file: path.basename(filePath),
    changes: updated ? {
      voteupCount: `${original.voteupCount} -> ${data.voteupCount}`,
      commentCount: `${original.commentCount} -> ${data.commentCount}`,
      topics: `${original.topics?.length || 0} -> ${data.topics?.length || 0}`,
      authorId: `${original.authorId || 'none'} -> ${data.author?.id || 'none'}`,
    } : null,
  };
}

// 主函数
function main() {
  const files = fs.readdirSync(articlesDir).filter(f => f.endsWith('.json'));

  console.log(`找到 ${files.length} 篇文章\n`);

  const stats = {
    updated: 0,
    no_change: 0,
    no_rawHtml: 0,
    no_initialData: 0,
    no_articleData: 0,
    error: 0,
  };

  for (const file of files) {
    const filePath = path.join(articlesDir, file);
    try {
      const result = fixArticle(filePath);
      stats[result.status]++;

      if (result.status === 'updated') {
        console.log(`✓ ${result.file}`);
        console.log(`  赞: ${result.changes.voteupCount}`);
        console.log(`  评论: ${result.changes.commentCount}`);
        console.log(`  话题: ${result.changes.topics}`);
        console.log(`  作者ID: ${result.changes.authorId}`);
        console.log('');
      } else if (result.status === 'no_rawHtml') {
        console.log(`- ${result.file} (无 rawHtml)`);
      }
    } catch (e) {
      stats.error++;
      console.log(`✗ ${file}: ${e.message}`);
    }
  }

  console.log('\n========== 统计 ==========');
  console.log(`已更新: ${stats.updated}`);
  console.log(`无变化: ${stats.no_change}`);
  console.log(`无 rawHtml: ${stats.no_rawHtml}`);
  console.log(`无 initialData: ${stats.no_initialData}`);
  console.log(`无 articleData: ${stats.no_articleData}`);
  console.log(`错误: ${stats.error}`);
}

main();
