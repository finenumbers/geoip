import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AdminSessionInfo } from '@geoip/shared';

const SESSION_COOKIE = 'geoip_admin_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export { SESSION_COOKIE, SESSION_TTL_MS };

type SessionPayload = {
  username: string;
  exp: number;
};

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSessionToken(username: string, sessionSecret: string): string {
  const payload: SessionPayload = {
    username,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = signPayload(encoded, sessionSecret);
  return `${encoded}.${signature}`;
}

export function parseSessionToken(
  token: string | undefined,
  sessionSecret: string,
): AdminSessionInfo | null {
  if (!token || !sessionSecret) return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;

  const expected = signPayload(encoded, sessionSecret);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
  } catch {
    return null;
  }

  if (!payload.username || payload.exp <= Date.now()) return null;

  return {
    username: payload.username,
    expiresAt: new Date(payload.exp).toISOString(),
  };
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure,
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  };
}
