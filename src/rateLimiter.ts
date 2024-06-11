interface RateLimiter {
  [key: string]: number[];
}

const rateLimiter: RateLimiter = {};
const MAX_REQUESTS = 5;
const PERIOD = 60 * 1000; // 1 minute in milliseconds

export function isAllowed(userId: number): {
  allowed: boolean;
  waitTime: number;
} {
  const now = Date.now();
  if (!rateLimiter[userId]) {
    rateLimiter[userId] = [now];
    return { allowed: true, waitTime: 0 };
  }
  rateLimiter[userId] = rateLimiter[userId].filter(
    (timestamp) => now - timestamp < PERIOD
  );
  if (rateLimiter[userId].length < MAX_REQUESTS) {
    rateLimiter[userId].push(now);
    return { allowed: true, waitTime: 0 };
  }
  const nextAllowedTime = rateLimiter[userId][0] + PERIOD - now;
  return { allowed: false, waitTime: nextAllowedTime };
}
