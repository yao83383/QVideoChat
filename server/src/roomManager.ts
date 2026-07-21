import { randomUUID } from "node:crypto";

export interface RoomUser {
  userId: string;
  username: string;
  socketId: string;
}

export interface Room {
  roomId: string;
  users: [RoomUser, RoomUser];
  createdAt: number;
  joinedUserIds: string[];
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  create(userA: RoomUser, userB: RoomUser): string {
    const roomId = randomUUID().slice(0, 8);
    const room: Room = {
      roomId,
      users: [userA, userB],
      createdAt: Date.now(),
      joinedUserIds: [],
    };
    this.rooms.set(roomId, room);
    return roomId;
  }

  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  getBySocket(socketId: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.users.some((u) => u.socketId === socketId)) {
        return room;
      }
    }
    return undefined;
  }

  /** Find the room this userId is currently in (by userId, not socketId —
   *  survives socket rebinds during grace-period reconnects). Used by
   *  presence's busy-state gate to mark "in-call" and stop frame fanout. */
  getByUserId(userId: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.users.some((u) => u.userId === userId)) {
        return room;
      }
    }
    return undefined;
  }

  updateSocket(roomId: string, userId: string, socketId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    const user = room.users.find((u) => u.userId === userId);
    if (!user) return false;
    user.socketId = socketId;
    if (!room.joinedUserIds.includes(userId)) {
      room.joinedUserIds.push(userId);
    }
    return room.joinedUserIds.length >= 2;
  }

  isClaimed(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    return room ? room.joinedUserIds.length >= 2 : false;
  }

  remove(roomId: string): void {
    this.rooms.delete(roomId);
  }

  cleanupStale(maxAgeMs = 30000): void {
    const now = Date.now();
    for (const [id, room] of this.rooms.entries()) {
      if (room.joinedUserIds.length === 0 && now - room.createdAt > maxAgeMs) {
        this.rooms.delete(id);
        console.log(`[cleanup] stale unjoined room ${id}`);
      }
    }
  }
}
