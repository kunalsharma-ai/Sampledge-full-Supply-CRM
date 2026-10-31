/**
 * Workspace (tenant) administration for operators, run on the server:
 *
 *   node dist/tenant.js list
 *   node dist/tenant.js create --name "Acme Research" --slug acme --admin-email ops@acme.example --admin-name "Ana Ops"
 *
 * `create` makes the workspace and its first platform admin. A new person gets a random password,
 * printed once; they should change it (or sign in with SSO). An existing person (same e-mail) keeps
 * their password and is added to the new workspace. Workspaces are not created from inside another
 * workspace, so no workspace administrator can reach beyond their own tenant.
 * Uses DATABASE_URL; run it as the operations role (see the runbook).
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

export type NewWorkspace = { name: string; slug: string; adminEmail: string; adminName: string };

export async function createWorkspace(db: PrismaClient, w: NewWorkspace) {
  const slug = w.slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) throw new Error('Slug: 3-40 lower-case letters, digits or dashes');
  if (w.name.trim().length < 2) throw new Error('Name is required');
  const email = w.adminEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Admin e-mail is not valid');
  if (await db.tenant.findUnique({ where: { slug } })) throw new Error(`A workspace with slug "${slug}" already exists`);
  return db.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({ data: { name: w.name.trim(), slug } });
    // The new tenant's rows are written in its own scope, so row-level security accepts them.
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
    let user = await tx.user.findUnique({ where: { email } });
    let password: string | null = null;
    if (!user) {
      password = randomBytes(12).toString('base64url');
      user = await tx.user.create({ data: { email, name: w.adminName.trim() || email, passwordHash: await bcrypt.hash(password, 10) } });
    }
    await tx.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: 'platform_admin' } });
    await tx.auditLog.create({ data: { tenantId: tenant.id, actorId: null, actor: 'operator (tenant command)', action: 'workspace.created', entity: 'Tenant', entityId: tenant.id, after: { name: tenant.name, slug, admin: email } } });
    return { tenant, admin: { id: user.id, email, password } };
  });
}

export async function listWorkspaces(db: PrismaClient) {
  const ts = await db.tenant.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true, slug: true, createdAt: true, _count: { select: { memberships: true } } } });
  return ts.map((t) => ({ id: t.id, name: t.name, slug: t.slug, createdAt: t.createdAt, members: t._count.memberships }));
}

function arg(argv: string[], name: string) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv: string[]) {
  const db = new PrismaClient();
  try {
    if (argv[0] === 'list') {
      console.table((await listWorkspaces(db)).map((t) => ({ ...t, createdAt: t.createdAt.toISOString().slice(0, 10) })));
    } else if (argv[0] === 'create') {
      const w = { name: arg(argv, 'name') ?? '', slug: arg(argv, 'slug') ?? '', adminEmail: arg(argv, 'admin-email') ?? '', adminName: arg(argv, 'admin-name') ?? '' };
      const r = await createWorkspace(db, w);
      console.log(`Created workspace "${r.tenant.name}" (${r.tenant.slug}), first admin ${r.admin.email}`);
      console.log(r.admin.password ? `Temporary password (shown once): ${r.admin.password}` : 'Existing account added; their password is unchanged.');
    } else {
      console.log('Usage: node dist/tenant.js list | create --name <name> --slug <slug> --admin-email <email> --admin-name <name>');
      process.exitCode = 2;
    }
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error((e as Error).message); process.exit(1); });
