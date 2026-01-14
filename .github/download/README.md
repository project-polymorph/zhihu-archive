# 知乎页面下载器

使用 Puppeteer 模拟真实浏览器访问知乎，下载页面并提取内容。

## 功能特性

- 扫码登录知乎
- 下载单个问答/文章页面
- 爬取话题（持续滚动，收集所有数据）
- 拦截 API 响应，直接获取结构化数据
- 模拟真实用户行为（随机延迟、鼠标移动、阅读暂停）
- 输出 JSON 格式，包含完整元数据
- 自动去重（基于 ID）

## 安装

```bash
npm install
```

## 使用方法

### 1. 登录（首次使用）

```bash
node index.js login
```

运行后会显示二维码截图，使用知乎 App 扫码登录。

### 2. 爬取话题

```bash
node topic.js "https://www.zhihu.com/topic/27814732/hot" 500
```

参数：
- 第一个参数：话题 URL
- 第二个参数：最大滚动次数（默认 2000）

### 3. 调试模式

```bash
node debug.js "https://www.zhihu.com/topic/27814732/hot"
```

捕获所有网络流量，用于分析 API。

## 输出结构

```
output/
├── topic_27814732_2026-01-14T15-38-05/
│   ├── api.json           # 所有 API 请求/响应日志
│   ├── result.json        # 解析后的结构化数据（去重）
│   ├── initial.png        # 初始截图
│   ├── scroll_50.png      # 滚动过程截图
│   └── final.png          # 最终截图
└── debug_xxx/             # 调试输出
    ├── api_10.json
    ├── network_10.json
    └── *.png
```

## API 分析

### 话题 Feed API

通过网络流量分析，发现知乎话题页面使用以下 API 加载数据：

```
GET https://www.zhihu.com/api/v5.1/topics/{topicId}/feeds/essence/v2?offset=X&limit=20
```

**响应结构：**
```json
{
  "paging": {
    "totals": 3771,
    "is_start": false,
    "is_end": false,
    "previous": "...?offset=0&limit=20",
    "next": "...?offset=40&limit=20"
  },
  "data": [
    {
      "type": "topic_feed",
      "target": {
        "id": "1890708654895895137",
        "type": "article",
        "url": "https://zhuanlan.zhihu.com/p/xxx",
        "excerpt_title": "标题",
        "excerpt": "摘要...",
        "voteup_count": 108,
        "comment_count": 15,
        "author": {
          "id": "xxx",
          "name": "作者名",
          "avatar_url": "..."
        }
      }
    }
  ]
}
```

**关键字段：**
- `paging.totals`: 总条目数
- `paging.is_end`: 是否到底
- `paging.next`: 下一页 URL
- `data[].target.type`: 内容类型（article/answer/pin/zvideo）

### 其他重要 API

| API | 说明 |
|-----|------|
| `/api/v4/topics/{id}/intro` | 话题介绍 |
| `/api/v4/topics/{id}/creator_wall` | 话题创作者 |
| `/api/v3/topics/{id}/parent` | 父话题 |
| `/api/v5.1/topics/{id}/feeds/essence/sticky/v2` | 置顶内容 |

## 爬取策略

### 为什么不用高度判断？

最初尝试通过 `document.body.scrollHeight` 判断是否到底，但发现：
1. 页面高度变化滞后于 API 加载
2. 有时高度不变但 API 仍在返回新数据
3. 会导致过早停止

### 当前策略

1. **持续滚动**：不依赖高度判断，持续滚动指定次数
2. **拦截 API**：监听所有 `/feeds/` API 响应
3. **实时解析**：每次 API 返回数据立即解析并保存
4. **ID 去重**：用 Set 记录已见 ID，避免重复

### 模拟真实用户

```javascript
// 随机滚动方式
- 60% 平滑滚动 (smooth)
- 30% 直接滚动
- 10% 滚动到随机元素

// 随机延迟
- 基础延迟: 2-4 秒
- 10% 概率长暂停: 3-8 秒（模拟阅读）
- 30% 概率移动鼠标
```

## 文件结构

```
├── config.js      # 配置
├── utils.js       # 工具函数
├── browser.js     # 浏览器反检测
├── login.js       # 扫码登录
├── download.js    # 单页面下载
├── extract.js     # 文本提取
├── topic.js       # 话题爬取（核心）
├── debug.js       # 调试/网络分析
├── index.js       # 统一入口
├── cookies.json   # 登录状态
└── output/        # 输出目录
```

## 反检测特性

- Puppeteer Stealth 插件
- 随机 User-Agent
- WebDriver 特征隐藏
- Chrome 对象伪装
- WebGL 渲染器伪装
- navigator 属性伪装（plugins, languages, platform）

## 配置调整

在 `topic.js` 的 `TOPIC_CONFIG` 中可调整：

```javascript
scrollConfig: {
  minDelay: 2000,              // 最小延迟 (ms)
  maxDelay: 4000,              // 最大延迟 (ms)
  scrollDistance: { min: 300, max: 700 },  // 滚动距离
  mouseMoveProbability: 0.3,   // 移动鼠标概率
  pauseProbability: 0.1,       // 长暂停概率
  pauseDuration: { min: 3000, max: 8000 }, // 暂停时长
}
```

## 注意事项

- 首次使用需要登录才能访问完整内容
- 爬取速度故意放慢以模拟真实用户
- 每次有新数据会自动保存，中断后数据不丢失
- 截图文件用于调试，可删除节省空间
- Ctrl+C 可安全停止，会保存已收集的数据
