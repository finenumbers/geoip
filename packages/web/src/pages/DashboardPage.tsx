import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function DashboardPage() {
  const { data: ready } = useQuery({ queryKey: ['ready'], queryFn: api.ready });
  const { data: dataset } = useQuery({ queryKey: ['dataset'], queryFn: api.dataset });
  const { data: metrics } = useQuery({ queryKey: ['metrics'], queryFn: api.metrics });
  const { data: imports } = useQuery({ queryKey: ['imports'], queryFn: () => api.imports(5) });

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Dashboard</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Статус системы">
          <p
            className={
              ready?.status === 'ready'
                ? 'text-green-400'
                : ready?.status === 'degraded'
                  ? 'text-yellow-400'
                  : 'text-red-400'
            }
          >
            {ready?.status === 'ready'
              ? 'Готово'
              : ready?.status === 'degraded'
                ? 'Деградировано'
                : 'Не готово'}
          </p>
          {ready?.checks && (
            <ul className="mt-2 text-sm text-muted space-y-1">
              <li>DB: {ready.checks.database ? '✓' : '✗'}</li>
              <li>Dataset: {ready.checks.dataset ? '✓' : '✗'}</li>
              <li>MV: {ready.checks.materializedViews ? '✓' : '✗'}</li>
              {'productionIndexes' in ready.checks && (
                <li>Indexes: {ready.checks.productionIndexes ? '✓' : '✗'}</li>
              )}
              {'asnMapping' in ready.checks && (
                <li>ASN mapping: {ready.checks.asnMapping ? '✓' : '✗'}</li>
              )}
              {'importRunning' in ready.checks && ready.checks.importRunning && (
                <li className="text-yellow-400">Импорт выполняется</li>
              )}
            </ul>
          )}
        </Card>

        <Card title="Активный датасет">
          <p className="text-lg">{dataset?.datasetDate ?? '—'}</p>
          <p className="text-sm text-muted mt-1">
            Активирован: {dataset?.activatedAt ? new Date(dataset.activatedAt).toLocaleString('ru') : '—'}
          </p>
        </Card>

        <Card title="Метрики">
          {metrics && typeof metrics === 'object' && metrics !== null && 'import' in metrics ? (
            <div className="text-sm space-y-1">
              <p>
                Импортов:{' '}
                {(metrics as { import: { totalRuns: number } }).import.totalRuns}
              </p>
              <p>
                Lookup p95:{' '}
                {(metrics as { latency?: { lookupP95Ms: number } }).latency?.lookupP95Ms ?? 0}ms
              </p>
            </div>
          ) : (
            <p className="text-muted">—</p>
          )}
        </Card>
      </div>

      <Card title="Последние импорты">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted border-b border-border">
              <th className="py-2">ID</th>
              <th>Дата</th>
              <th>Статус</th>
              <th>Начало</th>
            </tr>
          </thead>
          <tbody>
            {(imports?.items ?? []).map((item) => {
              const run = item as {
                id: string;
                datasetDate: string | null;
                status: string;
                startedAt: string | null;
              };
              return (
                <tr key={run.id} className="border-b border-border">
                  <td className="py-2 font-mono text-xs">{run.id.slice(0, 8)}</td>
                  <td>{run.datasetDate ?? '—'}</td>
                  <td>{run.status}</td>
                  <td>{run.startedAt ? new Date(run.startedAt).toLocaleString('ru') : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="text-sm font-medium text-muted mb-2">{title}</h3>
      {children}
    </div>
  );
}
