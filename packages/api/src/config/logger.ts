import pino from 'pino';
import { loadEnv } from '../config/env.js';

const env = loadEnv();

const redactOptions = {
  paths: [
    'req.headers.authorization',
    'req.headers["x-api-key"]',
    'GEOIP_LK_PASSWORD',
    '*.password',
    'password',
  ],
  censor: '[REDACTED]',
};

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: redactOptions,
});

export function createFastifyLoggerConfig(): pino.LoggerOptions | false {
  const { ACCESS_LOG_ENABLED, LOG_LEVEL } = loadEnv();
  if (!ACCESS_LOG_ENABLED) return false;
  return {
    level: LOG_LEVEL,
    redact: redactOptions,
  };
}

export function createChildLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
