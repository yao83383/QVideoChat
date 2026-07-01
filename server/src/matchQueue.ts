export interface QueuedUser {
  userId: string;
  username: string;
  socketId: string;
}

export class MatchQueue {
  private queue: QueuedUser[] = [];

  join(user: QueuedUser): void {
    const existing = this.queue.find((u) => u.userId === user.userId);
    if (existing) return;
    this.queue.push(user);
  }

  cancel(userId: string): void {
    this.queue = this.queue.filter((u) => u.userId !== userId);
  }

  removeBySocket(socketId: string): void {
    this.queue = this.queue.filter((u) => u.socketId !== socketId);
  }

  tryPair(): [QueuedUser, QueuedUser] | null {
    if (this.queue.length < 2) return null;
    const a = this.queue.shift()!;
    const b = this.queue.shift()!;
    return [a, b];
  }
}
