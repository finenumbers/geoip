import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function ImportsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['imports', 'all'],
    queryFn: () => api.imports(100),
  });

  if (isLoading) return <p>Загрузка...</p>;
  if (error) return <p className="text-red-400">Ошибка загрузки</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">История импортов</h2>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-card">
            <tr className="text-left border-b border-border">
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Dataset Date</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Triggered By</th>
              <th className="px-4 py-3">City Blocks</th>
              <th className="px-4 py-3">Started</th>
              <th className="px-4 py-3">Finished</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((item) => {
              const run = item as {
                id: string;
                datasetDate: string | null;
                status: string;
                triggeredBy: string;
                startedAt: string | null;
                finishedAt: string | null;
                counts: { cityBlocks: number; countryBlocks: number; asnBlocks: number };
              };
              return (
                <tr key={run.id} className="border-b border-border hover:bg-accent/30">
                  <td className="px-4 py-2 font-mono text-xs">{run.id}</td>
                  <td className="px-4 py-2">{run.datasetDate ?? '—'}</td>
                  <td className="px-4 py-2">{run.status}</td>
                  <td className="px-4 py-2">{run.triggeredBy}</td>
                  <td className="px-4 py-2">{run.counts?.cityBlocks ?? 0}</td>
                  <td className="px-4 py-2">
                    {run.startedAt ? new Date(run.startedAt).toLocaleString('ru') : '—'}
                  </td>
                  <td className="px-4 py-2">
                    {run.finishedAt ? new Date(run.finishedAt).toLocaleString('ru') : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
