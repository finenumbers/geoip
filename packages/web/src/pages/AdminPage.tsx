import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function AdminPage() {
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem('importApiKey') ?? '');
  const [message, setMessage] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.triggerImport(apiKey),
    onSuccess: (data) => {
      setMessage(`Импорт поставлен в очередь: ${data.importRunId}`);
    },
    onError: (err: Error) => {
      setMessage(`Ошибка: ${err.message}`);
    },
  });

  const saveKey = () => {
    sessionStorage.setItem('importApiKey', apiKey);
    setMessage('API key сохранён в sessionStorage');
  };

  return (
    <div className="space-y-6 max-w-lg">
      <h2 className="text-2xl font-semibold">Admin</h2>

      <div className="space-y-3">
        <label className="block text-sm text-muted">Import API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="w-full px-4 py-2 bg-card border border-border rounded-md"
        />
        <button
          onClick={saveKey}
          className="px-4 py-2 border border-border rounded-md hover:bg-accent"
        >
          Сохранить ключ
        </button>
      </div>

      <button
        onClick={() => mutation.mutate()}
        disabled={!apiKey || mutation.isPending}
        className="px-6 py-2 bg-primary text-white rounded-md hover:opacity-90 disabled:opacity-50"
      >
        {mutation.isPending ? 'Запуск...' : 'Запустить импорт'}
      </button>

      {message && <p className="text-sm">{message}</p>}
    </div>
  );
}
