import type { Redis } from "ioredis";

export type OAuthProvider = "google" | "slack";

export class OAuthStateStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds = 600,
  ) {}

  private key(provider: OAuthProvider, state: string): string {
    return `oauth:${provider}:${state}`;
  }

  async save(provider: OAuthProvider, state: string, data: object): Promise<void> {
    await this.redis.set(this.key(provider, state), JSON.stringify(data), "EX", this.ttlSeconds);
  }

  async consume<T>(provider: OAuthProvider, state: string): Promise<T | null> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(state)) {
      return null;
    }
    const raw = await this.redis.getdel(this.key(provider, state));
    return raw ? (JSON.parse(raw) as T) : null;
  }
}
