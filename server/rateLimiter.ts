import type http from "node:http";

export type RateLimitConfig = {
  windowMs: number;
  maxRequests: number;
  maxBuckets?: number;
  now?: () => number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

type WindowBucket = {
  windowStart: number;
  count: number;
  prevCount: number;
  lastAccessAt: number;
};

const DEFAULT_MAX_BUCKETS = 10000;

// Ermittelt einen flüchtigen Client-Schlüssel aus Proxy-Headern oder der Socket-Adresse (ohne Persistenz)
export function extractClientKey(req: http.IncomingMessage, trustProxy = true): string {
  if (trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    const firstForwarded = typeof forwarded === "string"
      ? forwarded.split(",")[0]?.trim()
      : Array.isArray(forwarded) && typeof forwarded[0] === "string"
        ? forwarded[0].split(",")[0]?.trim()
        : undefined;
    if (firstForwarded && firstForwarded.length > 0) {
      return firstForwarded;
    }
  }

  const remote = req.socket?.remoteAddress?.trim();
  return remote && remote.length > 0 ? remote : "unknown";
}

// Abhängigkeitsfreier In-Memory-Sliding-Window-Rate-Limiter mit harter Bucket-Obergrenze
class RateLimiter {
  readonly #windowMs: number;
  readonly #maxRequests: number;
  readonly #maxBuckets: number;
  readonly #now: () => number;
  readonly #buckets = new Map<string, WindowBucket>();

  constructor(config: RateLimitConfig) {
    this.#windowMs = Math.max(1000, Math.floor(config.windowMs));
    this.#maxRequests = Math.floor(config.maxRequests);
    this.#maxBuckets = Math.max(16, Math.floor(config.maxBuckets ?? DEFAULT_MAX_BUCKETS));
    this.#now = config.now ?? (() => Date.now());
  }

  get bucketCount(): number {
    this.#cleanupExpired(this.#now());
    return this.#buckets.size;
  }

  consume(key: string, cost = 1): RateLimitResult {
    if (this.#maxRequests <= 0) {
      return { allowed: true, remaining: 0, retryAfterSeconds: 0 };
    }

    const now = this.#now();
    this.#cleanupExpired(now);

    const normalizedCost = Math.max(0, cost);
    let bucket = this.#buckets.get(key);
    const currentWindowStart = Math.floor(now / this.#windowMs) * this.#windowMs;

    if (!bucket) {
      if (this.#buckets.size >= this.#maxBuckets) {
        this.#evictOldestBucket();
      }
      bucket = {
        windowStart: currentWindowStart,
        count: 0,
        prevCount: 0,
        lastAccessAt: now,
      };
      this.#buckets.set(key, bucket);
    } else {
      this.#advanceBucket(bucket, currentWindowStart);
      bucket.lastAccessAt = now;
    }

    const effective = this.#computeEffectiveCount(bucket, now);
    if (effective + normalizedCost > this.#maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: this.#computeRetryAfterSeconds(bucket, now),
      };
    }

    bucket.count += normalizedCost;
    const remaining = Math.max(0, Math.floor(this.#maxRequests - (effective + normalizedCost)));
    return {
      allowed: true,
      remaining,
      retryAfterSeconds: 0,
    };
  }

  peek(key: string): RateLimitResult {
    if (this.#maxRequests <= 0) {
      return { allowed: true, remaining: 0, retryAfterSeconds: 0 };
    }

    const now = this.#now();
    this.#cleanupExpired(now);

    const bucket = this.#buckets.get(key);
    if (!bucket) {
      return {
        allowed: true,
        remaining: this.#maxRequests,
        retryAfterSeconds: 0,
      };
    }

    const currentWindowStart = Math.floor(now / this.#windowMs) * this.#windowMs;
    this.#advanceBucket(bucket, currentWindowStart);
    const effective = this.#computeEffectiveCount(bucket, now);

    if (effective >= this.#maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: this.#computeRetryAfterSeconds(bucket, now),
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, Math.floor(this.#maxRequests - effective)),
      retryAfterSeconds: 0,
    };
  }

  reset(key?: string): void {
    if (typeof key === "string") {
      this.#buckets.delete(key);
      return;
    }
    this.#buckets.clear();
  }

  #advanceBucket(bucket: WindowBucket, currentWindowStart: number): void {
    const elapsedWindows = Math.floor((currentWindowStart - bucket.windowStart) / this.#windowMs);
    if (elapsedWindows === 1) {
      bucket.prevCount = bucket.count;
      bucket.count = 0;
      bucket.windowStart = currentWindowStart;
    } else if (elapsedWindows >= 2) {
      bucket.prevCount = 0;
      bucket.count = 0;
      bucket.windowStart = currentWindowStart;
    }
  }

  #computeEffectiveCount(bucket: WindowBucket, now: number): number {
    const elapsedInWindow = Math.max(0, now - bucket.windowStart);
    const prevWeight = Math.max(0, (this.#windowMs - elapsedInWindow) / this.#windowMs);
    return bucket.prevCount * prevWeight + bucket.count;
  }

  #computeRetryAfterSeconds(bucket: WindowBucket, now: number): number {
    const msLeftInWindow = Math.max(1, bucket.windowStart + this.#windowMs - now);
    if (bucket.count >= this.#maxRequests || bucket.prevCount <= 0) {
      return Math.max(1, Math.ceil(msLeftInWindow / 1000));
    }
    const maxWeight = Math.max(0, (this.#maxRequests - bucket.count) / bucket.prevCount);
    const targetElapsed = this.#windowMs * (1 - maxWeight);
    const elapsedInWindow = Math.max(0, now - bucket.windowStart);
    const waitMs = Math.max(1, Math.min(msLeftInWindow, targetElapsed - elapsedInWindow));
    return Math.max(1, Math.ceil(waitMs / 1000));
  }

  #cleanupExpired(now: number): void {
    const expiryThreshold = this.#windowMs * 2;
    for (const [key, bucket] of this.#buckets.entries()) {
      if (now - bucket.windowStart >= expiryThreshold) {
        this.#buckets.delete(key);
      }
    }
  }

  #evictOldestBucket(): void {
    let oldestKey: string | null = null;
    let oldestAccess = Infinity;
    for (const [key, bucket] of this.#buckets.entries()) {
      if (bucket.lastAccessAt < oldestAccess) {
        oldestAccess = bucket.lastAccessAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) {
      this.#buckets.delete(oldestKey);
    }
  }
}

export default RateLimiter;
