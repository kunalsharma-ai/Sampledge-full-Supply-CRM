import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Prisma 7 connects through a driver adapter (node-postgres here) instead of its own engine.
 * Every PrismaClient in the API, worker, seed and tools is built with these options.
 */
export function prismaOptions(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is not set');
  return { adapter: new PrismaPg({ connectionString: url }) };
}
