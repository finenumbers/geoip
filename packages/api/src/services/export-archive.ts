import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { ZipArchive } from 'archiver';

export function resolveExportZipPath(exportDir: string, jobId: string): string {
  return `${exportDir.replace(/\/$/, '')}/${jobId}.zip`;
}

export function exportCsvEntryName(tableType: 'city' | 'country'): string {
  return `geoip-${tableType}-export.csv`;
}

/** Stream CSV into a zip file without loading the whole dataset into memory. */
export async function createExportZipArchive(
  csvPath: string,
  zipPath: string,
  entryName: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 6 } });

    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    archive.file(csvPath, { name: entryName });
    void archive.finalize();
  });
}

export async function removeExportCsvAfterArchive(csvPath: string): Promise<void> {
  try {
    await unlink(csvPath);
  } catch {
    // best-effort cleanup
  }
}
