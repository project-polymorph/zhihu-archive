# 知乎页面下载器

使用 Puppeteer 模拟真实浏览器访问知乎，下载页面并提取内容。

## 功能特性

- 扫码登录知乎
- 下载单个问答/文章页面
- 爬取话题（讨论 + 精华两个 Tab）
- 深度滚动加载更多内容
- 模拟真实用户行为（随机延迟、鼠标移动）
- 输出 JSON 格式，包含完整元数据

## 安装

```bash
npm install
```

## 使用方法

### 1. 登录（首次使用）

```bash
node index.js login
# 或
node login.js
```

运行后会显示二维码截图，使用知乎 App 扫码登录。登录状态会保存到 `cookies.json`。

### 2. 爬取话题

```bash
node index.js topic "https://www.zhihu.com/topic/27814732"
# 或
node topic.js "https://www.zhihu.com/topic/27814732/hot"
```

会自动爬取「讨论」和「精华」两个 Tab，深度滚动加载更多内容。

### 3. 下载单个页面

```bash
node index.js download "https://www.zhihu.com/question/xxx/answer/xxx"
# 或
node download.js "url"
```

### 4. 提取文本

```bash
node index.js extract output/xxx.html
# 或
node extract.js output/xxx.html --json
```

## 输出结构

```
output/
├── topic_27814732_2026-01-14/     # 话题输出目录
│   ├── result.json                # 完整 JSON 结果
│   ├── discussion.html            # 讨论 Tab HTML
│   ├── featured.html              # 精华 Tab HTML
│   ├── topic_overview.png         # 话题概览截图
│   ├── discussion_initial.png     # 讨论初始截图
│   ├── discussion_final.png       # 讨论最终截图
│   ├── scroll_0.png               # 滚动过程截图（调试用）
│   ├── scroll_5.png
│   └── ...
├── login-page.png                 # 登录页截图
├── qrcode.png                     # 二维码
└── ...
```

## JSON 输出格式

```json
{
  "meta": {
    "topicId": "27814732",
    "topicUrl": "https://www.zhihu.com/topic/27814732",
    "crawledAt": "2026-01-14T15:00:00.000Z",
    "outputDir": "output/topic_27814732_2026-01-14"
  },
  "topic": {
    "name": "变性人生",
    "description": "...",
    "followersCount": "805 万",
    "questionsCount": "3771"
  },
  "tabs": {
    "discussion": {
      "tab": "discussion",
      "name": "讨论",
      "url": "https://www.zhihu.com/topic/27814732/hot",
      "itemCount": 50,
      "items": [
        {
          "id": "1890708654895895137",
          "type": "article",
          "title": "中国性别重置先驱张克莎的传奇人生",
          "authorName": "扯会闲白",
          "url": "https://zhuanlan.zhihu.com/p/xxx",
          "excerpt": "...",
          "voteCount": "1234",
          "commentCount": "56",
          "createdTime": "2026-01-10"
        }
      ]
    },
    "featured": {
      // 同上结构
    }
  }
}
```

## 文件结构

```
├── config.js      # 配置文件
├── utils.js       # 工具函数（延迟、日志等）
├── browser.js     # 浏览器配置和反检测
├── login.js       # 扫码登录
├── download.js    # 单页面下载
├── extract.js     # 文本提取
├── topic.js       # 话题爬取（核心）
├── index.js       # 统一入口
├── cookies.json   # 登录状态（gitignore）
├── package.json
├── README.md
├── .gitignore
└── output/        # 输出目录（gitignore）
```

## 反检测特性

- Puppeteer Stealth 插件
- 随机 User-Agent
- WebDriver 特征隐藏
- Chrome 对象伪装
- WebGL 渲染器伪装
- 模拟真实用户行为：
  - 随机延迟（1.5-3.5秒）
  - 随机滚动距离
  - 随机鼠标移动
  - 偶尔暂停（模拟阅读）

## 配置

在 `config.js` 中可以调整：

- `timeout`: 页面加载超时
- `viewport`: 浏览器窗口大小
- `userAgents`: User-Agent 列表
- `delay`: 延迟配置

在 `topic.js` 中可以调整：

- `maxScrolls`: 最大滚动次数（默认 20）
- `minDelay/maxDelay`: 滚动延迟范围
- `scrollDistance`: 滚动距离范围

## 注意事项

- 首次使用需要登录才能访问完整内容
- 话题页面需要登录才能查看
- 爬取速度故意放慢以模拟真实用户
- 截图文件主要用于调试，可以删除节省空间
