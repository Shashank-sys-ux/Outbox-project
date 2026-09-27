import type { Redis } from "ioredis";

export const RESERVE_SEND_SLOT_LUA = `
local lastSlot = tonumber(redis.call('GET', KEYS[1]) or '0')
local now = tonumber(ARGV[1])
local gap = tonumber(ARGV[2])
local senderLimit = tonumber(ARGV[3])
local campaignLimit = tonumber(ARGV[4])
local windowMs = tonumber(ARGV[5])
local marginMs = tonumber(ARGV[6])
local member = ARGV[7]
local span = windowMs + marginMs

local slot = math.max(now, lastSlot + gap)

if slot > now + windowMs then
  return {0, slot - windowMs, 3, now}
end

local function blockingSlot(key, limit)
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now - span)
  redis.call('ZREM', key, member)
  local lower = '(' .. (slot - span)
  local count = redis.call('ZCOUNT', key, lower, '+inf')
  if count < limit then
    return nil
  end
  local entry = redis.call('ZRANGEBYSCORE', key, lower, '+inf', 'WITHSCORES', 'LIMIT', count - limit, 1)
  return tonumber(entry[2])
end

local senderBlock = blockingSlot(KEYS[2], senderLimit)
local campaignBlock = blockingSlot(KEYS[3], campaignLimit)

if senderBlock or campaignBlock then
  local freedBy = math.max(senderBlock or 0, campaignBlock or 0)
  local reason = 2
  if senderBlock then
    reason = 1
  end
  return {0, freedBy + span, reason, freedBy}
end

local ttl = slot - now + span + 1000
redis.call('ZADD', KEYS[2], slot, member)
redis.call('PEXPIRE', KEYS[2], ttl)
redis.call('ZADD', KEYS[3], slot, member)
redis.call('PEXPIRE', KEYS[3], ttl)
redis.call('SET', KEYS[1], slot, 'PX', math.max(1000, slot - now + gap + 1000))

return {1, slot, 0, slot}
`;

export type LimitReason = "sender_limit" | "campaign_limit" | "backlog";

export type SlotDecision =
  | { allowed: true; slot: number }
  | { allowed: false; reason: LimitReason; retryAt: number; windowStart: number };

export interface ReserveRequest {
  emailId: string;
  senderId: string;
  campaignId: string;
  gapMs: number;
  senderLimit: number;
  campaignLimit: number;
  marginMs: number;
  now: number;
}

const REASONS: Record<number, LimitReason> = { 1: "sender_limit", 2: "campaign_limit", 3: "backlog" };

interface ReserveCommand {
  outboxReserveSendSlot(...args: Array<string | number>): Promise<[number, number, number, number]>;
}

export class SendSlotLimiter {
  constructor(
    private readonly redis: Redis,
    readonly windowMs: number,
  ) {
    redis.defineCommand("outboxReserveSendSlot", { numberOfKeys: 3, lua: RESERVE_SEND_SLOT_LUA });
  }

  static senderTag(senderId: string): string {
    return `rl:{s:${senderId}}`;
  }

  keysFor(senderId: string, campaignId: string): string[] {
    const tag = SendSlotLimiter.senderTag(senderId);
    return [`${tag}:last_slot`, `${tag}:slots`, `${tag}:campaign:${campaignId}:slots`];
  }

  async reserve(request: ReserveRequest): Promise<SlotDecision> {
    const [allowed, value, reasonCode, windowStart] = await (
      this.redis as unknown as ReserveCommand
    ).outboxReserveSendSlot(
      ...this.keysFor(request.senderId, request.campaignId),
      request.now,
      Math.max(0, request.gapMs),
      request.senderLimit,
      request.campaignLimit,
      this.windowMs,
      Math.max(0, request.marginMs),
      request.emailId,
    );
    if (allowed === 1) {
      return { allowed: true, slot: value };
    }
    return { allowed: false, reason: REASONS[reasonCode] ?? "backlog", retryAt: value, windowStart };
  }

  async claimAlert(senderId: string, scope: "sender" | "campaign", scopeId: string): Promise<boolean> {
    const key = `${SendSlotLimiter.senderTag(senderId)}:alerted:${scope}:${scopeId}`;
    const result = await this.redis.set(key, "1", "PX", this.windowMs, "NX");
    return result === "OK";
  }
}
