#!/usr/bin/env python3
"""
从已爬取的 topic feed 数据初始化文件结构

用法:
    python init_data.py <result.json路径>
    python init_data.py output/topic_27814732_2026-01-14T15-38-05/result.json
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

# 数据目录
DATA_DIR = Path(__file__).parent / 'data'


def ensure_dirs():
    """创建目录结构"""
    dirs = [
        DATA_DIR / 'questions',
        DATA_DIR / 'articles',
        DATA_DIR / 'authors',
        DATA_DIR / 'topics',
        DATA_DIR / '.state',
    ]
    for d in dirs:
        d.mkdir(parents=True, exist_ok=True)


def save_json(filepath, data):
    """保存 JSON 文件"""
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def append_jsonl(filepath, item):
    """追加到 JSONL 文件"""
    with open(filepath, 'a', encoding='utf-8') as f:
        f.write(json.dumps(item, ensure_ascii=False) + '\n')


def extract_topic_id(source_file):
    """从文件路径提取话题 ID"""
    # topic_27814732_2026-01-14T15-38-05/result.json
    dirname = Path(source_file).parent.name
    if dirname.startswith('topic_'):
        parts = dirname.split('_')
        if len(parts) >= 2:
            return parts[1]
    return None


def process_author(author_data):
    """处理并保存作者信息"""
    if not author_data or not author_data.get('id'):
        return None

    author_id = author_data['id']
    author_file = DATA_DIR / 'authors' / f'{author_id}.json'

    # 如果已存在，不覆盖
    if author_file.exists():
        return author_id

    author_doc = {
        'id': author_id,
        'name': author_data.get('name', ''),
        'headline': author_data.get('headline', ''),
        'avatarUrl': author_data.get('avatarUrl', ''),
        'url': author_data.get('url', ''),
        'crawledAt': datetime.now().isoformat(),
    }
    save_json(author_file, author_doc)
    return author_id


def process_answer(item, visited, queue_items, topic_id):
    """处理回答类型"""
    item_id = item.get('id')
    question = item.get('question', {})
    question_id = question.get('id') if question else None

    if not question_id:
        return False

    # 创建问题目录
    q_dir = DATA_DIR / 'questions' / question_id
    (q_dir / 'answers').mkdir(parents=True, exist_ok=True)

    # 保存问题元数据
    q_meta_file = q_dir / 'meta.json'
    if not q_meta_file.exists():
        q_meta = {
            'id': question_id,
            'title': question.get('title', ''),
            'url': question.get('url', ''),
            'crawledAt': datetime.now().isoformat(),
            'source': f'topic_feed:{topic_id}',
            'needsFetch': True,  # 标记需要获取完整信息
        }
        save_json(q_meta_file, q_meta)

        # 添加到队列
        queue_items.append({
            'type': 'question',
            'id': question_id,
            'priority': 2,
            'source': f'topic_feed:{topic_id}',
        })

    # 保存回答
    answer_file = q_dir / 'answers' / f'{item_id}.json'
    if not answer_file.exists():
        answer_doc = {
            'id': item_id,
            'questionId': question_id,
            'content': item.get('content', ''),
            'excerpt': item.get('excerpt', ''),
            'title': item.get('title', ''),
            'voteupCount': item.get('voteupCount', 0),
            'commentCount': item.get('commentCount', 0),
            'createdTime': item.get('createdTime'),
            'updatedTime': item.get('updatedTime'),
            'author': item.get('author', {}),
            'url': item.get('url', ''),
            'crawledAt': datetime.now().isoformat(),
        }
        save_json(answer_file, answer_doc)
        visited.add(f'answer:{item_id}')
        return True

    return False


def process_article(item, visited, topic_id):
    """处理文章类型"""
    item_id = item.get('id')
    article_file = DATA_DIR / 'articles' / f'{item_id}.json'

    if article_file.exists():
        return False

    article_doc = {
        'id': item_id,
        'title': item.get('title', ''),
        'content': item.get('content', ''),
        'excerpt': item.get('excerpt', ''),
        'voteupCount': item.get('voteupCount', 0),
        'commentCount': item.get('commentCount', 0),
        'createdTime': item.get('createdTime'),
        'updatedTime': item.get('updatedTime'),
        'author': item.get('author', {}),
        'url': item.get('url', ''),
        'imageUrl': item.get('imageUrl', ''),
        'crawledAt': datetime.now().isoformat(),
        'source': f'topic_feed:{topic_id}',
    }
    save_json(article_file, article_doc)
    visited.add(f'article:{item_id}')
    return True


def init_from_result(result_file):
    """从 result.json 初始化数据结构"""

    # 读取数据
    with open(result_file, 'r', encoding='utf-8') as f:
        data = json.load(f)

    items = data.get('items', [])
    if not items:
        print("没有数据可处理")
        return

    print(f"读取到 {len(items)} 条数据")

    # 提取话题 ID
    topic_id = extract_topic_id(result_file) or 'unknown'
    print(f"话题 ID: {topic_id}")

    # 确保目录存在
    ensure_dirs()

    # 加载已有状态
    visited_file = DATA_DIR / '.state' / 'visited.json'
    if visited_file.exists():
        with open(visited_file, 'r') as f:
            visited = set(json.load(f))
        print(f"加载已有 visited: {len(visited)} 项")
    else:
        visited = set()

    queue_items = []
    stats = {
        'questions': set(),
        'answers': 0,
        'articles': 0,
        'authors': set(),
    }

    # 处理每条数据
    for item in items:
        item_type = item.get('type')

        # 处理作者
        author_id = process_author(item.get('author'))
        if author_id:
            stats['authors'].add(author_id)

        if item_type == 'answer':
            question = item.get('question', {})
            if question and question.get('id'):
                stats['questions'].add(question['id'])
            if process_answer(item, visited, queue_items, topic_id):
                stats['answers'] += 1

        elif item_type == 'article':
            if process_article(item, visited, topic_id):
                stats['articles'] += 1

    # 保存话题信息
    topic_file = DATA_DIR / 'topics' / f'{topic_id}.json'
    if not topic_file.exists():
        topic_doc = {
            'id': topic_id,
            'url': f'https://www.zhihu.com/topic/{topic_id}',
            'crawledAt': datetime.now().isoformat(),
            'feedsCrawled': len(items),
        }
        save_json(topic_file, topic_doc)

    # 保存队列
    queue_file = DATA_DIR / '.state' / 'queue.jsonl'
    for item in queue_items:
        append_jsonl(queue_file, item)

    # 保存 visited
    save_json(visited_file, list(visited))

    # 更新统计
    stats_file = DATA_DIR / '.state' / 'stats.json'
    if stats_file.exists():
        with open(stats_file, 'r') as f:
            existing_stats = json.load(f)
    else:
        existing_stats = {
            'totalQuestions': 0,
            'totalAnswers': 0,
            'totalArticles': 0,
            'totalAuthors': 0,
            'sources': [],
        }

    # 重新统计（基于文件系统）
    questions_dir = DATA_DIR / 'questions'
    articles_dir = DATA_DIR / 'articles'
    authors_dir = DATA_DIR / 'authors'

    total_questions = len(list(questions_dir.glob('*'))) if questions_dir.exists() else 0
    total_articles = len(list(articles_dir.glob('*.json'))) if articles_dir.exists() else 0
    total_authors = len(list(authors_dir.glob('*.json'))) if authors_dir.exists() else 0
    total_answers = sum(
        len(list((questions_dir / q / 'answers').glob('*.json')))
        for q in questions_dir.iterdir()
        if (questions_dir / q / 'answers').exists()
    ) if questions_dir.exists() else 0

    source_name = f'topic_feed:{topic_id}'
    sources = existing_stats.get('sources', [])
    if source_name not in sources:
        sources.append(source_name)

    final_stats = {
        'totalQuestions': total_questions,
        'totalAnswers': total_answers,
        'totalArticles': total_articles,
        'totalAuthors': total_authors,
        'lastUpdated': datetime.now().isoformat(),
        'sources': sources,
    }
    save_json(stats_file, final_stats)

    # 打印结果
    print("\n" + "=" * 50)
    print("初始化完成!")
    print("=" * 50)
    print(f"本次新增:")
    print(f"  问题: {len(stats['questions'])}")
    print(f"  回答: {stats['answers']}")
    print(f"  文章: {stats['articles']}")
    print(f"  作者: {len(stats['authors'])}")
    print(f"\n总计:")
    print(f"  问题: {final_stats['totalQuestions']}")
    print(f"  回答: {final_stats['totalAnswers']}")
    print(f"  文章: {final_stats['totalArticles']}")
    print(f"  作者: {final_stats['totalAuthors']}")
    print(f"\n待爬队列新增: {len(queue_items)} 项")
    print(f"已访问总计: {len(visited)} 项")


def show_status():
    """显示当前状态"""
    stats_file = DATA_DIR / '.state' / 'stats.json'
    queue_file = DATA_DIR / '.state' / 'queue.jsonl'
    visited_file = DATA_DIR / '.state' / 'visited.json'

    print("=" * 50)
    print("当前状态")
    print("=" * 50)

    if stats_file.exists():
        with open(stats_file, 'r') as f:
            stats = json.load(f)
        print(f"问题: {stats.get('totalQuestions', 0)}")
        print(f"回答: {stats.get('totalAnswers', 0)}")
        print(f"文章: {stats.get('totalArticles', 0)}")
        print(f"作者: {stats.get('totalAuthors', 0)}")
        print(f"来源: {', '.join(stats.get('sources', []))}")
        print(f"更新时间: {stats.get('lastUpdated', 'N/A')}")
    else:
        print("未初始化")

    if queue_file.exists():
        with open(queue_file, 'r') as f:
            queue_count = sum(1 for _ in f)
        print(f"\n待爬队列: {queue_count} 项")

    if visited_file.exists():
        with open(visited_file, 'r') as f:
            visited = json.load(f)
        print(f"已访问: {len(visited)} 项")


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        print("\n查看状态: python init_data.py --status")
        sys.exit(1)

    if sys.argv[1] == '--status':
        show_status()
    else:
        result_file = sys.argv[1]
        if not os.path.exists(result_file):
            print(f"文件不存在: {result_file}")
            sys.exit(1)
        init_from_result(result_file)
