import { describe, expect, it } from 'vitest';
import { buildRdapIpPath, formatRdapHttpError } from './rir-enrichment-service.js';

describe('buildRdapIpPath', () => {
  it('keeps CIDR slash unencoded for IPv4', () => {
    expect(buildRdapIpPath('1.0.1.0/24')).toBe('/ip/1.0.1.0/24');
  });

  it('keeps CIDR slash and IPv6 colons unencoded', () => {
    expect(buildRdapIpPath('800::/5')).toBe('/ip/800::/5');
  });

  it('uses start of start-end range', () => {
    expect(buildRdapIpPath('1.178.208.0 - 1.178.223.255')).toBe('/ip/1.178.208.0');
  });

  it('does not produce %2F', () => {
    expect(buildRdapIpPath('1.178.0.0/23')).not.toContain('%2F');
  });
});

describe('formatRdapHttpError', () => {
  it('maps 501 and 404 to Russian hints', () => {
    expect(formatRdapHttpError(501, 'iana')).toContain('IANA');
    expect(formatRdapHttpError(404, 'afrinic')).toContain('нет объекта');
  });

  it('keeps other statuses as HTTP code', () => {
    expect(formatRdapHttpError(503, 'apnic')).toBe('HTTP 503');
  });
});
