import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/admin-api';
import { ui } from '@/lib/ui-strings';

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function AdminSetupApiKeyPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const { data: me, isLoading: meLoading, isError: meError } = useQuery({
    queryKey: ['admin-me'],
    queryFn: adminApi.me,
    retry: false,
  });

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ['admin-config'],
    queryFn: adminApi.getConfig,
    enabled: Boolean(me),
  });

  useEffect(() => {
    if (meError) {
      void navigate({ to: '/admin/login' });
    }
  }, [meError, navigate]);

  useEffect(() => {
    if (config?.secrets.api.apiKey.hasValue) {
      void navigate({ to: '/admin' });
    }
  }, [config, navigate]);

  const save = useMutation({
    mutationFn: () => adminApi.saveConfig({ secrets: { api: { apiKey } } }),
    onSuccess: (data) => {
      setSaved(true);
      queryClient.setQueryData(['admin-config'], data);
      void queryClient.invalidateQueries({ queryKey: ['setup-checklist'] });
      void navigate({ to: '/admin', search: { section: 'grchc' } });
    },
    onError: (err: Error) => setError(err.message),
  });

  if (meLoading || configLoading) {
    return (
      <div className="mx-auto max-w-md px-6 py-10">
        <p>{ui.admin.loading}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-6 py-10">
      <h1 className="mb-2 text-2xl font-bold">{ui.admin.setupApiKeyTitle}</h1>
      <p className="mb-6 text-sm text-muted">{ui.admin.setupApiKeyHint}</p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (apiKey.length < 8) {
            setError('Ключ должен быть не короче 8 символов');
            return;
          }
          save.mutate();
        }}
      >
        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && (
          <p className="text-sm text-green-700">{ui.admin.setupApiKeySaved}</p>
        )}
        <label className="block space-y-1 text-sm">
          <span>{ui.admin.apiKeyExternalLookup}</span>
          <p className="text-xs text-muted">{ui.admin.apiKeyExternalLookupHint}</p>
          <div className="flex gap-2">
            <input
              type="text"
              className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Generate или вставьте ключ"
              autoComplete="off"
            />
            <button
              type="button"
              className="shrink-0 rounded-md border border-border px-3 py-2 text-sm"
              onClick={() => setApiKey(randomKey())}
            >
              Generate
            </button>
          </div>
        </label>
        <button
          type="submit"
          disabled={save.isPending || apiKey.length < 8}
          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {save.isPending ? 'Сохранение…' : ui.admin.setupApiKeyAction}
        </button>
      </form>
    </div>
  );
}
