const fs = require('fs');
const path = require('path');
const config = require('./config');

// ============ 延迟函数 ============
function randomDelay(min = config.delay.min, max = config.delay.max) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, delay));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============ 随机选择 ============
function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ============ 文件名生成 ============
function generateFilename(url) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const urlParts = url.match(/answer\/(\d+)|question\/(\d+)|topic\/(\d+)/);
  const id = urlParts ? (urlParts[1] || urlParts[2] || urlParts[3]) : 'page';
  const type = url.includes('answer') ? 'answer' : url.includes('question') ? 'question' : 'topic';
  return `zhihu-${type}-${id}-${timestamp}`;
}

// ============ 目录操作 ============
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getOutputPath(filename, ext) {
  ensureDir(config.outputDir);
  return path.join(config.outputDir, `${filename}${ext}`);
}

// ============ 日志 ============
function log(level, message) {
  const timestamp = new Date().toISOString().slice(11, 19);
  console.log(`[${timestamp}] [${level}] ${message}`);
}

const logger = {
  info: (msg) => log('INFO', msg),
  step: (msg) => log('STEP', msg),
  done: (msg) => log('DONE', msg),
  error: (msg) => log('ERROR', msg),
  warn: (msg) => log('WARN', msg),
};

module.exports = {
  randomDelay,
  sleep,
  randomChoice,
  randomInt,
  generateFilename,
  ensureDir,
  getOutputPath,
  logger,
};
