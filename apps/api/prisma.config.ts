// Prisma 7 configuration: the connection string lives here, not in schema.prisma.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // `prisma generate` does not connect, so an unset DATABASE_URL is fine there; migrate needs it.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
