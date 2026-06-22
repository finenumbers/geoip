import { describe, expect, it } from 'vitest';
import { ui } from '@/lib/ui-strings';
import {
  collectFailedSystemChecks,
  formatMaterializedViewsStatus,
  formatSystemCheckLabel,
  formatSystemCheckStatus,
  isMaterializedViewsWarmup,
  resolveSystemCheckState,
  shouldHideSystemBannerForSetupPage,
  systemCheckStatusClass,
} from '@/lib/system-status-labels';

describe('system-status-labels', () => {
  it('uses informative labels instead of abbreviations', () => {
    expect(formatSystemCheckLabel('materializedViews')).toBe('Представления для запросов');
    expect(formatSystemCheckLabel('asnMapping')).toBe('Сопоставление ASN');
  });

  it('maps initialization state for materialized views', () => {
    expect(formatSystemCheckStatus('materializedViews', false, true)).toEqual({
      text: ui.dashboard.checkMvPending,
      state: 'pending',
    });
  });

  it('maps ready and failed states per check', () => {
    expect(formatSystemCheckStatus('database', true).text).toBe('Подключена');
    expect(formatSystemCheckStatus('dataset', true).text).toBe('Загружен');
    expect(formatSystemCheckStatus('dataset', false).text).toBe('Не загружен');
    expect(formatSystemCheckStatus('materializedViews', true).text).toBe('Готовы');
    expect(formatSystemCheckStatus('productionIndexes', false).text).toBe('Отсутствуют');
  });

  it('assigns status colors', () => {
    expect(systemCheckStatusClass('ok')).toContain('green');
    expect(systemCheckStatusClass('pending')).toContain('amber');
    expect(systemCheckStatusClass('fail')).toContain('red');
  });

  it('does not use pending state for non-MV checks', () => {
    expect(resolveSystemCheckState('database', false, true)).toBe('fail');
  });

  it('formats materialized views from ready checks', () => {
    expect(
      formatMaterializedViewsStatus({
        checks: { dataset: true, materializedViews: true },
        initializing: false,
      }),
    ).toEqual({ text: ui.dashboard.checkMvOk, state: 'ok' });
  });

  it('formats materialized views from mvStatus fallback', () => {
    expect(
      formatMaterializedViewsStatus({
        initializing: true,
        mvStatus: 'refreshing',
      }),
    ).toEqual({ text: ui.dashboard.checkMvPending, state: 'pending' });
  });

  it('collects failed checks and skips pending MV during initialization', () => {
    expect(
      collectFailedSystemChecks(
        {
          database: false,
          dataset: true,
          materializedViews: false,
          productionIndexes: true,
          asnMapping: true,
        },
        true,
      ),
    ).toEqual(['database']);
  });

  it('hides system banner on setup pages when onboarding covers expected not_ready', () => {
    expect(
      shouldHideSystemBannerForSetupPage('/', true, false, {
        database: true,
        dataset: false,
      }),
    ).toBe(true);
    expect(
      shouldHideSystemBannerForSetupPage('/browse/city', true, false, {
        database: true,
        dataset: false,
      }),
    ).toBe(false);
    expect(
      shouldHideSystemBannerForSetupPage('/', true, false, {
        database: false,
        dataset: false,
      }),
    ).toBe(false);
  });

  it('detects MV warmup before dataset mvStatus is known', () => {
    expect(
      isMaterializedViewsWarmup(
        { database: true, dataset: true, materializedViews: false },
        undefined,
        true,
      ),
    ).toBe(true);
    expect(
      isMaterializedViewsWarmup(
        { database: true, dataset: true, materializedViews: false },
        'unavailable',
        false,
      ),
    ).toBe(false);
  });
});
