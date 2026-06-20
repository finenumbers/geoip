import { readFileSync, existsSync } from 'node:fs';
import { resolveConfigPaths } from './config-store.js';
import { loadBootstrapEnv } from './bootstrap-env.js';
import { resetRuntimeConfigCache } from './runtime-config.js';

/** Poll config meta; on change invalidate runtime cache and notify subscribers. */
export function watchConfigFileChanges(intervalMs = 5000): () => void {
  const bootstrap = loadBootstrapEnv();
  const paths = resolveConfigPaths(bootstrap.CONFIG_DATA_DIR);
  let lastSeen = readConfigMarker(paths.metaPath);

  const timer = setInterval(() => {
    const current = readConfigMarker(paths.metaPath);
    if (current !== lastSeen) {
      lastSeen = current;
      resetRuntimeConfigCache();
    }
  }, intervalMs);

  return () => clearInterval(timer);
}

function readConfigMarker(metaPath: string): string {
  if (!existsSync(metaPath)) return '';
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { updatedAt?: string | null };
    return meta.updatedAt ?? '';
  } catch {
    return '';
  }
}
