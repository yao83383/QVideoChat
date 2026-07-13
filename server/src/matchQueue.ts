export interface QueuedUser {
  userId: string;
  username: string;
  socketId: string;
  tags: string[];
  deviceId: string;
  joinedAt: number;
  nativeLang?: string;
  targetLang?: string;
}

export class MatchQueue {
  private queue: QueuedUser[] = [];

  /**
   * Restore queue from persisted data (e.g. after server restart).
   * Socket IDs are cleared — users will re-join with new sockets.
   */
  restore(data: Omit<QueuedUser, "socketId" | "joinedAt">[]): void {
    const now = Date.now();
    for (const u of data) {
      // Skip if already in queue
      if (this.queue.some((q) => q.userId === u.userId)) continue;
      this.queue.push({ ...u, socketId: "", joinedAt: now });
    }
  }

  /** Get serializable queue state for persistence */
  snapshot(): Omit<QueuedUser, "socketId" | "joinedAt">[] {
    return this.queue.map((u) => ({
      userId: u.userId,
      username: u.username,
      tags: u.tags,
      deviceId: u.deviceId,
      nativeLang: u.nativeLang,
      targetLang: u.targetLang,
    }));
  }

  join(user: Omit<QueuedUser, "joinedAt">): void {
    const existing = this.queue.find((u) => u.userId === user.userId);
    if (existing) {
      // Same user rejoined via a fresh socket (page reload, home→room nav,
      // reconnect). Refresh the socketId so tryPair emits match:found to the
      // LIVE socket instead of the dead one — otherwise the client stays
      // stuck in "searching" forever. Keep joinedAt so wait-bonus scoring
      // still reflects the original queue time.
      existing.socketId = user.socketId;
      existing.username = user.username;
      existing.tags = user.tags;
      existing.deviceId = user.deviceId;
      existing.nativeLang = user.nativeLang;
      existing.targetLang = user.targetLang;
      return;
    }
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

        // Language bonus: prefer matching same target language
        let langBonus = 0;
        if (a.user.nativeLang && b.user.nativeLang && a.user.targetLang && b.user.targetLang) {
          if (a.user.nativeLang === b.user.targetLang || b.user.nativeLang === a.user.targetLang) {
            langBonus = 0.3;
          }
        }

        const score = tagScore + exactMatch + waitBonus + langBonus;
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
