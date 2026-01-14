# 知乎页面下载器

使用 Puppeteer 模拟真实浏览器访问知乎，下载页面并提取文本内容。

## 安装

```bash
npm install
```

## 使用方法

### 登录（推荐）

首次使用建议先登录，登录后可以访问更多内容：

```bash
node login.js
```

运行后会显示二维码，使用知乎 App 扫码登录。

### 下载页面

```bash
# 下载单个页面
node download.js "https://www.zhihu.com/question/xxx/answer/xxx"

# 或使用 index.js
node index.js download "https://www.zhihu.com/question/xxx/answer/xxx"
```

### 提取文本

```bash
# 从 HTML 提取文本
node extract.js output/zhihu-answer-xxx.html

# 输出 JSON 格式
node extract.js output/zhihu-answer-xxx.html --json
```

### 下载并提取

```bash
node index.js all "https://www.zhihu.com/question/xxx/answer/xxx"
```

## 文件结构

```
├── config.js      # 配置文件
├── utils.js       # 工具函数
├── browser.js     # 浏览器配置和反检测
├── login.js       # 扫码登录
├── download.js    # 页面下载
├── extract.js     # 文本提取
├── index.js       # 统一入口
└── output/        # 输出目录
```

## 输出文件

所有下载的文件都保存在 `output/` 目录：

- `*.html` - 原始 HTML
- `*.png` - 页面截图
- `*.txt` - 提取的文本（Markdown 格式）
- `*.json` - 提取的文本（JSON 格式）

## 反检测特性

- Puppeteer Stealth 插件
- 随机 User-Agent
- 模拟真实用户行为（鼠标移动、滚动）
- WebDriver 特征隐藏
- Chrome 对象伪装
- WebGL 渲染器伪装
