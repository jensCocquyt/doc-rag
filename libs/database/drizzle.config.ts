import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Run from the workspace root (pnpm db:generate / db:migrate); .env supplies
// DATABASE_URL in postgresql:// form.
const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('DATABASE_URL is required (copy .env.example to .env)');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './libs/database/src/lib/schema.ts',
  out: './libs/database/migrations',
  dbCredentials: { url },
  strict: true,
});
