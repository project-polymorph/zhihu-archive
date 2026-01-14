#!/usr/bin/env node
/**
 * 队列去重和清理脚本
 *
 * 用法:
 *   node compact-queue.js          # 显示状态
 *   node compact-queue.js --run    # 执行清理
 */

const fs = require('fs');
const path = require('path');
const { PATHS, VisitedSet, readJson, writeJson } = require('./storage');

function compactQueue(dryRun = true) {
  const queueFile = PATHS.queue;

  if (!fs.existsSync(queueFile)) {
    console.log('队列文件不存在');
    return;
  }

  // 读取队列
  const lines = fs.readFileSync(queueFile, 'utf-8').trim().split('\n');
  const items = lines.filter(l => l).map(l => {
    try {
      return JSON.parse(l);
    } catch (e) {
      return null;
    }
  }).filter(Boolean);

  console.log(`原始队列: ${items.length} 项`);

  // 加载 visited
  const visited = new VisitedSet();
  console.log(`已访问: ${visited.size()} 项`);

  // 去重：1. 移除已访问的 2. 按 type:id 去重
  const seen = new Set();
  const unique = [];

  for (const item of items) {
    const key = `${item.type}:${item.id}`;

    // 跳过已访问
    if (visited.has(key)) {
      continue;
    }

    // 跳过重复
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(item);
  }

  const removed = items.length - unique.length;
  console.log(`去重后: ${unique.length} 项 (移除 ${removed} 项)`);

  // 统计
  const byType = {};
  unique.forEach(item => {
    byType[item.type] = (byType[item.type] || 0) + 1;
  });
  console.log('\n按类型:');
  Object.entries(byType).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });

  if (dryRun) {
    console.log('\n[Dry Run] 使用 --run 执行实际清理');
  } else {
    // 备份原文件
    const backupFile = queueFile + '.bak';
    fs.copyFileSync(queueFile, backupFile);
    console.log(`\n已备份到: ${backupFile}`);

    // 重写队列文件
    const content = unique.map(item => JSON.stringify(item)).join('\n') + '\n';
    fs.writeFileSync(queueFile, content, 'utf-8');
    console.log(`已重写队列: ${unique.length} 项`);
  }
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--run');
  compactQueue(dryRun);
}

module.exports = { compactQueue };
