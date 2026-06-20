import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
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

  const login = useMutation({
    mutationFn: () => adminApi.login(username, password),
    onSuccess: () => {
      void navigate({ to: '/admin' });
    },
    onError: (err: Error) => setError(err.message),
  });

  if (isLoading) {
    return <AdminShell title={ui.admin.loginTitle}>Загрузка…</AdminShell>;
  }

  if (!status?.setupComplete) {
    void navigate({ to: '/admin/setup' });
    return null;
  }

  return (
    <AdminShell title={ui.admin.loginTitle}>
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
    </AdminShell>
  );
}

function AdminShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-5xl flex-col justify-center px-6 py-10">
      <h1 className="mb-6 text-2xl font-bold">{title}</h1>
      {children}
    </div>
  );
}
