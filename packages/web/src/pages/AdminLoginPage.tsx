import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AdminAuthShell } from '@/components/AdminAuthShell';
import { adminApi } from '@/lib/admin-api';
import { ui } from '@/lib/ui-strings';

export function AdminLoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: status, isLoading } = useQuery({
    queryKey: ['admin-auth-status'],
    queryFn: adminApi.authStatus,
  });

  useEffect(() => {
    if (status && !status.setupComplete) {
      void navigate({ to: '/admin/setup' });
    }
  }, [status, navigate]);

  const login = useMutation({
    mutationFn: () => adminApi.login(username, password),
    onSuccess: async () => {
      try {
        await adminApi.me();
        void navigate({ to: '/admin' });
      } catch {
        setError(
          'Вход выполнен, но сессия не сохранилась. Откройте сайт по HTTPS или обновите образ после деплоя.',
        );
      }
    },
    onError: (err: Error) => setError(err.message),
  });

  if (isLoading || (status && !status.setupComplete)) {
    return (
      <AdminAuthShell title={ui.admin.loginTitle}>
        <p>{ui.admin.loading}</p>
      </AdminAuthShell>
    );
  }

  return (
    <AdminAuthShell title={ui.admin.loginTitle}>
      <form
        className="mx-auto w-full max-w-md space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          login.mutate();
        }}
      >
        {error && <p className="text-sm text-red-600">{error}</p>}
        <label className="block space-y-1 text-sm">
          <span>{ui.admin.username}</span>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>{ui.admin.password}</span>
          <input
            type="password"
            className="w-full rounded-md border border-border bg-background px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <button
          type="submit"
          disabled={login.isPending}
          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {login.isPending ? 'Вход…' : ui.admin.loginAction}
        </button>
      </form>
    </AdminAuthShell>
  );
}
