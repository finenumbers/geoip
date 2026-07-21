import { isIPv4, isIPv6 } from 'node:net';

export type RirResourceType = 'ipv4' | 'ipv6' | 'asn';
export type RirStatus = 'available' | 'allocated' | 'assigned' | 'reserved';

export type ParsedRirRecord = {
  registry: string;
  cc: string | null;
  resourceType: RirResourceType;
  startIp: string | null;
  endIp: string | null;
  network: string | null;
  prefixLen: number | null;
  hostCount: string | null;
  startAsn: number | null;
  asnCount: number | null;
  allocatedAt: string | null;
  status: RirStatus;
  opaqueId: string | null;
  rangeText: string;
  ipFamily: number | null;
  sourceFile: string;
  snapshotDate: string;
};

export type DelegatedFileParseResult = {
  snapshotDate: string;
  records: ParsedRirRecord[];
  skippedLines: number;
};

const STATUSES = new Set<string>(['available', 'allocated', 'assigned', 'reserved']);
const RESOURCE_TYPES = new Set<string>(['ipv4', 'ipv6', 'asn']);

function parseAllocatedAt(raw: string): string | null {
  if (!raw || raw === '00000000' || raw === '0000/00/00') return null;
  if (!/^\d{8}$/.test(raw)) return null;
  const y = raw.slice(0, 4);
  const m = raw.slice(4, 6);
  const d = raw.slice(6, 8);
  return `${y}-${m}-${d}`;
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error(`Invalid IPv4: ${ip}`);
  }
  return (((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!) >>> 0;
}

function intToIpv4(n: number): string {
  const v = n >>> 0;
  return `${(v >>> 24) & 255}.${(v >>> 16) & 255}.${(v >>> 8) & 255}.${v & 255}`;
}

/** True when [start, start+count) is exactly one CIDR block. */
export function ipv4RangeToCidr(startIp: string, hostCount: number): string | null {
  if (!Number.isInteger(hostCount) || hostCount <= 0) return null;
  if ((hostCount & (hostCount - 1)) !== 0) return null;
  const start = ipv4ToInt(startIp);
  const prefixLen = 32 - Math.log2(hostCount);
  if (!Number.isInteger(prefixLen) || prefixLen < 0 || prefixLen > 32) return null;
  const mask = prefixLen === 0 ? 0 : (0xffffffff << (32 - prefixLen)) >>> 0;
  if ((start & mask) !== start) return null;
  return `${startIp}/${prefixLen}`;
}

function expandIpv6Network(start: string, prefixLen: number): { network: string; startIp: string; endIp: string } {
  if (!Number.isInteger(prefixLen) || prefixLen < 0 || prefixLen > 128) {
    throw new Error(`Invalid IPv6 prefix length: ${prefixLen}`);
  }
  const network = `${start}/${prefixLen}`;
  // PostgreSQL will normalize; for range_text we keep canonical CIDR.
  return { network, startIp: start, endIp: start };
}

export function parseDelegatedRecordLine(
  line: string,
  sourceFile: string,
  snapshotDate: string,
): ParsedRirRecord | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const parts = trimmed.split('|');
  if (parts.length < 7) return null;

  const registry = (parts[0] ?? '').trim().toLowerCase();
  const ccRaw = (parts[1] ?? '').trim();
  const type = (parts[2] ?? '').trim().toLowerCase();
  const start = (parts[3] ?? '').trim();
  const valueRaw = (parts[4] ?? '').trim();
  const dateRaw = (parts[5] ?? '').trim();
  const status = (parts[6] ?? '').trim().toLowerCase();
  const opaqueId = (parts[7] ?? '').trim() || null;

  if (parts[parts.length - 1] === 'summary') return null;
  if (type === '*' || registry === 'version' || !RESOURCE_TYPES.has(type)) return null;
  if (!STATUSES.has(status)) return null;
  if (!registry || !start || !valueRaw) return null;

  const value = Number(valueRaw);
  if (!Number.isFinite(value) || value < 0) return null;

  const allocatedAt = parseAllocatedAt(dateRaw);
  const cc = ccRaw && ccRaw !== '*' ? ccRaw.toUpperCase() : null;
  const resourceType = type as RirResourceType;
  const statusTyped = status as RirStatus;

  if (resourceType === 'asn') {
    const startAsn = Number(start);
    const asnCount = Math.trunc(value);
    if (!Number.isInteger(startAsn) || startAsn < 0 || asnCount < 1) return null;
    const endAsn = startAsn + asnCount - 1;
    const rangeText = asnCount === 1 ? `AS${startAsn}` : `AS${startAsn}-AS${endAsn}`;
    return {
      registry,
      cc,
      resourceType,
      startIp: null,
      endIp: null,
      network: null,
      prefixLen: null,
      hostCount: null,
      startAsn,
      asnCount,
      allocatedAt,
      status: statusTyped,
      opaqueId,
      rangeText,
      ipFamily: null,
      sourceFile,
      snapshotDate,
    };
  }

  if (resourceType === 'ipv4') {
    if (!isIPv4(start)) return null;
    const hostCount = Math.trunc(value);
    if (hostCount < 1) return null;
    const startInt = ipv4ToInt(start);
    const endIp = intToIpv4(startInt + hostCount - 1);
    const network = ipv4RangeToCidr(start, hostCount);
    const prefixLen = network ? Number(network.split('/')[1]) : null;
    const rangeText = network ?? `${start}-${endIp}`;
    return {
      registry,
      cc,
      resourceType,
      startIp: start,
      endIp,
      network,
      prefixLen,
      hostCount: String(hostCount),
      startAsn: null,
      asnCount: null,
      allocatedAt,
      status: statusTyped,
      opaqueId,
      rangeText,
      ipFamily: 4,
      sourceFile,
      snapshotDate,
    };
  }

  // ipv6: value is prefix length
  if (!isIPv6(start)) return null;
  const prefixLen = Math.trunc(value);
  const { network, startIp } = expandIpv6Network(start, prefixLen);
  return {
    registry,
    cc,
    resourceType,
    startIp,
    endIp: startIp,
    network,
    prefixLen,
    hostCount: null,
    startAsn: null,
    asnCount: null,
    allocatedAt,
    status: statusTyped,
    opaqueId,
    rangeText: network,
    ipFamily: 6,
    sourceFile,
    snapshotDate,
  };
}

export function parseDelegatedFileContent(
  content: string,
  sourceFile: string,
): DelegatedFileParseResult {
  const lines = content.split(/\r?\n/);
  let snapshotDate = new Date().toISOString().slice(0, 10);
  let skippedLines = 0;
  const records: ParsedRirRecord[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = trimmed.split('|');
    // version|registry|serial|records|startdate|enddate|UTCoffset
    if (parts.length >= 6 && /^\d+(\.\d+)?$/.test(parts[0] ?? '') && parts[5] && /^\d{8}$/.test(parts[5])) {
      const parsed = parseAllocatedAt(parts[5]);
      if (parsed) snapshotDate = parsed;
      continue;
    }

    if (parts[parts.length - 1] === 'summary') continue;

    const rec = parseDelegatedRecordLine(trimmed, sourceFile, snapshotDate);
    if (!rec) {
      // version/summary already skipped; count other non-records
      if (parts.length >= 7 && RESOURCE_TYPES.has((parts[2] ?? '').toLowerCase())) {
        skippedLines += 1;
      }
      continue;
    }
    // Fix snapshot_date on records if header came after (unlikely) — use header date
    records.push({ ...rec, snapshotDate });
  }

  // Re-stamp snapshot date after full header parse
  for (const rec of records) {
    rec.snapshotDate = snapshotDate;
  }

  return { snapshotDate, records, skippedLines };
}
