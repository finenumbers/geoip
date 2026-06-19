import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetch as undiciFetch } from 'undici';
import { GrchcClient } from '../src/jobs/grchc-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../../.env') });

async function main(): Promise<void> {
  const email = process.env.GEOIP_LK_EMAIL ?? '';
  const password = process.env.GEOIP_LK_PASSWORD ?? '';
  const client = new GrchcClient(email, password);
  await client.login();
  const links = await client.discoverDownloadLinks();
  const city = links.find((l) => l.type === 'city');
  if (!city) throw new Error('no city link');

  const jar = (client as unknown as { jar: { getCookieString: (u: string) => Promise<string> } }).jar;
  const cookie = await jar.getCookieString(city.url);

  const head = await undiciFetch(city.url, {
    method: 'HEAD',
    headers: { Cookie: cookie, 'User-Agent': 'GeoIP-Analytics-Importer/1.0' },
  });
  console.log(JSON.stringify({
    filename: city.filename,
    headStatus: head.status,
    acceptRanges: head.headers.get('accept-ranges'),
    contentLength: head.headers.get('content-length'),
  }));

  const range = await undiciFetch(city.url, {
    method: 'GET',
    headers: {
      Cookie: cookie,
      Range: 'bytes=0-1023',
      'User-Agent': 'GeoIP-Analytics-Importer/1.0',
    },
  });
  console.log(JSON.stringify({
    rangeStatus: range.status,
    contentRange: range.headers.get('content-range'),
    bytes: (await range.arrayBuffer()).byteLength,
  }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
