import { isIP } from 'node:net';
import { lookupRequestSchema } from '@geoip/shared';
import type { LookupResponse } from '@geoip/shared';
import { query } from '../db/client.js';
import { getDatasetState } from '../repositories/dataset-repository.js';
import { resolveLookupSections, type LookupSection } from './lookup-sections.js';

interface BlockRow {
  network: string;
  geoname_id: number | null;
  continent_name: string | null;
  country_iso_code: string | null;
  country_name: string | null;
  subdivision_1_name: string | null;
  subdivision_2_name: string | null;
  city_name: string | null;
  timezone: string | null;
  postal_code: string | null;
  latitude: string | null;
  longitude: string | null;
  accuracy_radius: number | null;
}

interface CountryRow {
  network: string;
  geoname_id: number | null;
  continent_name: string | null;
  country_iso_code: string | null;
  country_name: string | null;
  subdivision_1_name: string | null;
  subdivision_2_name: string | null;
}

interface AsnRow {
  network: string;
  autonomous_system_number: number;
  autonomous_system_organization: string | null;
}

export function validateIp(ip: string): string | null {
  const trimmed = ip.trim();
  if (isIP(trimmed) === 0) return null;
  return trimmed;
}

export async function lookupIp(
  rawIp: string,
  options?: { include?: LookupSection[] },
): Promise<LookupResponse | { error: string }> {
  const parsed = lookupRequestSchema.safeParse({ ip: rawIp, include: options?.include });
  if (!parsed.success) {
    return { error: 'Invalid request' };
  }

  const ip = validateIp(parsed.data.ip);
  if (!ip) {
    return { error: 'Invalid IP address' };
  }

  const sections = resolveLookupSections(parsed.data.include);

  const cityPromise = sections.has('city')
    ? query<BlockRow>(
        `SELECT cb.network::text, cb.geoname_id, cl.continent_name, cl.country_iso_code,
                cl.country_name, cl.subdivision_1_name, cl.subdivision_2_name,
                cl.city_name, cl.timezone, cb.postal_code, cb.latitude::text, cb.longitude::text,
                cb.accuracy_radius
         FROM geo_city_blocks cb
         LEFT JOIN geo_city_locations cl ON cl.geoname_id = cb.geoname_id
         WHERE cb.network >>= $1::inet
         ORDER BY masklen(cb.network) DESC
         LIMIT 1`,
        [ip],
      )
    : null;

  const countryPromise = sections.has('country')
    ? query<CountryRow>(
        `SELECT cb.network::text, cb.geoname_id, cl.continent_name, cl.country_iso_code,
                cl.country_name, cl.subdivision_1_name, cl.subdivision_2_name
         FROM geo_country_blocks cb
         LEFT JOIN geo_country_locations cl ON cl.geoname_id = cb.geoname_id
         WHERE cb.network >>= $1::inet
         ORDER BY masklen(cb.network) DESC
         LIMIT 1`,
        [ip],
      )
    : null;

  const asnPromise = sections.has('asn')
    ? query<AsnRow>(
        `SELECT network::text, autonomous_system_number, autonomous_system_organization
         FROM geo_asn_blocks
         WHERE network >>= $1::inet
         ORDER BY masklen(network) DESC
         LIMIT 1`,
        [ip],
      )
    : null;

  const [cityResult, countryResult, asnResult, state] = await Promise.all([
    cityPromise ?? Promise.resolve({ rows: [] as BlockRow[] }),
    countryPromise ?? Promise.resolve({ rows: [] as CountryRow[] }),
    asnPromise ?? Promise.resolve({ rows: [] as AsnRow[] }),
    getDatasetState(),
  ]);

  const city = cityResult.rows[0];
  const country = countryResult.rows[0];
  const asn = asnResult.rows[0];

  return {
    ip,
    city: city
      ? {
          network: city.network,
          geonameId: city.geoname_id,
          continentName: city.continent_name,
          countryIsoCode: city.country_iso_code,
          countryName: city.country_name,
          subdivision1Name: city.subdivision_1_name,
          subdivision2Name: city.subdivision_2_name,
          cityName: city.city_name,
          timezone: city.timezone,
          postalCode: city.postal_code,
          latitude: city.latitude ? parseFloat(city.latitude) : null,
          longitude: city.longitude ? parseFloat(city.longitude) : null,
          accuracyRadius: city.accuracy_radius,
        }
      : null,
    country: country
      ? {
          network: country.network,
          geonameId: country.geoname_id,
          continentName: country.continent_name,
          countryIsoCode: country.country_iso_code,
          countryName: country.country_name,
          subdivision1Name: country.subdivision_1_name,
          subdivision2Name: country.subdivision_2_name,
        }
      : null,
    asn: asn
      ? {
          network: asn.network,
          asn: asn.autonomous_system_number,
          organization: asn.autonomous_system_organization,
        }
      : null,
    meta: {
      datasetDate: state.datasetDate,
      queriedAt: new Date().toISOString(),
    },
  };
}
