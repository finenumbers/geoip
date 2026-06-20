import { writeFileSync } from 'node:fs';
import { logger } from '../config/logger.js';
import { closeDb } from '../db/client.js';

const HEARTBEAT_PATH = '/tmp/geoip-worker-heartbeat';

let shutdownRequested = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

export function isWorkerShutdownRequested(): boolean {
  return shutdownRequested;
}

export function touchWorkerHeartbeat(): void {
  try {
    writeFileSync(HEARTBEAT_PATH, String(Date.now()), 'utf-8');
  } catch {
    // best-effort for docker healthcheck
  }
}

export function registerWorkerShutdown(onShutdown?: () => Promise<void>): void {
  const handle = async (signal: string) => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    logger.info({ signal }, 'Worker shutting down');
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    try {
      await onShutdown?.();
      await closeDb();
    } catch (err) {
      logger.error({ err }, 'Worker shutdown error');
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void handle('SIGTERM'));
  process.on('SIGINT', () => void handle('SIGINT'));
}

export function startWorkerPoll(
  poll: () => Promise<void>,
  intervalMs: number,
): (nextIntervalMs: number) => void {
  const run = async () => {
    if (shutdownRequested) return;
    touchWorkerHeartbeat();
    await poll();
  };

  void run();
  pollTimer = setInterval(() => {
    void run();
  }, intervalMs);

  return (nextIntervalMs: number) => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      void run();
    }, nextIntervalMs);
  };
}
