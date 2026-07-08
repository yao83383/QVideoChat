/**
 * AI Opening Topics — rule-based template engine.
 * Generates ice-breaker topics based on matching interest tags.
 * LLM-based generation is deferred to a future version.
 */

type TagCategory = 'general' | 'game' | 'music' | 'travel' | 'food' | 'study' | 'tech' | 'movie' | 'fitness' | 'talk' | 'anime' | 'pet';

interface TopicTemplate {
  tags: string[];
  topics: string[];
  category: TagCategory;
}

const TOPIC_TEMPLATES: TopicTemplate[] = [
  {
    tags: ['游戏搭子'],
    topics: [
      '最近在玩什么游戏？',
      '你喜欢单机还是联机游戏？',
      '有没有一款游戏让你印象特别深刻？',
      '周末一起开黑吗？',
    ],
    category: 'game',
  },
  {
    tags: ['深夜唠嗑'],
    topics: [
      '今天过得怎么样？',
      '最近有没有什么开心的事？',
      '睡不着的时候一般会做什么？',
      '你觉得自己是夜猫子还是早起鸟？',
    ],
    category: 'talk',
  },
  {
    tags: ['音乐分享'],
    topics: [
      '最近在循环哪首歌？',
      '你最喜欢什么类型的音乐？',
      '有没有去过演唱会？',
      '如果只能带一张专辑去荒岛，你会选哪张？',
    ],
    category: 'music',
  },
  {
    tags: ['二次元'],
    topics: [
      '最近在追什么番？',
      '你最喜欢的动漫角色是谁？',
      '有没有特别推荐的冷门神作？',
      '你会去漫展吗？',
    ],
    category: 'anime',
  },
  {
    tags: ['学习搭子'],
    topics: [
      '你最近在学什么？',
      '学英语有什么好方法推荐吗？',
      '你是自学还是报班？',
      '有什么学习习惯可以分享一下？',
    ],
    category: 'study',
  },
  {
    tags: ['英语练习'],
    topics: [
      '你想练习口语还是听力？',
      '学英语最大的困难是什么？',
      '有出国的计划吗？',
      '最喜欢的英文电影是什么？',
    ],
    category: 'study',
  },
  {
    tags: ['运动健身'],
    topics: [
      '你一般做什么运动？',
      '有没有推荐的健身教程？',
      '运动时喜欢听什么？',
      '最近有没有运动目标？',
    ],
    category: 'fitness',
  },
  {
    tags: ['美食探店'],
    topics: [
      '你最喜欢吃什么菜系？',
      '有没有私藏的宝藏餐厅？',
      '自己做饭吗？拿手菜是什么？',
      '最想尝试哪国料理？',
    ],
    category: 'food',
  },
  {
    tags: ['旅游探索'],
    topics: [
      '最想去哪个地方旅行？',
      '去过最喜欢的地方是哪里？',
      '喜欢自由行还是跟团？',
      '如果给你一张免费机票，你会飞去哪？',
    ],
    category: 'travel',
  },
  {
    tags: ['影剧综艺'],
    topics: [
      '最近有什么好看的剧推荐？',
      '你喜欢什么类型的电影？',
      '有没有反复看很多遍的经典？',
      '最近追的综艺是什么？',
    ],
    category: 'movie',
  },
  {
    tags: ['宠物日常'],
    topics: [
      '你养了什么宠物？',
      '你家主子有什么有趣的癖好？',
      '猫派还是狗派？',
      '最喜欢的动物是什么？',
    ],
    category: 'pet',
  },
  {
    tags: ['科技数码'],
    topics: [
      '最近关注什么科技新闻？',
      '你用什么设备打游戏？',
      '对 AI 怎么看？',
      '有没有特别想买的数码产品？',
    ],
    category: 'tech',
  },
];

const GENERAL_TOPICS: string[] = [
  '你好！很高兴认识你 :)',
  '今天过得怎么样？',
  '你是哪里人？',
  '平时有什么兴趣爱好？',
  '最近有没有什么有趣的事？',
];

export interface GeneratedTopic {
  text: string;
  category: TagCategory;
  matchedTags: string[];
}

/**
 * Generate an opening topic based on shared tags.
 * Returns 1-2 topics with the best tag match.
 */
export function generateTopics(userTags: string[], partnerTags: string[]): GeneratedTopic[] {
  const sharedTags = userTags.filter((t) => partnerTags.includes(t));

  if (sharedTags.length === 0) {
    // No shared tags — use a random general topic
    const idx = Math.floor(Math.random() * GENERAL_TOPICS.length);
    return [{
      text: GENERAL_TOPICS[idx],
      category: 'general',
      matchedTags: [],
    }];
  }

  // Find matching templates for shared tags
  const matched: GeneratedTopic[] = [];
  const usedTags = new Set<string>();

  for (const template of TOPIC_TEMPLATES) {
    const overlap = sharedTags.filter((t) => template.tags.includes(t));
    if (overlap.length === 0) continue;

    // Pick a random topic from this template
    const topicIdx = Math.floor(Math.random() * template.topics.length);
    matched.push({
      text: template.topics[topicIdx],
      category: template.category,
      matchedTags: overlap,
    });
    overlap.forEach((t) => usedTags.add(t));

    if (matched.length >= 2) break;
  }

  if (matched.length === 0) {
    // Tags exist but no templates matched — general topic
    const idx = Math.floor(Math.random() * GENERAL_TOPICS.length);
    return [{
      text: GENERAL_TOPICS[idx],
      category: 'general',
      matchedTags: [],
    }];
  }

  return matched;
}

/**
 * Get a single random topic (used for server-side push via Socket.IO)
 */
export function generateSingleTopic(userTags: string[], partnerTags: string[]): string {
  const topics = generateTopics(userTags, partnerTags);
  return topics[0]?.text || GENERAL_TOPICS[0];
}
