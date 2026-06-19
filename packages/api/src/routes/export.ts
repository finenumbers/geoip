import type { FastifyInstance } from 'fastify';
import { exportRequestSchema } from '@geoip/shared';
import {
  createExportJob,
  getExportJob,
  processExportJob,
  readExportFile,
  estimateExportRows,
} from '../services/export-service.js';

export async function registerExportRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/v1/exports/table',
    { preHandler: [app.verifyApiKey] },
    async (request, reply) => {
      const parsed = exportRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({ error: 'Validation error', details: parsed.error.flatten() });
      }

      const { tableType, filters, sort } = parsed.data;
      const totalRows = await estimateExportRows(tableType, filters, sort);

      const job = await createExportJob(parsed.data);
      if (!job) {
        return reply.status(500).send({ error: 'Failed to create export job' });
      }

      processExportJob(job.id).catch(() => {});

      return reply.status(202).send({
        id: job.id,
        status: 'queued',
        tableType: job.tableType,
        createdAt: job.createdAt.toISOString(),
        estimatedRows: totalRows,
      });
    },
  );

  app.get('/api/v1/exports/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await getExportJob(id);
    if (!job) {
      return reply.status(404).send({ error: 'Not found' });
    }

    return {
      id: job.id,
      status: job.status,
      tableType: job.tableType,
      createdAt: job.createdAt.toISOString(),
      finishedAt: job.finishedAt?.toISOString() ?? null,
      downloadPath: job.downloadPath,
      errorMessage: job.errorMessage,
      rowCount: job.rowCount,
    };
  });

  app.get('/api/v1/exports/:id/download', async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await getExportJob(id);
    if (!job || job.status !== 'succeeded' || !job.downloadPath) {
      return reply.status(404).send({ error: 'Export not ready' });
    }

    const content = await readExportFile(job.downloadPath);
    if (!content) {
      return reply.status(404).send({ error: 'File not found' });
    }

    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', `attachment; filename="geoip-export-${id}.csv"`);
    return content;
  });
}
