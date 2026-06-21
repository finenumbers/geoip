import { defineConfig } from 'drizzle-kit';

/** Schema reference for drizzle-orm queries. Migrations are hand-written SQL in ./migrations/. */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://geoip:geoip@localhost:5432/geoip',
  },
});
