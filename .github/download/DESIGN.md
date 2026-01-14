# 知乎随机深度优先爬虫设计

## 核心理念

传统爬虫：广度优先，像机器一样扫描
本设计：**随机深度优先**，像真实用户一样漫游

```
真实用户行为模式：
1. 刷话题 Feed → 看到感兴趣的回答 → 点进去
2. 看完回答 → 看看这个问题的其他回答
3. 觉得作者不错 → 逛逛他的主页
4. 看到相关推荐 → 又点进去看看
5. 累了 → 关掉浏览器
6. 下次继续 → 从任意入口重新开始
```

## 文件系统结构

```
data/
├── questions/                     # 问题库
│   └── {question_id}/
│       ├── meta.json              # 问题元数据
│       └── answers/
│           ├── {answer_id}.json   # 完整回答
│           └── ...
│
├── articles/                      # 专栏文章库
│   └── {article_id}.json
│
├── authors/                       # 作者库（可选，用于发现更多内容）
│   └── {author_id}.json
│
├── topics/                        # 话题库（入口点）
│   └── {topic_id}.json
│
└── .state/                        # 爬虫状态（断点续爬）
    ├── queue.jsonl                # 待访问队列 (JSONL格式，追加写入)
    ├── visited.json               # 已访问ID集合
    └── stats.json                 # 统计信息
```

## 数据模型

### Question (问题)
```json
{
  "id": "1987770839429554973",
  "title": "问题标题",
  "detail": "问题描述HTML",
  "created": 1704067200,
  "updated": 1704153600,
  "followerCount": 1234,
  "answerCount": 56,
  "topics": ["topic_id_1", "topic_id_2"],
  "author": { "id": "xxx", "name": "提问者" },
  "url": "https://www.zhihu.com/question/1987770839429554973",
  "crawledAt": "2026-01-14T12:00:00Z"
}
```

### Answer (回答)
```json
{
  "id": "1992993970578552247",
  "questionId": "1987770839429554973",
  "content": "回答HTML内容",
  "excerpt": "摘要",
  "voteupCount": 108,
  "commentCount": 15,
  "created": 1704067200,
  "updated": 1704153600,
  "author": {
    "id": "author_id",
    "name": "作者名",
    "headline": "个人简介",
    "avatarUrl": "..."
  },
  "url": "https://www.zhihu.com/question/.../answer/...",
  "crawledAt": "2026-01-14T12:00:00Z"
}
```

### Article (文章)
```json
{
  "id": "1890708654895895137",
  "title": "文章标题",
  "content": "文章HTML内容",
  "excerpt": "摘要",
  "voteupCount": 108,
  "commentCount": 15,
  "created": 1704067200,
  "updated": 1704153600,
  "author": { ... },
  "topics": ["topic_id_1"],
  "url": "https://zhuanlan.zhihu.com/p/1890708654895895137",
  "crawledAt": "2026-01-14T12:00:00Z"
}
```

## 队列设计 (queue.jsonl)

使用 JSONL 格式，每行一个待访问项，追加写入：

```jsonl
{"type":"topic_feed","id":"27814732","priority":1,"source":"seed"}
{"type":"question","id":"1987770839429554973","priority":2,"source":"topic_feed:27814732"}
{"type":"answer","id":"1992993970578552247","questionId":"1987770839429554973","priority":3,"source":"question:1987770839429554973"}
{"type":"article","id":"1890708654895895137","priority":2,"source":"topic_feed:27814732"}
{"type":"author_articles","id":"author_123","priority":4,"source":"answer:1992993970578552247"}
```

### 优先级策略
- **priority 1**: 种子入口（话题Feed）
- **priority 2**: 直接内容（文章、问题页）
- **priority 3**: 关联内容（问题下的其他回答）
- **priority 4**: 扩展内容（作者的其他文章）

### 随机选择算法
```python
def pick_next(queue):
    # 不是简单的 FIFO，而是加权随机
    # 70% 概率选低优先级（深入当前路径）
    # 30% 概率选高优先级（跳到新路径）

    if random.random() < 0.7:
        # 深度优先：选最近添加的
        return queue[-random.randint(1, min(5, len(queue)))]
    else:
        # 随机跳转：从全部中随机选
        return random.choice(queue)
```

## 爬取流程

```
┌─────────────────────────────────────────────────────────────┐
│                      启动爬虫                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  加载状态: queue.jsonl + visited.json                        │
│  如果 queue 为空，添加种子话题                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  随机选择下一个目标 (加权随机)                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  检查是否已访问 → 是 → 跳过，继续选择                         │
└─────────────────────────────────────────────────────────────┘
                              │ 否
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  模拟真实用户行为：                                          │
│  - 随机延迟 2-8 秒                                           │
│  - 偶尔长暂停 10-30 秒（模拟阅读）                            │
│  - 随机移动鼠标                                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  访问页面 / 调用 API                                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  解析内容，保存到对应目录                                     │
│  - question → data/questions/{id}/meta.json                 │
│  - answer   → data/questions/{qid}/answers/{id}.json        │
│  - article  → data/articles/{id}.json                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  发现新内容，添加到队列：                                     │
│  - 从 answer 发现 question（如果没爬过）                      │
│  - 从 question 发现其他 answers                              │
│  - 从内容发现 related topics                                 │
│  - 从作者发现更多 articles                                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  更新状态：                                                  │
│  - 追加 queue.jsonl                                         │
│  - 更新 visited.json                                        │
│  - 更新 stats.json                                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    [循环继续 / Ctrl+C 安全退出]
```

## 断点续爬

### 为什么能断点续爬？

1. **增量文件写入**
   - `queue.jsonl` 追加写入，不会丢失
   - 每个内容独立文件，写完即持久化

2. **幂等性**
   - 同一 ID 只会爬一次（visited 检查）
   - 重复运行不会重复爬取

3. **状态恢复**
   ```python
   def resume():
       # 加载已访问集合
       visited = load_json('.state/visited.json') or set()

       # 加载队列（过滤已访问的）
       queue = []
       for line in open('.state/queue.jsonl'):
           item = json.loads(line)
           if item['id'] not in visited:
               queue.append(item)

       return queue, visited
   ```

### 安全退出
```python
import signal

def safe_exit(signum, frame):
    logger.info("收到退出信号，保存状态...")
    save_state(queue, visited, stats)
    sys.exit(0)

signal.signal(signal.SIGINT, safe_exit)
signal.signal(signal.SIGTERM, safe_exit)
```

## 内容发现策略

### 从 Topic Feed 发现
```python
def process_topic_feed(topic_id):
    # API: /api/v5.1/topics/{id}/feeds/essence/v2
    for item in feed_data:
        if item.type == 'answer':
            add_to_queue('answer', item.id, question_id=item.question.id)
            add_to_queue('question', item.question.id)  # 发现问题
        elif item.type == 'article':
            add_to_queue('article', item.id)
```

### 从 Question 发现
```python
def process_question(question_id):
    # 保存问题元数据
    # API: /api/v4/questions/{id}/answers?limit=20&offset=0
    for answer in answers:
        add_to_queue('answer', answer.id, question_id=question_id)
```

### 从 Answer/Article 发现
```python
def process_content(content):
    # 保存内容
    # 发现作者
    if random.random() < 0.3:  # 30% 概率探索作者
        add_to_queue('author_articles', content.author.id)
```

## API 端点整理

| 用途 | API |
|------|-----|
| 话题 Feed | `GET /api/v5.1/topics/{id}/feeds/essence/v2?offset=0&limit=20` |
| 问题详情 | `GET /api/v4/questions/{id}` |
| 问题回答列表 | `GET /api/v4/questions/{id}/answers?limit=20&offset=0` |
| 回答详情 | `GET /api/v4/answers/{id}` |
| 文章详情 | `GET /api/v4/articles/{id}` |
| 作者文章 | `GET /api/v4/members/{id}/articles?limit=20&offset=0` |

## 优势总结

| 特性 | 传统爬虫 | 本设计 |
|------|---------|--------|
| 爬取模式 | 广度优先，机械扫描 | 随机深度优先，模拟用户 |
| 反爬风险 | 高（模式明显） | 低（行为随机） |
| 断点续爬 | 需要复杂状态管理 | 天然支持 |
| 数据组织 | 通常是大文件 | 按内容分散存储 |
| 增量更新 | 困难 | 简单（检查文件是否存在） |
| 可读性 | 差 | 好（直接浏览文件系统） |

## 使用示例

```bash
# 首次启动，从话题开始
node crawler.js --seed "https://www.zhihu.com/topic/27814732"

# 断点续爬
node crawler.js --resume

# 添加新种子
node crawler.js --add-seed "https://www.zhihu.com/question/12345678"

# 查看状态
node crawler.js --status
```
