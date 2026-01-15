#!/usr/bin/env node
/**
 * 一次性脚本：转换所有回答的 createdTime 和 updatedTime
 * 将 Unix 时间戳转换为 "YYYY-MM-DD HH:mm" 格式
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const QUESTIONS_DIR = path.join(DATA_DIR, 'questions');

// Unix 时间戳转换为 "YYYY-MM-DD HH:mm" 格式
function formatTimestamp(ts) {
  if (!ts) return null;

  // 如果已经是字符串格式 "YYYY-MM-DD HH:mm"，直接返回
  if (typeof ts === 'string' && ts.match(/^\d{4}-\d{2}-\d{2}/)) {
    return ts;
  }

  // 如果是数字（Unix 时间戳）
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

function main() {
  const questionDirs = fs.readdirSync(QUESTIONS_DIR).filter(d => {
    const p = path.join(QUESTIONS_DIR, d);
    return fs.statSync(p).isDirectory();
  });

  console.log(`找到 ${questionDirs.length} 个问题目录`);

  let totalAnswers = 0;
  let convertedCreated = 0;
  let convertedUpdated = 0;

  for (const qid of questionDirs) {
    const answersDir = path.join(QUESTIONS_DIR, qid, 'answers');
    if (!fs.existsSync(answersDir)) continue;

    const answerFiles = fs.readdirSync(answersDir).filter(f => f.endsWith('.json'));

    for (const file of answerFiles) {
      const filePath = path.join(answersDir, file);
      totalAnswers++;

      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        let modified = false;

        // 转换 createdTime
        if (data.createdTime !== undefined) {
          const formatted = formatTimestamp(data.createdTime);
          if (formatted !== data.createdTime) {
            data.createdTime = formatted;
            modified = true;
            convertedCreated++;
          }
        } else {
          // 添加 null 值
          data.createdTime = null;
          modified = true;
        }

        // 转换 updatedTime
        if (data.updatedTime !== undefined) {
          const formatted = formatTimestamp(data.updatedTime);
          if (formatted !== data.updatedTime) {
            data.updatedTime = formatted;
            modified = true;
            convertedUpdated++;
          }
        } else {
          // 添加 null 值
          data.updatedTime = null;
          modified = true;
        }

        if (modified) {
          fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        }
      } catch (e) {
        console.error(`处理 ${filePath} 失败:`, e.message);
      }
    }
  }

  console.log(`\n结果:`);
  console.log(`  总回答数: ${totalAnswers}`);
  console.log(`  转换 createdTime: ${convertedCreated}`);
  console.log(`  转换 updatedTime: ${convertedUpdated}`);
}

main();
