import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { Open } from 'unzipper';
import {
  createExportZipArchive,
  exportCsvEntryName,
  resolveExportZipPath,
} from './export-archive.js';
import { resolveExportDownloadHeaders } from './export-service.js';

describe('export archive', () => {
  it('creates zip with csv entry without loading entire file into a string', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'geoip-export-zip-'));
    const csvPath = join(dir, 'job.csv');
    const zipPath = resolveExportZipPath(dir, 'job-1');
    writeFileSync(csvPath, '\uFEFFid;city\n1;Москва\n', 'utf-8');

    try {
      await createExportZipArchive(csvPath, zipPath, exportCsvEntryName('city'));

      const directory = await Open.file(zipPath);
      const entry = directory.files.find((file) => file.path === 'geoip-city-export.csv');
      expect(entry).toBeDefined();

      const content = (await entry!.buffer()).toString('utf-8');
      expect(content).toContain('Москва');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves download headers for zip exports', () => {
    expect(
      resolveExportDownloadHeaders('/tmp/geoip-exports/job.zip', 'country', 'job'),
    ).toEqual({
      contentType: 'application/zip',
      filename: 'geoip-country-export-job.zip',
    });
  });
});
