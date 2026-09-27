import type { CookieOptions, Response } from "express";
import type { Redis } from "ioredis";
import { hmacSha256Hex, randomToken } from "../../utils/crypto.js";

export const SESSION_COOKIE = "outbox_sid";
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

interface SessionRecord {
  userId: string;
  createdAt: string;
}

export interface SessionOptions {
  secret: string;
  ttlSeconds: number;
  secureCookie: boolean;
}

export interface ResolvedSession {
  sessionId: string;
  userId: string;
}

export class SessionService {
  constructor(
    private readonly redis: Redis,
    private readonly options: SessionOptions,
  ) {}

  private key(sessionId: string): string {
    return `sess:${hmacSha256Hex(this.options.secret, sessionId)}`;
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.options.secureCookie,
      sameSite: "lax",
      path: "/",
      maxAge: this.options.ttlSeconds * 1000,
    };
  }

  async create(res: Response, userId: string): Promise<string> {
    const sessionId = randomToken(32);
    const record: SessionRecord = { userId, createdAt: new Date().toISOString() };
    await this.redis.set(this.key(sessionId), JSON.stringify(record), "EX", this.options.ttlSeconds);
    res.cookie(SESSION_COOKIE, sessionId, this.cookieOptions());
    return sessionId;
  }

  async resolve(sessionId: unknown): Promise<ResolvedSession | null> {
    if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) {
      return null;
    }
    const raw = await this.redis.get(this.key(sessionId));
    if (!raw) {
      return null;
    }
    const record = JSON.parse(raw) as Partial<SessionRecord>;
    return typeof record.userId === "string" ? { sessionId, userId: record.userId } : null;
  }

  async destroy(res: Response, sessionId: string | undefined): Promise<void> {
    if (sessionId) {
      await this.redis.del(this.key(sessionId));
    }
    const { maxAge: _maxAge, ...options } = this.cookieOptions();
    res.clearCookie(SESSION_COOKIE, options);
  }
}
