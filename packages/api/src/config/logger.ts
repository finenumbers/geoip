import pino from 'pino';
import { loadEnv } from '../config/env.js';

const env = loadEnv();

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      'GEOIP_LK_PASSWORD',
      '*.password',
      'password',
    ],
    censor: '[REDACTED]',
  },
});

export function createChildLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
