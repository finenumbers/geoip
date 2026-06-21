import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/admin-api';
import { ui } from '@/lib/ui-strings';

export function AdminSetupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: status, isLoading } = useQuery({
    queryKey: ['admin-auth-status'],
    queryFn: adminApi.authStatus,
  });

  const setup = useMutation({
    mutationFn: () => adminApi.setup(username, password, confirmPassword),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['setup-checklist'] });
      void navigate({ to: '/admin' });
    },
    onError: (err: Error) => setError(err.message),
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-md px-6 py-10">
        <p>Загрузка…</p>
      </div>
    );
  }

  if (status?.setupComplete) {
    void navigate({ to: '/admin/login' });
    return null;
  }

  return (
    <div className="mx-auto max-w-md px-6 py-10">
      <h1 className="mb-2 text-2xl font-bold">{ui.admin.setupTitle}</h1>
      <p className="mb-6 text-sm text-muted">{ui.admin.setupHint}</p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setup.mutate();
        }}
      >
        {error && <p className="text-sm text-red-600">{error}</p>}
        <label className="block space-y-1 text-sm">
          <span>{ui.admin.username}</span>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>{ui.admin.newPassword}</span>
          <input
            type="password"
            className="w-full rounded-md border border-border bg-background px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>{ui.admin.confirmPassword}</span>
          <input
            type="password"
            className="w-full rounded-md border border-border bg-background px-3 py-2"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={setup.isPending}
          className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {setup.isPending ? 'Сохранение…' : ui.admin.setupAction}
        </button>
      </form>
    </div>
  );
}
