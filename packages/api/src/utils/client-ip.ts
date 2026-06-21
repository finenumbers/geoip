import { isPublicIpAddress } from '@geoip/shared';
import type { FastifyRequest } from 'fastify';

function splitForwardedFor(header: string): string[] {
  return header
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function pickPublicIp(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (isPublicIpAddress(candidate)) return candidate;
  }
  return null;
}

/** Client IP from reverse proxy headers (X-Forwarded-For / X-Real-IP), preferring a public address. */
export function clientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const publicIp = pickPublicIp(splitForwardedFor(forwarded));
    if (publicIp) return publicIp;
    const first = splitForwardedFor(forwarded)[0];
    if (first) return first;
  }

  const realIp = request.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.length > 0) {
    const trimmed = realIp.trim();
    if (isPublicIpAddress(trimmed)) return trimmed;
    return trimmed;
  }

  const socketIp = request.ip;
  if (socketIp && isPublicIpAddress(socketIp)) return socketIp;
  return socketIp;
}

/** Public client IP for UI display; null when only private/local addresses are visible to the server. */
export function publicClientIp(request: FastifyRequest): string | null {
  const resolved = clientIp(request);
  return isPublicIpAddress(resolved) ? resolved : null;
}
