import { loadEnv } from '../config/env.js';

export function validateTableQueryLimits(
  page: number,
  pageSize: number,
  usesKeyset: boolean,
): { ok: true } | { ok: false; message: string; path: string } {
  const env = loadEnv();

  if (pageSize > env.TABLE_MAX_PAGE_SIZE) {
    return {
      ok: false,
      path: 'pageSize',
      message: `pageSize must be at most ${env.TABLE_MAX_PAGE_SIZE}`,
    };
  }

  if (!usesKeyset && page > env.TABLE_MAX_OFFSET_PAGE) {
    return {
      ok: false,
      path: 'page',
      message: `page must be at most ${env.TABLE_MAX_OFFSET_PAGE} for offset pagination`,
    };
  }

  return { ok: true };
}

export function validateExportRowLimit(estimatedRows: number): { ok: true } | { ok: false; message: string } {
  const env = loadEnv();
  if (estimatedRows > env.EXPORT_MAX_ROWS) {
    return {
      ok: false,
      message: `Export exceeds maximum row limit (${env.EXPORT_MAX_ROWS.toLocaleString()} rows)`,
    };
  }
  return { ok: true };
}
