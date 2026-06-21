const authAttempts = new Map<string, { count: number; resetAt: number }>();

const MAX_AUTH_ATTEMPTS = 5;
const AUTH_WINDOW_MS = 15 * 60 * 1000;

export function checkAdminAuthRateLimit(ip: string, now = Date.now()): boolean {
  const entry = authAttempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    authAttempts.set(ip, { count: 1, resetAt: now + AUTH_WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_AUTH_ATTEMPTS) return false;
  entry.count += 1;
  return true;
}

export function resetAdminAuthRateLimitForTests(): void {
  authAttempts.clear();
}
