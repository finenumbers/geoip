import type { FastifyInstance } from 'fastify';
import { exportRequestSchema, validateTableQueryProfile, profileValidationToFieldErrors, normalizeFiltersForQuery } from '@geoip/shared';
import {
  createExportJob,
  getExportJob,
  readExportFile,
  estimateExportRows,
} from '../services/export-service.js';
import { isMaterializedViewsReadyForQueries } from '../sql/recreate-materialized-views.js';
import { validateExportRowLimit } from '../services/query-limits.js';

export async function registerExportRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/v1/exports/table',
    { preHandler: [app.verifyApiKey] },
    async (request, reply) => {
      const parsed = exportRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({ error: 'Validation error', details: parsed.error.flatten() });
      }

      if (!(await isMaterializedViewsReadyForQueries())) {
        return reply.status(503).send({
          error: 'Service unavailable',
          message: 'Materialized views are refreshing. Retry export shortly.',
        });
      }

      const { tableType, sort } = parsed.data;
      const filters = normalizeFiltersForQuery(parsed.data.filters);
      const profileCheck = validateTableQueryProfile(tableType, sort, filters);
      if (!profileCheck.ok) {
        return reply
          .status(422)
          .send({ error: 'Validation error', details: profileValidationToFieldErrors(profileCheck.issues) });
      }

      const totalRows = await estimateExportRows(tableType, filters, sort);
      if (totalRows != null) {
        const exportLimit = validateExportRowLimit(totalRows);
        if (!exportLimit.ok) {
          return reply.status(422).send({ error: 'Validation error', message: exportLimit.message });
        }
      }

      const job = await createExportJob({ tableType, filters, sort });
      if (!job) {
        return reply.status(500).send({ error: 'Failed to create export job' });
      }

      return reply.status(202).send({
        id: job.id,
        status: 'queued',
        tableType: job.tableType,
        createdAt: job.createdAt.toISOString(),
        estimatedRows: totalRows,
      });
    },
  );

  app.get('/api/v1/exports/:id', { preHandler: [app.verifyApiKey] }, async (request, reply) => {
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
      errorMessage: job.errorMessage,
      rowCount: job.rowCount,
    };
  });

  app.get('/api/v1/exports/:id/download', { preHandler: [app.verifyApiKey] }, async (request, reply) => {
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
