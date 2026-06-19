import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GrchcClient } from '../jobs/grchc-client.js';
import { loadEnv } from '../config/env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../../../.env') });

async function main() {
  const env = loadEnv();
  if (!env.GEOIP_LK_EMAIL || !env.GEOIP_LK_PASSWORD) {
    console.error('Missing GEOIP_LK_EMAIL / GEOIP_LK_PASSWORD');
    process.exit(1);
  }

  const client = new GrchcClient(env.GEOIP_LK_EMAIL, env.GEOIP_LK_PASSWORD);
  console.log('Logging in...');
  await client.login();
  console.log('Login OK');

  const links = await client.discoverDownloadLinks();
  console.log(`Found ${links.length} download links:`);
  for (const l of links) {
    console.log(`  [${l.type}] ${l.date} -> ${l.filename}`);
  }

  const date = await client.getLatestDatasetDate();
  console.log(`Latest date: ${date}`);
}

main().catch((err) => {
  console.error('Probe failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
