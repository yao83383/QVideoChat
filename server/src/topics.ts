/**
 * Server-side topic generator — mirrors client/lib/ai/topics.ts.
 * Generates ice-breaker topics based on shared interest tags.
 */

const TAG_TOPICS: Record<string, string[]> = {
  '游戏搭子': ['最近在玩什么游戏？', '你喜欢单机还是联机游戏？', '有没有一款游戏让你印象特别深刻？'],
  '深夜唠嗑': ['今天过得怎么样？', '最近有没有什么开心的事？', '睡不着的时候一般会做什么？'],
  '音乐分享': ['最近在循环哪首歌？', '你最喜欢什么类型的音乐？', '有没有去过演唱会？'],
  '二次元': ['最近在追什么番？', '你最喜欢的动漫角色是谁？', '有没有特别推荐的冷门神作？'],
  '学习搭子': ['你最近在学什么？', '学英语有什么好方法推荐吗？', '你是自学还是报班？'],
  '英语练习': ['你想练习口语还是听力？', '学英语最大的困难是什么？', '有出国的计划吗？'],
  '运动健身': ['你一般做什么运动？', '有没有推荐的健身教程？', '最近有没有运动目标？'],
  '美食探店': ['你最喜欢吃什么菜系？', '有没有私藏的宝藏餐厅？', '自己做饭吗？拿手菜是什么？'],
  '旅游探索': ['最想去哪个地方旅行？', '去过最喜欢的地方是哪里？', '喜欢自由行还是跟团？'],
  '影剧综艺': ['最近有什么好看的剧推荐？', '你喜欢什么类型的电影？', '有没有反复看很多遍的经典？'],
  '宠物日常': ['你养了什么宠物？', '你家主子有什么有趣的癖好？', '猫派还是狗派？'],
  '科技数码': ['最近关注什么科技新闻？', '你用什么设备打游戏？', '对 AI 怎么看？'],
};

const GENERAL_TOPICS = [
  '你好！很高兴认识你 :)',
  '今天过得怎么样？',
  '你是哪里人？',
  '平时有什么兴趣爱好？',
  '最近有没有什么有趣的事？',
];

export function generateTopic(userATags: string[], userBTags: string[]): { text: string; category: string } {
  const sharedTags = userATags.filter((t) => userBTags.includes(t));

  if (sharedTags.length === 0) {
    return {
      text: GENERAL_TOPICS[Math.floor(Math.random() * GENERAL_TOPICS.length)],
      category: 'general',
    };
  }

  // Pick a random shared tag and a random topic for it
  const tag = sharedTags[Math.floor(Math.random() * sharedTags.length)];
  const topics = TAG_TOPICS[tag];
  if (topics && topics.length > 0) {
    return {
      text: topics[Math.floor(Math.random() * topics.length)],
      category: 'general',
    };
  }

  return {
    text: GENERAL_TOPICS[Math.floor(Math.random() * GENERAL_TOPICS.length)],
    category: 'general',
  };
}
