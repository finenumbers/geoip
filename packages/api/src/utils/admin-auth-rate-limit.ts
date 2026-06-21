const authAttempts = new Map<string, { count: number; resetAt: number }>();

const MAX_AUTH_ATTEMPTS = 5;
const AUTH_WINDOW_MS = 15 * 60 * 1000;

export function isAdminAuthRateLimited(ip: string, now = Date.now()): boolean {
  const entry = authAttempts.get(ip);
  if (!entry || entry.resetAt <= now) return false;
  return entry.count >= MAX_AUTH_ATTEMPTS;
}

export function recordAdminAuthFailure(ip: string, now = Date.now()): void {
  const entry = authAttempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    authAttempts.set(ip, { count: 1, resetAt: now + AUTH_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

/** @deprecated use isAdminAuthRateLimited + recordAdminAuthFailure */
export function checkAdminAuthRateLimit(ip: string, now = Date.now()): boolean {
  if (isAdminAuthRateLimited(ip, now)) return false;
  recordAdminAuthFailure(ip, now);
  return true;
}

export function resetAdminAuthRateLimitForTests(): void {
  authAttempts.clear();
}
