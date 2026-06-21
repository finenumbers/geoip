import { useState, useMemo, useEffect } from 'react';
import { useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { LookupMapCard } from '@/components/LookupMapCard';
import {
  LOOKUP_UI_SECTIONS,
  resolveLookupApiInclude,
  type LookupUiSection,
} from '@/lib/lookup-sections';
import { ui } from '@/lib/ui-strings';
import { cn } from '@/lib/utils';

const LOOKUP_SECTION_LABELS: Record<LookupUiSection, string> = {
  city: ui.lookup.sectionCity,
  country: ui.lookup.sectionCountry,
  asn: ui.lookup.sectionAsn,
  map: ui.lookup.sectionMap,
};

export function LookupPage() {
  const { ip: queryIp } = useSearch({ from: '/lookup' });
  const [ip, setIp] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [include, setInclude] = useState<LookupUiSection[]>([...LOOKUP_UI_SECTIONS]);

  useEffect(() => {
    if (queryIp) {
      setIp(queryIp);
      setSubmitted(queryIp);
    }
  }, [queryIp]);

  const apiInclude = useMemo(() => resolveLookupApiInclude(include), [include]);
  const includeKey = useMemo(
    () => [...include].sort().join(',') + '|' + (apiInclude?.slice().sort().join(',') ?? 'all'),
    [include, apiInclude],
  );

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['lookup', submitted, includeKey],
    queryFn: ({ signal }) =>
      api.lookup(submitted, {
        include: apiInclude,
        signal,
      }),
    enabled: submitted.length > 0,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(ip.trim());
  };

  const toggleSection = (section: LookupUiSection) => {
    setInclude((prev) => {
      if (prev.includes(section)) {
        if (prev.length === 1) return prev;
        return prev.filter((s) => s !== section);
      }
      return [...prev, section];
    });
  };

  const result = data as {
    ip: string;
    city: Record<string, unknown> | null;
    country: Record<string, unknown> | null;
    asn: Record<string, unknown> | null;
    meta: { datasetDate: string | null };
  } | undefined;

  const showMap = include.includes('map');
  const dataSections = (['city', 'country', 'asn'] as const).filter((section) =>
    include.includes(section),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <form onSubmit={handleSubmit} className="shrink-0 space-y-3">
        <div className="flex gap-3">
          <input
            type="text"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            placeholder="Введите IPv4 или IPv6"
            className="flex-1 rounded-md border border-border bg-card px-4 py-2"
          />
          <button
            type="submit"
            className="rounded-md bg-primary px-6 py-2 text-white hover:opacity-90"
          >
            Проверить
          </button>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          {LOOKUP_UI_SECTIONS.map((section) => (
            <label key={section} className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={include.includes(section)}
                onChange={() => toggleSection(section)}
              />
              {LOOKUP_SECTION_LABELS[section]}
            </label>
          ))}
        </div>
      </form>

      {(isLoading || isFetching) && <p className="shrink-0">Загрузка...</p>}
      {error && <p className="shrink-0 text-red-600">Ошибка: {(error as Error).message}</p>}

      {result && (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <p className="shrink-0 text-sm text-muted">
            Dataset: {result.meta.datasetDate ?? '—'} | IP: {result.ip}
          </p>

          <div
            className={cn(
              'grid min-h-0 flex-1 gap-4',
              showMap && dataSections.length > 0
                ? 'grid-cols-1 xl:grid-cols-2'
                : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
            )}
          >
            {dataSections.map((section) => (
              <ResultCard
                key={section}
                title={LOOKUP_SECTION_LABELS[section]}
                data={result[section]}
                className={cn(showMap && dataSections.length > 0 && 'xl:col-span-1')}
              />
            ))}

            {showMap && (
              <LookupMapCard
                className={cn(
                  'min-h-[20rem]',
                  dataSections.length > 0 ? 'xl:col-span-2 xl:min-h-[24rem]' : 'md:col-span-2 xl:col-span-3',
                )}
                latitude={result.city?.latitude as number | null | undefined}
                longitude={result.city?.longitude as number | null | undefined}
                accuracyRadius={result.city?.accuracyRadius as number | null | undefined}
                cityName={result.city?.cityName as string | null | undefined}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ResultCard({
  title,
  data,
  className,
}: {
  title: string;
  data: Record<string, unknown> | null;
  className?: string;
}) {
  if (!data) {
    return (
      <div className={cn('rounded-lg border border-border bg-card p-4', className)}>
        <h3 className="mb-2 font-medium">{title}</h3>
        <p className="text-sm text-muted">Не найдено</p>
      </div>
    );
  }

  return (
    <div className={cn('rounded-lg border border-border bg-card p-4', className)}>
      <h3 className="mb-3 font-medium">{title}</h3>
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        {Object.entries(data).map(([key, value]) => (
          <div key={key}>
            <dt className="text-muted">{key}</dt>
            <dd className="break-words">{value === null ? '—' : String(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
