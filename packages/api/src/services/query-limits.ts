import { EXPORT_ROW_LIMIT_CODE } from '@geoip/shared';
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

export function validateExportRowLimit(
  estimatedRows: number,
): { ok: true } | { ok: false; code: typeof EXPORT_ROW_LIMIT_CODE; estimatedRows: number; maxRows: number } {
  const env = loadEnv();
  if (estimatedRows > env.EXPORT_MAX_ROWS) {
    return {
      ok: false,
      code: EXPORT_ROW_LIMIT_CODE,
      estimatedRows,
      maxRows: env.EXPORT_MAX_ROWS,
    };
  }
  return { ok: true };
}
