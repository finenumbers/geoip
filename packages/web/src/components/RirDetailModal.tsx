import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TableBrowseRow } from '@geoip/shared';
import { api } from '@/lib/api';
import { ui } from '@/lib/ui-strings';
import { Modal } from '@/components/Modal';

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 border-b border-border/60 py-1.5 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="break-all font-medium">{value ?? '—'}</dd>
    </div>
  );
}

export function RirDetailModal({
  row,
  onClose,
}: {
  row: TableBrowseRow | null;
  onClose: () => void;
}) {
  const enrichQuery = useQuery({
    queryKey: ['rir-enrich', row?.id, row?.rangeText, row?.startAsn],
    queryFn: () =>
      api.rirEnrich({
        registry: row!.registry!,
        resourceType: row!.resourceType!,
        rangeText: row!.rangeText!,
        network: row!.network ?? null,
        startAsn: row!.startAsn ?? null,
        opaqueId: row!.opaqueId ?? null,
      }),
    enabled: Boolean(row),
    staleTime: 60_000,
  });

  if (!row) return null;

  const rdap = enrichQuery.data?.rdap;
  const peeringdb = enrichQuery.data?.peeringdb;

  return (
    <Modal open={Boolean(row)} title={ui.rirDetail.title} onClose={onClose}>
      <section className="mb-4">
        <h3 className="mb-2 font-medium">{ui.rirDetail.delegated}</h3>
        <dl>
          <Field label={ui.filters.range_text} value={row.rangeText} />
          <Field label={ui.filters.resource_type} value={row.resourceType} />
          <Field label={ui.filters.network} value={row.network} />
          <Field label={ui.filters.prefix_len} value={row.prefixLen} />
          <Field label={ui.filters.ip_family} value={row.ipFamily} />
          <Field label={ui.filters.host_count} value={row.hostCount} />
          <Field label={ui.filters.start_asn} value={row.startAsn} />
          <Field label={ui.filters.asn_count} value={row.asnCount} />
          <Field label={ui.filters.cc} value={row.cc} />
          <Field label={ui.filters.status} value={row.status} />
          <Field label={ui.filters.allocated_at} value={row.allocatedAt} />
          <Field label={ui.filters.opaque_id} value={row.opaqueId} />
          <Field label={ui.filters.registry} value={row.registry} />
        </dl>
      </section>

      <section className="mb-4">
        <h3 className="mb-2 font-medium">{ui.rirDetail.rdap}</h3>
        {enrichQuery.isLoading && <p className="text-muted">{ui.rirDetail.loading}</p>}
        {enrichQuery.isError && (
          <p className="text-red-700">{(enrichQuery.error as Error).message}</p>
        )}
        {rdap?.errorMessage && <p className="text-amber-800">{rdap.errorMessage}</p>}
        {rdap && !rdap.errorMessage && (
          <dl>
            <Field label="Handle" value={String(rdap.payload.handle ?? '—')} />
            <Field label="Name" value={String(rdap.payload.name ?? '—')} />
            <Field
              label="Status"
              value={
                Array.isArray(rdap.payload.status)
                  ? rdap.payload.status.join(', ')
                  : String(rdap.payload.status ?? '—')
              }
            />
            <Field label="Country" value={String(rdap.payload.country ?? '—')} />
            <Field
              label="Entities"
              value={
                Array.isArray(rdap.payload.entities)
                  ? rdap.payload.entities.join(', ')
                  : '—'
              }
            />
          </dl>
        )}
      </section>

      {row.resourceType === 'asn' && (
        <section>
          <h3 className="mb-2 font-medium">{ui.rirDetail.peeringdb}</h3>
          {enrichQuery.isLoading && <p className="text-muted">{ui.rirDetail.loading}</p>}
          {peeringdb?.errorMessage && <p className="text-amber-800">{peeringdb.errorMessage}</p>}
          {peeringdb && !peeringdb.errorMessage && (
            <dl>
              <Field label="Name" value={String(peeringdb.payload.name ?? '—')} />
              <Field label="AKA" value={String(peeringdb.payload.aka ?? '—')} />
              <Field label="Website" value={String(peeringdb.payload.website ?? '—')} />
              <Field label="Traffic" value={String(peeringdb.payload.info_traffic ?? '—')} />
              <Field label="Scope" value={String(peeringdb.payload.info_scope ?? '—')} />
              <Field label="Type" value={String(peeringdb.payload.info_type ?? '—')} />
            </dl>
          )}
          {!enrichQuery.isLoading && !peeringdb && (
            <p className="text-muted">{ui.rirDetail.peeringdbMissing}</p>
          )}
        </section>
      )}
    </Modal>
  );
}
