import { CookieJar } from 'tough-cookie';
import { fetch as undiciFetch, Agent, type RequestInit as UndiciRequestInit } from 'undici';
import { DEFAULT_GEOIP_LK_BASE_URL, ZIP_PATTERNS } from '@geoip/shared';

export type DownloadType = 'city' | 'country' | 'asn';

export interface DownloadLink {
  type: DownloadType;
  date: string;
  url: string;
  filename: string;
  sizeBytes: number;
}

interface FileEntry {
  filedate: string;
  filename: string;
  size: number;
}

interface FilesResponse {
  city?: { csv?: FileEntry };
  country?: { csv?: FileEntry };
  asn?: { csv?: FileEntry };
}

export class GrchcClient {
  private jar = new CookieJar();
  private readonly dispatcher = new Agent({
    keepAliveTimeout: 60_000,
    keepAliveMaxTimeout: 120_000,
    connections: 6,
  });

  constructor(
    private email: string,
    private password: string,
    private baseUrl: string = DEFAULT_GEOIP_LK_BASE_URL,
  ) {}

  private get lkBaseUrl(): string {
    return this.baseUrl.replace(/\/$/, '');
  }

  private async fetch(url: string, init: UndiciRequestInit = {}): Promise<Response> {
    const cookieHeader = await this.jar.getCookieString(url);
    const headers: Record<string, string> = {
      'User-Agent': 'GeoIP-Analytics-Importer/1.0',
      Accept: 'application/json',
    };
    if (init.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => {
          headers[k] = v;
        });
      } else if (Array.isArray(init.headers)) {
        for (const [k, v] of init.headers) headers[k] = v;
      } else {
        Object.assign(headers, init.headers);
      }
    }
    if (cookieHeader) headers['Cookie'] = cookieHeader;

    const response = await undiciFetch(url, {
      ...init,
      headers,
      redirect: 'manual',
      dispatcher: this.dispatcher,
    });

    const setCookie = response.headers.getSetCookie?.() ?? [];
    for (const cookie of setCookie) {
      await this.jar.setCookie(cookie, url);
    }

    return response as unknown as Response;
  }

  async login(): Promise<void> {
    const response = await this.fetch(`${this.lkBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: this.email, password: this.password }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Login failed with status ${response.status}: ${body}`);
    }

    const cookieHeader = await this.jar.getCookieString(this.lkBaseUrl);
    if (!cookieHeader.includes('session-id')) {
      throw new Error('Login failed: no session cookie received');
    }
  }

  private async fetchFilesManifest(): Promise<FilesResponse> {
    const response = await this.fetch(`${this.lkBaseUrl}/api/files`, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`Failed to fetch files manifest: ${response.status}`);
    }
    return (await response.json()) as FilesResponse;
  }

  async discoverDownloadLinks(): Promise<DownloadLink[]> {
    const manifest = await this.fetchFilesManifest();
    const links: DownloadLink[] = [];

    const entries: Array<{ type: DownloadLink['type']; entry?: FileEntry }> = [
      { type: 'city', entry: manifest.city?.csv },
      { type: 'country', entry: manifest.country?.csv },
      { type: 'asn', entry: manifest.asn?.csv },
    ];

    for (const { type, entry } of entries) {
      if (!entry?.filename) continue;
      const date = entry.filedate.replace(/-/g, '');
      links.push({
        type,
        date,
        url: `${this.lkBaseUrl}/api/files/${entry.filename}`,
        filename: entry.filename,
        sizeBytes: entry.size ?? 0,
      });
    }

    return links;
  }

  async getLatestDatasetDate(): Promise<string> {
    const links = await this.discoverDownloadLinks();
    const dates = links.map((l) => l.date).filter(Boolean);
    if (dates.length === 0) {
      throw new Error('No dataset download links found in LK');
    }
    return dates.sort().reverse()[0]!;
  }

  async getDownloadLinksForDate(date: string): Promise<Record<'city' | 'country' | 'asn', DownloadLink>> {
    const links = await this.discoverDownloadLinks();
    const filtered = links.filter((l) => l.date === date);

    const result: Partial<Record<'city' | 'country' | 'asn', DownloadLink>> = {};
    for (const link of filtered) {
      result[link.type] = link;
    }

    if (!result.city || !result.country || !result.asn) {
      throw new Error(`Missing ZIP files for date ${date}. Found: ${Object.keys(result).join(', ')}`);
    }

    return result as Record<'city' | 'country' | 'asn', DownloadLink>;
  }

  async downloadZip(url: string): Promise<ReadableStream<Uint8Array>> {
    const response = await this.fetch(url, { method: 'GET', headers: { Accept: '*/*' } });
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download ${url}: ${response.status}`);
    }
    return response.body as ReadableStream<Uint8Array>;
  }
}

// Keep patterns exported for validation elsewhere
export { ZIP_PATTERNS };
