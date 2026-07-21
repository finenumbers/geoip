import { query } from '../db/client.js';

/** Minimal delegated rows for integration browse/filter checks. Idempotent. */
export async function seedRirFixtureDataset(): Promise<void> {
  const ready = await query<{ ready: boolean }>(
    `SELECT (status = 'ready' AND row_count > 0) AS ready FROM rir_dataset_state WHERE id = 1`,
  );
  if (ready.rows[0]?.ready) return;

  await query('TRUNCATE rir_delegations RESTART IDENTITY');
  await query(`
    INSERT INTO rir_delegations (
      registry, cc, resource_type, start_ip, end_ip, network, prefix_len, host_count,
      start_asn, asn_count, allocated_at, status, opaque_id, range_text, ip_family,
      source_file, snapshot_date
    ) VALUES
      ('iana', 'ZZ', 'asn', NULL, NULL, NULL, NULL, NULL, 64512, 1, NULL, 'reserved', NULL, 'AS64512', NULL,
       'delegated-iana-latest', '2026-07-20'),
      ('apnic', 'AU', 'ipv4', '1.0.0.0', '1.0.0.255', '1.0.0.0/24', 24, 256, NULL, NULL, '2011-04-12',
       'allocated', 'A91A7381', '1.0.0.0/24', 4, 'delegated-apnic-extended-latest', '2026-07-20'),
      ('arin', 'US', 'ipv4', '10.0.0.0', '10.0.0.2', NULL, NULL, 3, NULL, NULL, '1993-01-01',
       'assigned', 'ABC', '10.0.0.0-10.0.0.2', 4, 'delegated-arin-extended-latest', '2026-07-20')
  `);

  await query(
    `UPDATE rir_dataset_state
     SET status = 'ready',
         last_success_at = NOW(),
         last_snapshot_date = '2026-07-20',
         row_count = 3,
         rows_by_registry = '{"iana":1,"apnic":1,"arin":1}'::jsonb,
         rows_by_status = '{"reserved":1,"allocated":1,"assigned":1}'::jsonb,
         snapshots_by_registry = '{"iana":"2026-07-20","apnic":"2026-07-20","arin":"2026-07-20"}'::jsonb,
         last_error = NULL,
         active_import_run_id = NULL,
         updated_at = NOW()
     WHERE id = 1`,
  );
}
