const fs = require('fs');
const path = require('path');
const config = require('./config');
const { ensureDir, logger } = require('./utils');

// ============ HTML 清理函数 ============
function stripHtml(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code))
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanAnswerText(text) {
  return text
    .replace(/data-\w+="[^"]*"/g, '')
    .replace(/class="[^"]*"/g, '')
    .replace(/展开阅读全文/g, '')
    .replace(/​/g, '')
    .replace(/赞同 \d+/g, '')
    .replace(/\d+ 条评论/g, '')
    .replace(/分享/g, '')
    .replace(/收藏/g, '')
    .replace(/喜欢/g, '')
    .replace(/关注/g, '')
    .replace(/编辑于.*?(?=\s|$)/g, '')
    .replace(/发布于.*?(?=\s|$)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============ 内容提取函数 ============
function extractTitle(html) {
  const match = html.match(/<h1[^>]*class="[^"]*QuestionHeader-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i);
  return match ? stripHtml(match[1]) : '';
}

function extractQuestion(html) {
  const match = html.match(/<div[^>]*class="[^"]*QuestionRichText[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  return match ? stripHtml(match[1]) : '';
}

function extractAnswers(html) {
  const answers = [];

  // 方法1: RichContent-inner
  const richContentRegex = /<div[^>]*class="[^"]*RichContent-inner[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
  let match;
  while ((match = richContentRegex.exec(html)) !== null) {
    const content = cleanAnswerText(stripHtml(match[1]));
    if (content.length > 50) {
      answers.push(content);
    }
  }

  // 方法2: RichText span
  if (answers.length === 0) {
    const richTextRegex = /<span[^>]*class="[^"]*RichText[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
    while ((match = richTextRegex.exec(html)) !== null) {
      const content = cleanAnswerText(stripHtml(match[1]));
      if (content.length > 50) {
        answers.push(content);
      }
    }
  }

  return answers;
}

function extractAuthors(html) {
  const authors = [];
  const authorRegex = /<meta[^>]*itemprop="name"[^>]*content="([^"]+)"/gi;
  let match;
  while ((match = authorRegex.exec(html)) !== null) {
    if (!authors.includes(match[1])) {
      authors.push(match[1]);
    }
  }
  return authors;
}

// ============ 主提取函数 ============
function extractZhihuContent(html) {
  return {
    title: extractTitle(html),
    question: extractQuestion(html),
    answers: extractAnswers(html),
    authors: extractAuthors(html),
    extractedAt: new Date().toISOString(),
  };
}

// ============ 格式化输出 ============
function formatMarkdown(content) {
  let output = '';

  if (content.title) {
    output += `# ${content.title}\n\n`;
  }

  if (content.question) {
    output += `## 问题描述\n\n${content.question}\n\n`;
  }

  if (content.answers.length > 0) {
    output += `## 回答 (共 ${content.answers.length} 条)\n\n`;
    content.answers.forEach((answer, i) => {
      const author = content.authors[i] || '匿名用户';
      output += `### 回答 ${i + 1} - ${author}\n\n${answer}\n\n---\n\n`;
    });
  }

  output += `\n---\n提取时间: ${content.extractedAt}\n`;

  return output;
}

function formatJson(content) {
  return JSON.stringify(content, null, 2);
}

// ============ 文件操作 ============
function readHtmlFile(filepath) {
  if (!fs.existsSync(filepath)) {
    throw new Error(`文件不存在: ${filepath}`);
  }
  return fs.readFileSync(filepath, 'utf-8');
}

function saveOutput(filepath, content, format = 'txt') {
  const ext = format === 'json' ? '.json' : '.txt';
  const basename = path.basename(filepath, '.html');
  const outputPath = path.join(config.outputDir, `${basename}${ext}`);

  ensureDir(config.outputDir);

  const output = format === 'json' ? formatJson(content) : formatMarkdown(content);
  fs.writeFileSync(outputPath, output, 'utf-8');

  return outputPath;
}

// ============ 主函数 ============
function extractFromFile(htmlFile, format = 'txt') {
  logger.info(`提取文件: ${htmlFile}`);

  const html = readHtmlFile(htmlFile);
  const content = extractZhihuContent(html);
  const outputPath = saveOutput(htmlFile, content, format);

  return {
    content,
    outputPath,
    stats: {
      title: content.title,
      answerCount: content.answers.length,
      authorCount: content.authors.length,
    },
  };
}

// ============ CLI ============
function printUsage() {
  console.log('用法: node extract.js <html文件> [选项]');
  console.log('');
  console.log('选项:');
  console.log('  --json    输出 JSON 格式');
  console.log('  --help    显示帮助');
}

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
  }

  const htmlFile = args.find(a => !a.startsWith('--'));
  const format = args.includes('--json') ? 'json' : 'txt';

  try {
    const result = extractFromFile(htmlFile, format);
    logger.done(`标题: ${result.stats.title}`);
    logger.done(`回答数: ${result.stats.answerCount}`);
    logger.done(`输出: ${result.outputPath}`);
  } catch (err) {
    logger.error(err.message);
    process.exit(1);
  }
}

module.exports = {
  extractFromFile,
  extractZhihuContent,
  formatMarkdown,
  formatJson,
  stripHtml,
  cleanAnswerText,
};
