import { isPublicIpAddress } from '@geoip/shared';

const LOOKUP_TIMEOUT_MS = 5000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

type ServerIpLookup = () => Promise<string | null>;

const SERVER_IP_LOOKUPS: ServerIpLookup[] = [
  async () => {
    const res = await fetchWithTimeout('https://api64.ipify.org?format=json');
    if (!res.ok) return null;
    const data = (await res.json()) as { ip?: string };
    return data.ip && isPublicIpAddress(data.ip) ? data.ip : null;
  },
  async () => {
    const res = await fetchWithTimeout('https://ifconfig.me/ip', {
      headers: { Accept: 'text/plain' },
    });
    if (!res.ok) return null;
    const ip = (await res.text()).trim();
    return isPublicIpAddress(ip) ? ip : null;
  },
  async () => {
    const res = await fetchWithTimeout('https://www.cloudflare.com/cdn-cgi/trace');
    if (!res.ok) return null;
    const text = await res.text();
    const line = text.split('\n').find((row) => row.startsWith('ip='));
    const ip = line?.slice(3).trim();
    return ip && isPublicIpAddress(ip) ? ip : null;
  },
];

/** Public egress IP as seen from this server (same network as local Docker host). */
export async function lookupServerPublicIp(): Promise<string | null> {
  for (const lookup of SERVER_IP_LOOKUPS) {
    try {
      const ip = await lookup();
      if (ip) return ip;
    } catch {
      /* try next provider */
    }
  }
  return null;
}
