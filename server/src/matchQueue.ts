export interface QueuedUser {
  userId: string;
  username: string;
  socketId: string;
  tags: string[];
  deviceId: string;
  joinedAt: number;
}

export class MatchQueue {
  private queue: QueuedUser[] = [];

  join(user: Omit<QueuedUser, "joinedAt">): void {
    const existing = this.queue.find((u) => u.userId === user.userId);
    if (existing) return;
    this.queue.push({ ...user, joinedAt: Date.now() });
  }

  cancel(userId: string): void {
    this.queue = this.queue.filter((u) => u.userId !== userId);
  }

  removeBySocket(socketId: string): void {
    this.queue = this.queue.filter((u) => u.socketId !== socketId);
  }

  tryPair(): [QueuedUser, QueuedUser] | null {
    if (this.queue.length < 2) return null;

    const scored = this.queue.map((u) => ({
      user: u,
      waitTime: Date.now() - u.joinedAt,
    }));

    let bestPair: [QueuedUser, QueuedUser] | null = null;
    let bestScore = -1;

    for (let i = 0; i < scored.length; i++) {
      for (let j = i + 1; j < scored.length; j++) {
        const a = scored[i];
        const b = scored[j];

        // Never pair same device
        if (a.user.deviceId && b.user.deviceId && a.user.deviceId === b.user.deviceId) continue;

        const tagOverlap = a.user.tags.filter((t) => b.user.tags.includes(t)).length;
        const maxTags = Math.max(a.user.tags.length, b.user.tags.length, 1);
        const tagScore = maxTags > 0 ? tagOverlap / maxTags : 0;

        const exactMatch = tagOverlap > 0 ? 0.5 : 0;
        const waitBonus = Math.min((Math.min(a.waitTime, b.waitTime) / 10000), 1) * 0.3;

        const score = tagScore + exactMatch + waitBonus;
        if (score > bestScore) {
          bestScore = score;
          bestPair = [a.user, b.user];
        }
      }
    }

    if (!bestPair) return null;

    this.queue = this.queue.filter(
      (u) => u.userId !== bestPair![0].userId && u.userId !== bestPair![1].userId,
    );

    return bestPair;
  }
}
