import { timingSafeEqual } from 'node:crypto';

/** Constant-time string compare for secrets (same-length keys only). */
export function secureStringEqual(provided: string, expected: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
