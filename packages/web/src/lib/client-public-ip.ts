import { isPublicIpAddress } from '@geoip/shared';
import { api } from '@/lib/api';

/** Resolves the user's public (external) IP for display in the UI. */
export async function fetchClientPublicIp(): Promise<string | null> {
  try {
    const { ip } = await api.clientIp();
    if (ip && isPublicIpAddress(ip)) return ip;
  } catch {
    /* fall through */
  }

  try {
    const { ip } = await api.externalIp();
    if (ip && isPublicIpAddress(ip)) return ip;
  } catch {
    return null;
  }

  return null;
}
