// Reads apps/api/.env first (Prisma 6 used to load it as a side effect of creating a client).
import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? '',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  sessionHours: Number(process.env.SESSION_HOURS ?? 12),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  cookieName: 'sampledge_session',
};

export function assertConfig() {
  if (!config.jwtSecret || config.jwtSecret.length < 12) {
    throw new Error('JWT_SECRET must be set (at least 12 characters). See apps/api/.env.example.');
  }
  if (process.env.NODE_ENV === 'production' && config.jwtSecret.startsWith('dev-')) {
    throw new Error('Refusing to start in production with a development JWT_SECRET.');
  }
}
