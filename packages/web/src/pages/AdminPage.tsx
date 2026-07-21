import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearch, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminConfigPatch, AdminConfigResponse } from '@geoip/shared';
import {
  DISPLAY_TIMEZONE_OPTIONS,
  DEFAULT_DISPLAY_TIMEZONE,
  dailyCronToTime,
  timeToDailyCron,
} from '@geoip/shared';
import { adminApi } from '@/lib/admin-api';
import { ui } from '@/lib/ui-strings';
import { cn } from '@/lib/utils';
import { HelpBox } from '@/components/HelpBox';
import { SetupChecklistPanel } from '@/components/SetupChecklistBanner';
import { type AdminSectionId } from '@/lib/admin-sections';
import { formatDateTime } from '@/lib/format-datetime';

type SectionId = AdminSectionId;

const sections: Array<{ id: SectionId; label: string }> = [
  { id: 'overview', label: ui.admin.sections.overview },
  { id: 'general', label: ui.admin.sections.general },
  { id: 'grchc', label: ui.admin.sections.grchc },
  { id: 'rir', label: ui.admin.sections.rir },
  { id: 'api', label: ui.admin.sections.api },
  { id: 'adminAccess', label: ui.admin.sections.adminAccess },
  { id: 'export', label: ui.admin.sections.export },
  { id: 'performance', label: ui.admin.sections.performance },
  { id: 'integrations', label: ui.admin.sections.integrations },
  { id: 'logging', label: ui.admin.sections.logging },
  { id: 'infra', label: ui.admin.sections.infra },
];

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function AdminPage() {
  const navigate = useNavigate();
  const { section: sectionFromUrl } = useSearch({ from: '/admin' });
  const queryClient = useQueryClient();
  const [section, setSection] = useState<SectionId>('overview');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: me, isError: meError } = useQuery({
    queryKey: ['admin-me'],
    queryFn: adminApi.me,
    retry: false,
  });

  const { data: config, isLoading } = useQuery({
    queryKey: ['admin-config'],
    queryFn: adminApi.getConfig,
    enabled: Boolean(me),
  });

  const { data: reloadStatus } = useQuery({
    queryKey: ['admin-reload-status'],
    queryFn: adminApi.reloadStatus,
    enabled: Boolean(me),
  });

  useEffect(() => {
    if (meError) {
      void navigate({ to: '/admin/login' });
    }
  }, [meError, navigate]);

  useEffect(() => {
    if (sectionFromUrl) {
      setSection(sectionFromUrl);
    }
  }, [sectionFromUrl]);

  useEffect(() => {
    if (config && !config.secrets.api.apiKey.hasValue) {
      void navigate({ to: '/admin/setup-api-key' });
    }
  }, [config, navigate]);

  const openSection = (id: SectionId) => {
    setSection(id);
    void navigate({
      to: '/admin',
      search: id === 'overview' ? {} : { section: id },
      replace: true,
    });
  };

  const save = useMutation({
    mutationFn: (patch: AdminConfigPatch) => adminApi.saveConfig(patch),
    onSuccess: (data) => {
      queryClient.setQueryData(['admin-config'], data);
      setMessage(ui.admin.saved);
      setError(null);
    },
    onError: (err: Error) => setError(err.message),
  });

  const testGrchc = useMutation({
    mutationFn: adminApi.testGrchc,
    onSuccess: (data) => {
      setMessage(`ГРЧЦ OK: ${data.downloadCount} файлов, latest ${data.latestDate ?? '—'}`);
      setError(null);
    },
    onError: (err: Error) => setError(err.message),
  });

  const testRir = useMutation({
    mutationFn: adminApi.testRir,
    onMutate: () => {
      setMessage(ui.admin.rirProbeInProgress);
      setError(null);
    },
    onSuccess: (data) => {
      const dates = [
        ...new Set(
          data.sources
            .map((s) => s.snapshotDate)
            .filter((d): d is string => Boolean(d)),
        ),
      ].join(', ');
      const totalRows = data.sources.reduce((sum, s) => sum + (s.recordCount ?? 0), 0);
      setMessage(
        `${ui.admin.rirProbeOk}: ${data.reachableCount}/${data.sources.length}, ~${totalRows.toLocaleString('ru-RU')} строк, snapshot ${dates || '—'}`,
      );
      setError(null);
    },
    onError: (err: Error) => {
      setMessage(null);
      setError(err.message || ui.admin.rirProbeFailed);
    },
  });

  const { data: rirStatus } = useQuery({
    queryKey: ['admin-rir-status'],
    queryFn: adminApi.rirStatus,
    enabled: !!me && (section === 'rir' || section === 'overview'),
    refetchInterval: 15_000,
  });

  const triggerImport = useMutation({
    mutationFn: adminApi.triggerImport,
    onSuccess: () => {
      setMessage(ui.admin.importQueued);
      void queryClient.invalidateQueries({ queryKey: ['setup-checklist'] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const triggerRirImport = useMutation({
    mutationFn: adminApi.triggerRirImport,
    onSuccess: (data) => {
      setMessage(`${ui.admin.rirImportQueued}: ${data.importRunId}`);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-rir-status'] });
      void queryClient.invalidateQueries({ queryKey: ['rir-status'] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const resetRirImport = useMutation({
    mutationFn: adminApi.resetRirImport,
    onSuccess: (data) => {
      setMessage(`${ui.admin.resetRirImportDone} (${data.clearedRuns})`);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-rir-status'] });
      void queryClient.invalidateQueries({ queryKey: ['rir-status'] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const wipeData = useMutation({
    mutationFn: adminApi.wipeData,
    onSuccess: (data) => {
      setMessage(
        `${ui.admin.wipeDataDone}: GRChC runs ${data.grchcImportRunsDeleted}, RIR runs ${data.rirImportRunsDeleted}, exports ${data.exportJobsDeleted}`,
      );
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-rir-status'] });
      void queryClient.invalidateQueries({ queryKey: ['rir-status'] });
      void queryClient.invalidateQueries({ queryKey: ['setup-checklist'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['status'] });
    },
    onError: (err: Error) => {
      setMessage(null);
      setError(err.message);
    },
  });

  const logout = useMutation({
    mutationFn: adminApi.logout,
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['admin-me'] });
      queryClient.removeQueries({ queryKey: ['admin-config'] });
      queryClient.removeQueries({ queryKey: ['admin-reload-status'] });
      queryClient.removeQueries({ queryKey: ['setup-checklist'] });
      void navigate({ to: '/admin/login' });
    },
  });

  const form = useAdminForm(config);

  if (isLoading || !config) {
    return <p className="p-6">{ui.admin.loading}</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 gap-6 overflow-hidden">
      <nav className="w-52 shrink-0 space-y-1 overflow-auto border-r border-border pr-4 text-sm">
        {sections.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => openSection(item.id)}
            className={cn(
              'block w-full rounded-md px-3 py-2 text-left hover:bg-accent',
              section === item.id && 'bg-accent font-medium text-primary',
            )}
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          className="mt-4 block w-full rounded-md px-3 py-2 text-left text-muted hover:bg-accent"
          onClick={() => logout.mutate()}
        >
          {ui.admin.logout}
        </button>
      </nav>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto pb-8">
        {message && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{message}</p>}
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {section === 'overview' && (
          <Section title={ui.admin.sections.overview}>
            <SetupChecklistPanel className="mb-4" />
            <p className="text-sm text-muted">{ui.admin.overviewHint}</p>
            <div className="grid grid-cols-2 gap-2 pt-2">
              <ActionButton
                variant="probe"
                onClick={() => testGrchc.mutate()}
                loading={testGrchc.isPending}
              >
                {ui.admin.testGrchc}
              </ActionButton>
              <ActionButton
                variant="import"
                onClick={() => triggerImport.mutate()}
                loading={triggerImport.isPending}
              >
                {ui.admin.triggerImport}
              </ActionButton>
              <ActionButton
                variant="probe"
                onClick={() => testRir.mutate()}
                loading={testRir.isPending}
              >
                {testRir.isPending ? ui.admin.rirProbeInProgress : ui.admin.testRir}
              </ActionButton>
              <ActionButton
                variant="import"
                onClick={() => triggerRirImport.mutate()}
                loading={triggerRirImport.isPending}
              >
                {ui.admin.triggerRirImport}
              </ActionButton>
            </div>
            <div className="mt-4 space-y-2">
              <p className="text-sm text-muted">{ui.admin.wipeDataHint}</p>
              <ActionButton
                variant="danger"
                loading={wipeData.isPending}
                onClick={() => {
                  if (!window.confirm(ui.admin.wipeDataConfirm)) return;
                  wipeData.mutate();
                }}
              >
                {ui.admin.wipeData}
              </ActionButton>
            </div>
            {reloadStatus && (
              <div className="mt-4 space-y-2 text-sm">
                <p className="font-medium">{ui.admin.reloadHints}</p>
                <ReloadList label="API restart" items={reloadStatus.pendingReload.requiresApiRestart} />
                <ReloadList label="Web reload" items={reloadStatus.pendingReload.requiresWebReload} />
              </div>
            )}
          </Section>
        )}

        {section === 'general' && (
          <Section title={ui.admin.sections.general}>
            <Field label={ui.admin.displayTimezone}>
              <p className="text-xs text-muted">{ui.admin.displayTimezoneHint}</p>
              <select
                className="field-input mt-1"
                value={form.displayTimezone}
                onChange={(e) => form.setDisplayTimezone(e.target.value)}
              >
                {!DISPLAY_TIMEZONE_OPTIONS.some((option) => option.value === form.displayTimezone) && (
                  <option value={form.displayTimezone}>{form.displayTimezone}</option>
                )}
                {DISPLAY_TIMEZONE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <p className="text-xs text-muted">{ui.admin.autoImportHint}</p>
            <Toggle
              label={ui.admin.importCronEnabled}
              checked={form.importCronEnabled}
              onChange={form.setImportCronEnabled}
            />
            <Field label={ui.admin.importTime}>
              <input
                type="time"
                className="field-input"
                value={form.importCronTime}
                onChange={(e) => form.setImportCronTime(e.target.value)}
              />
            </Field>
            <Toggle
              label={ui.admin.rirImportCronEnabled}
              checked={form.rirImportCronEnabled}
              onChange={form.setRirImportCronEnabled}
            />
            <Field label={ui.admin.rirImportTime}>
              <input
                type="time"
                className="field-input"
                value={form.rirImportCronTime}
                onChange={(e) => form.setRirImportCronTime(e.target.value)}
              />
            </Field>
            <Toggle
              label={ui.admin.skipUnchangedDataset}
              checked={form.skipUnchanged}
              onChange={form.setSkipUnchanged}
            />
            <Toggle
              label={ui.admin.zipCacheEnabled}
              checked={form.zipCacheEnabled}
              onChange={form.setZipCacheEnabled}
            />
            <SaveButton
              loading={save.isPending}
              onClick={() =>
                save.mutate({
                  settings: {
                    general: {
                      displayTimezone: form.displayTimezone.trim() || DEFAULT_DISPLAY_TIMEZONE,
                    },
                    import: {
                      enabled: form.importCronEnabled,
                      cron: timeToDailyCron(form.importCronTime),
                      zipCacheEnabled: form.zipCacheEnabled,
                      skipUnchangedDataset: form.skipUnchanged,
                    },
                    rirImport: {
                      enabled: form.rirImportCronEnabled,
                      cron: timeToDailyCron(form.rirImportCronTime),
                    },
                  },
                } as AdminConfigPatch)
              }
            />
          </Section>
        )}

        {section === 'rir' && (
          <Section title={ui.admin.sections.rir}>
            {rirStatus ? (
              <div className="mb-4 space-y-1 text-sm">
                <p>
                  Status: <strong>{rirStatus.status}</strong>
                </p>
                <p>
                  {ui.rir.rowCount}: {rirStatus.rowCount.toLocaleString('ru-RU')}
                </p>
                <p>
                  {ui.rir.snapshotDate}: {rirStatus.lastSnapshotDate ?? '—'}
                </p>
                <p>
                  {ui.rir.lastSuccess}:{' '}
                  {rirStatus.lastSuccessAt
                    ? formatDateTime(
                        rirStatus.lastSuccessAt,
                        config.settings.general.displayTimezone,
                      )
                    : '—'}
                </p>
                {rirStatus.activeImport && (
                  <p>
                    {ui.admin.rirActiveImport}:{' '}
                    <strong>
                      {rirStatus.activeImport.status} ({rirStatus.activeImport.id.slice(0, 8)})
                    </strong>
                  </p>
                )}
                {rirStatus.lastError && (
                  <p className="text-red-700">Error: {rirStatus.lastError}</p>
                )}
                <pre className="mt-2 overflow-auto rounded border border-border bg-muted/30 p-2 text-xs">
                  {JSON.stringify(
                    {
                      byRegistry: rirStatus.rowsByRegistry,
                      byStatus: rirStatus.rowsByStatus,
                    },
                    null,
                    2,
                  )}
                </pre>
              </div>
            ) : (
              <p className="mb-3 text-sm text-muted">{ui.rir.notReady}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <ActionButton
                onClick={() => triggerRirImport.mutate()}
                loading={triggerRirImport.isPending}
              >
                {ui.admin.triggerRirImport}
              </ActionButton>
              <ActionButton
                onClick={() => resetRirImport.mutate()}
                loading={resetRirImport.isPending}
              >
                {ui.admin.resetRirImport}
              </ActionButton>
            </div>
            <p className="mt-3 text-xs text-muted">
              Browse: <Link to="/browse/rir" search={{ sort: '[]', filters: '[]' }} className="underline">/browse/rir</Link>
            </p>
          </Section>
        )}

        {section === 'grchc' && (
          <Section title={ui.admin.sections.grchc}>
            <HelpBox title={ui.setup.grchcHelpTitle} className="mb-4">
              <p>{ui.setup.grchcHelpBody}</p>
            </HelpBox>
            <Field label="Email ГРЧЦ">
              <input
                className="field-input"
                value={form.geoipLkEmail}
                onChange={(e) => form.setGeoipLkEmail(e.target.value)}
              />
            </Field>
            <Field label="Пароль ГРЧЦ">
              <input
                type="password"
                className="field-input"
                placeholder={config.secrets.geoipLk.password.hasValue ? '••••••••' : ''}
                value={form.geoipLkPassword}
                onChange={(e) => form.setGeoipLkPassword(e.target.value)}
              />
            </Field>
            <Field label="Base URL">
              <input
                className="field-input"
                value={form.geoipLkBaseUrl}
                onChange={(e) => form.setGeoipLkBaseUrl(e.target.value)}
              />
            </Field>
            <Toggle
              label="Staging snapshot"
              checked={form.stagingSnapshot}
              onChange={form.setStagingSnapshot}
            />
            <SaveButton
              loading={save.isPending}
              onClick={() => {
                const patch = {
                  settings: {
                    geoipLk: { baseUrl: form.geoipLkBaseUrl },
                    import: {
                      stagingSnapshotEnabled: form.stagingSnapshot,
                    },
                  },
                  secrets: {
                    geoipLk: {
                      email: form.geoipLkEmail,
                      ...(form.geoipLkPassword ? { password: form.geoipLkPassword } : {}),
                    },
                  },
                } as AdminConfigPatch;

                save.mutate(patch, {
                  onSuccess: (data) => {
                    queryClient.setQueryData(['admin-config'], data);
                    void queryClient.invalidateQueries({ queryKey: ['setup-checklist'] });
                    form.setGeoipLkPassword('');
                    openSection('overview');
                    setMessage(ui.setup.grchcSavedGoImport);
                    setError(null);
                  },
                });
              }}
            />
          </Section>
        )}

        {section === 'api' && (
          <Section title={ui.admin.sections.api}>
            <HelpBox title={ui.apiDocs.title}>
              <p>
                <Link to="/api-docs" className="font-medium underline">
                  {ui.apiDocs.openDocsLink}
                </Link>
              </p>
            </HelpBox>
            <Toggle label="API auth enabled" checked={form.apiAuthEnabled} onChange={form.setApiAuthEnabled} />
            <Field label={ui.admin.importApiKey}>
              <div className="flex gap-2">
                <input
                  type="password"
                  className="field-input flex-1"
                  placeholder={config.secrets.api.importApiKey.hasValue ? '••••••••' : ''}
                  value={form.importApiKey}
                  onChange={(e) => form.setImportApiKey(e.target.value)}
                />
                <button type="button" className="btn-secondary" onClick={() => form.setImportApiKey(randomKey())}>
                  Generate
                </button>
              </div>
            </Field>
            <Field label={ui.admin.apiKeyExternalLookup}>
              <p className="text-xs text-muted">{ui.admin.apiKeyExternalLookupHint}</p>
              <div className="flex gap-2">
                <input
                  type="password"
                  className="field-input flex-1"
                  placeholder={config.secrets.api.apiKey.hasValue ? '••••••••' : ''}
                  value={form.apiKey}
                  onChange={(e) => form.setApiKey(e.target.value)}
                />
                <button type="button" className="btn-secondary" onClick={() => form.setApiKey(randomKey())}>
                  Generate
                </button>
              </div>
            </Field>
            <Field label="CORS origin">
              <input
                className="field-input"
                value={form.corsOrigin}
                onChange={(e) => form.setCorsOrigin(e.target.value)}
              />
            </Field>
            <Field label="Rate limit (req/window ms)">
              <div className="flex gap-2">
                <input
                  type="number"
                  className="field-input"
                  value={form.rateLimitMax}
                  onChange={(e) => form.setRateLimitMax(Number(e.target.value))}
                />
                <input
                  type="number"
                  className="field-input"
                  value={form.rateLimitWindowMs}
                  onChange={(e) => form.setRateLimitWindowMs(Number(e.target.value))}
                />
              </div>
            </Field>
            <SaveButton
              loading={save.isPending}
              onClick={() =>
                save.mutate({
                  settings: {
                    api: {
                      authEnabled: form.apiAuthEnabled,
                      corsOrigin: form.corsOrigin,
                      rateLimitMax: form.rateLimitMax,
                      rateLimitWindowMs: form.rateLimitWindowMs,
                    },
                  },
                  secrets: {
                    api: {
                      ...(form.importApiKey ? { importApiKey: form.importApiKey } : {}),
                      ...(form.apiKey ? { apiKey: form.apiKey } : {}),
                    },
                  },
                } as AdminConfigPatch)
              }
            />
          </Section>
        )}

        {section === 'adminAccess' && (
          <Section title={ui.admin.sections.adminAccess}>
            <Field label={ui.admin.username}>
              <input
                className="field-input"
                value={form.adminUsername}
                onChange={(e) => form.setAdminUsername(e.target.value)}
              />
            </Field>
            <Field label={ui.admin.currentPassword}>
              <input
                type="password"
                className="field-input"
                value={form.adminCurrentPassword}
                onChange={(e) => form.setAdminCurrentPassword(e.target.value)}
              />
            </Field>
            <Field label={ui.admin.newPassword}>
              <input
                type="password"
                className="field-input"
                value={form.adminNewPassword}
                onChange={(e) => form.setAdminNewPassword(e.target.value)}
              />
            </Field>
            <SaveButton
              loading={save.isPending}
              onClick={() =>
                save.mutate({
                  secrets: {
                    admin: {
                      username: form.adminUsername,
                      ...(form.adminNewPassword
                        ? {
                            password: form.adminNewPassword,
                            currentPassword: form.adminCurrentPassword || undefined,
                          }
                        : {}),
                    },
                  },
                })
              }
            />
          </Section>
        )}

        {section === 'export' && (
          <Section title={ui.admin.sections.export}>
            <NumberField label="Retention days" value={form.exportRetentionDays} onChange={form.setExportRetentionDays} />
            <NumberField label="Retention limit" value={form.exportRetentionLimit} onChange={form.setExportRetentionLimit} />
            <NumberField label="Max rows" value={form.exportMaxRows} onChange={form.setExportMaxRows} />
            <NumberField label="Poll interval ms" value={form.exportPollMs} onChange={form.setExportPollMs} />
            <SaveButton
              loading={save.isPending}
              onClick={() =>
                save.mutate({
                  settings: {
                    export: {
                      retentionDays: form.exportRetentionDays,
                      retentionLimit: form.exportRetentionLimit,
                      maxRows: form.exportMaxRows,
                      pollIntervalMs: form.exportPollMs,
                    },
                  },
                } as AdminConfigPatch)
              }
            />
          </Section>
        )}

        {section === 'performance' && (
          <Section title={ui.admin.sections.performance}>
            <NumberField label="Max page size" value={form.maxPageSize} onChange={form.setMaxPageSize} />
            <NumberField label="Max offset page" value={form.maxOffsetPage} onChange={form.setMaxOffsetPage} />
            <NumberField label="DB pool max" value={form.dbPoolMax} onChange={form.setDbPoolMax} />
            <NumberField label="Statement timeout ms" value={form.statementTimeoutMs} onChange={form.setStatementTimeoutMs} />
            <NumberField label="ASN batch size" value={form.asnBatchSize} onChange={form.setAsnBatchSize} />
            <NumberField label="ASN workers" value={form.asnWorkers} onChange={form.setAsnWorkers} />
            <SaveButton
              loading={save.isPending}
              onClick={() =>
                save.mutate({
                  settings: {
                    table: { maxPageSize: form.maxPageSize, maxOffsetPage: form.maxOffsetPage },
                    database: { poolMax: form.dbPoolMax, statementTimeoutMs: form.statementTimeoutMs },
                    asnMap: { batchSize: form.asnBatchSize, workers: form.asnWorkers },
                  },
                })
              }
            />
          </Section>
        )}

        {section === 'integrations' && (
          <Section title={ui.admin.sections.integrations}>
            <HelpBox title={ui.setup.mapsHelpTitle} className="mb-4">
              <p>{ui.setup.mapsHelpBody}</p>
            </HelpBox>
            <Field label="Google Maps API key">
              <input
                type="password"
                className="field-input"
                placeholder={config.secrets.integrations.googleMapsApiKey.hasValue ? '••••••••' : ''}
                value={form.googleMapsKey}
                onChange={(e) => form.setGoogleMapsKey(e.target.value)}
              />
            </Field>
            <SaveButton
              loading={save.isPending}
              onClick={() =>
                save.mutate({
                  secrets: {
                    integrations: {
                      ...(form.googleMapsKey ? { googleMapsApiKey: form.googleMapsKey } : {}),
                    },
                  },
                })
              }
            />
          </Section>
        )}

        {section === 'logging' && (
          <Section title={ui.admin.sections.logging}>
            <Field label="Log level">
              <select
                className="field-input"
                value={form.logLevel}
                onChange={(e) => form.setLogLevel(e.target.value as AdminConfigResponse['settings']['logging']['level'])}
              >
                {['fatal', 'error', 'warn', 'info', 'debug', 'trace'].map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </Field>
            <Toggle label="Access log" checked={form.accessLogEnabled} onChange={form.setAccessLogEnabled} />
            <SaveButton
              loading={save.isPending}
              onClick={() =>
                save.mutate({
                  settings: {
                    logging: { level: form.logLevel, accessLogEnabled: form.accessLogEnabled },
                  },
                })
              }
            />
          </Section>
        )}

        {section === 'infra' && (
          <Section title={ui.admin.sections.infra}>
            <p className="text-sm text-muted">{ui.admin.infraHint}</p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
              <li>Import dir: {config.settings.import.downloadDir}</li>
              <li>Export dir: {config.settings.export.dir}</li>
              <li>Postgres: меняется через Portainer / compose + sync pgbouncer userlist</li>
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}

function useAdminForm(config: AdminConfigResponse | undefined) {
  const [geoipLkEmail, setGeoipLkEmail] = useState('');
  const [geoipLkPassword, setGeoipLkPassword] = useState('');
  const [geoipLkBaseUrl, setGeoipLkBaseUrl] = useState('');
  const [displayTimezone, setDisplayTimezone] = useState(DEFAULT_DISPLAY_TIMEZONE);
  const [importCronEnabled, setImportCronEnabled] = useState(true);
  const [importCronTime, setImportCronTime] = useState('10:00');
  const [rirImportCronEnabled, setRirImportCronEnabled] = useState(true);
  const [rirImportCronTime, setRirImportCronTime] = useState('06:00');
  const [zipCacheEnabled, setZipCacheEnabled] = useState(true);
  const [skipUnchanged, setSkipUnchanged] = useState(false);
  const [stagingSnapshot, setStagingSnapshot] = useState(true);
  const [apiAuthEnabled, setApiAuthEnabled] = useState(false);
  const [importApiKey, setImportApiKey] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [corsOrigin, setCorsOrigin] = useState('');
  const [rateLimitMax, setRateLimitMax] = useState(100);
  const [rateLimitWindowMs, setRateLimitWindowMs] = useState(60_000);
  const [adminUsername, setAdminUsername] = useState('');
  const [adminCurrentPassword, setAdminCurrentPassword] = useState('');
  const [adminNewPassword, setAdminNewPassword] = useState('');
  const [exportRetentionDays, setExportRetentionDays] = useState(7);
  const [exportRetentionLimit, setExportRetentionLimit] = useState(100);
  const [exportMaxRows, setExportMaxRows] = useState(5_000_000);
  const [exportPollMs, setExportPollMs] = useState(5000);
  const [maxPageSize, setMaxPageSize] = useState(200);
  const [maxOffsetPage, setMaxOffsetPage] = useState(500);
  const [dbPoolMax, setDbPoolMax] = useState(20);
  const [statementTimeoutMs, setStatementTimeoutMs] = useState(30_000);
  const [asnBatchSize, setAsnBatchSize] = useState(50_000);
  const [asnWorkers, setAsnWorkers] = useState(6);
  const [googleMapsKey, setGoogleMapsKey] = useState('');
  const [logLevel, setLogLevel] = useState<AdminConfigResponse['settings']['logging']['level']>('info');
  const [accessLogEnabled, setAccessLogEnabled] = useState(true);

  useEffect(() => {
    if (!config) return;
    setGeoipLkEmail(config.secrets.geoipLk.email);
    setGeoipLkBaseUrl(config.settings.geoipLk.baseUrl);
    setDisplayTimezone(config.settings.general.displayTimezone);
    setImportCronEnabled(config.settings.import.enabled);
    setImportCronTime(dailyCronToTime(config.settings.import.cron));
    setRirImportCronEnabled(config.settings.rirImport.enabled);
    setRirImportCronTime(dailyCronToTime(config.settings.rirImport.cron));
    setZipCacheEnabled(config.settings.import.zipCacheEnabled);
    setSkipUnchanged(config.settings.import.skipUnchangedDataset);
    setStagingSnapshot(config.settings.import.stagingSnapshotEnabled);
    setApiAuthEnabled(config.settings.api.authEnabled);
    setCorsOrigin(config.settings.api.corsOrigin);
    setRateLimitMax(config.settings.api.rateLimitMax);
    setRateLimitWindowMs(config.settings.api.rateLimitWindowMs);
    setAdminUsername(config.secrets.admin.username);
    setExportRetentionDays(config.settings.export.retentionDays);
    setExportRetentionLimit(config.settings.export.retentionLimit);
    setExportMaxRows(config.settings.export.maxRows);
    setExportPollMs(config.settings.export.pollIntervalMs);
    setMaxPageSize(config.settings.table.maxPageSize);
    setMaxOffsetPage(config.settings.table.maxOffsetPage);
    setDbPoolMax(config.settings.database.poolMax);
    setStatementTimeoutMs(config.settings.database.statementTimeoutMs);
    setAsnBatchSize(config.settings.asnMap.batchSize);
    setAsnWorkers(config.settings.asnMap.workers);
    setLogLevel(config.settings.logging.level);
    setAccessLogEnabled(config.settings.logging.accessLogEnabled);
  }, [config]);

  return useMemo(
    () => ({
      geoipLkEmail,
      setGeoipLkEmail,
      geoipLkPassword,
      setGeoipLkPassword,
      geoipLkBaseUrl,
      setGeoipLkBaseUrl,
      displayTimezone,
      setDisplayTimezone,
      importCronEnabled,
      setImportCronEnabled,
      importCronTime,
      setImportCronTime,
      rirImportCronEnabled,
      setRirImportCronEnabled,
      rirImportCronTime,
      setRirImportCronTime,
      zipCacheEnabled,
      setZipCacheEnabled,
      skipUnchanged,
      setSkipUnchanged,
      stagingSnapshot,
      setStagingSnapshot,
      apiAuthEnabled,
      setApiAuthEnabled,
      importApiKey,
      setImportApiKey,
      apiKey,
      setApiKey,
      corsOrigin,
      setCorsOrigin,
      rateLimitMax,
      setRateLimitMax,
      rateLimitWindowMs,
      setRateLimitWindowMs,
      adminUsername,
      setAdminUsername,
      adminCurrentPassword,
      setAdminCurrentPassword,
      adminNewPassword,
      setAdminNewPassword,
      exportRetentionDays,
      setExportRetentionDays,
      exportRetentionLimit,
      setExportRetentionLimit,
      exportMaxRows,
      setExportMaxRows,
      exportPollMs,
      setExportPollMs,
      maxPageSize,
      setMaxPageSize,
      maxOffsetPage,
      setMaxOffsetPage,
      dbPoolMax,
      setDbPoolMax,
      statementTimeoutMs,
      setStatementTimeoutMs,
      asnBatchSize,
      setAsnBatchSize,
      asnWorkers,
      setAsnWorkers,
      googleMapsKey,
      setGoogleMapsKey,
      logLevel,
      setLogLevel,
      accessLogEnabled,
      setAccessLogEnabled,
    }),
    [
      geoipLkEmail,
      geoipLkPassword,
      geoipLkBaseUrl,
      displayTimezone,
      importCronEnabled,
      importCronTime,
      rirImportCronEnabled,
      rirImportCronTime,
      zipCacheEnabled,
      skipUnchanged,
      stagingSnapshot,
      apiAuthEnabled,
      importApiKey,
      apiKey,
      corsOrigin,
      rateLimitMax,
      rateLimitWindowMs,
      adminUsername,
      adminCurrentPassword,
      adminNewPassword,
      exportRetentionDays,
      exportRetentionLimit,
      exportMaxRows,
      exportPollMs,
      maxPageSize,
      maxOffsetPage,
      dbPoolMax,
      statementTimeoutMs,
      asnBatchSize,
      asnWorkers,
      googleMapsKey,
      logLevel,
      accessLogEnabled,
    ],
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        className="field-input"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function SaveButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={loading}
      className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      onClick={onClick}
    >
      {loading ? 'Сохранение…' : ui.admin.saveSection}
    </button>
  );
}

function ActionButton({
  children,
  loading,
  onClick,
  variant = 'secondary',
}: {
  children: React.ReactNode;
  loading?: boolean;
  onClick: () => void;
  variant?: 'secondary' | 'probe' | 'import' | 'danger';
}) {
  const className =
    variant === 'probe'
      ? 'btn-probe'
      : variant === 'import'
        ? 'btn-import'
        : variant === 'danger'
          ? 'btn-danger'
          : 'btn-secondary rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50';
  return (
    <button type="button" disabled={loading} className={className} onClick={onClick}>
      {children}
    </button>
  );
}

function ReloadList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <p>
      {label}: {items.join(', ')}
    </p>
  );
}
