import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

type LookupSection = 'city' | 'country' | 'asn';

export function LookupPage() {
  const [ip, setIp] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [include, setInclude] = useState<LookupSection[]>(['city', 'country', 'asn']);

  const includeKey = useMemo(() => include.slice().sort().join(','), [include]);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['lookup', submitted, includeKey],
    queryFn: ({ signal }) =>
      api.lookup(submitted, {
        include: include.length === 3 ? undefined : include,
        signal,
      }),
    enabled: submitted.length > 0,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(ip.trim());
  };

  const toggleSection = (section: LookupSection) => {
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

  return (
    <div className="space-y-6 max-w-3xl">
      <h2 className="text-2xl font-semibold">IP Lookup</h2>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex gap-3">
          <input
            type="text"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            placeholder="Введите IPv4 или IPv6"
            className="flex-1 px-4 py-2 bg-card border border-border rounded-md"
          />
          <button
            type="submit"
            className="px-6 py-2 bg-primary text-white rounded-md hover:opacity-90"
          >
            Проверить
          </button>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          {(['city', 'country', 'asn'] as const).map((section) => (
            <label key={section} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={include.includes(section)}
                onChange={() => toggleSection(section)}
              />
              {section.toUpperCase()}
            </label>
          ))}
        </div>
      </form>

      {(isLoading || isFetching) && <p>Загрузка...</p>}
      {error && <p className="text-red-400">Ошибка: {(error as Error).message}</p>}

      {result && (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Dataset: {result.meta.datasetDate ?? '—'} | IP: {result.ip}
          </p>

          {include.includes('city') && <ResultCard title="City" data={result.city} />}
          {include.includes('country') && <ResultCard title="Country" data={result.country} />}
          {include.includes('asn') && <ResultCard title="ASN" data={result.asn} />}
        </div>
      )}
    </div>
  );
}

function ResultCard({ title, data }: { title: string; data: Record<string, unknown> | null }) {
  if (!data) {
    return (
      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="font-medium mb-2">{title}</h3>
        <p className="text-muted text-sm">Не найдено</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="font-medium mb-3">{title}</h3>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        {Object.entries(data).map(([key, value]) => (
          <div key={key}>
            <dt className="text-muted">{key}</dt>
            <dd>{value === null ? '—' : String(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
