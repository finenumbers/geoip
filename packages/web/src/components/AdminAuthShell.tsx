import type { ReactNode } from 'react';
import { SetupChecklistPanel } from '@/components/SetupChecklistBanner';

type AdminAuthShellProps = {
  title: string;
  children: ReactNode;
  showChecklist?: boolean;
};

/** Shared layout for admin login and first-run setup (inside AppLayout). */
export function AdminAuthShell({ title, children, showChecklist = true }: AdminAuthShellProps) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-5xl flex-col justify-center py-4">
      {showChecklist && <SetupChecklistPanel className="mb-6" />}
      <h1 className="mb-6 text-2xl font-bold">{title}</h1>
      {children}
    </div>
  );
}
