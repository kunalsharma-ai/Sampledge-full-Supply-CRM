/**
 * Single import point for the shared @sampledge/core package in the web app.
 *
 * `vendors` and `clients` are reference registries used across modules for names, coverage and
 * rate cards. Offline they hold the seed records; when signed in, the store replaces their
 * contents with what the API returned for this user (already tenant-scoped and redacted).
 */
export * from '@sampledge/core';
import { seed, type Vendor } from '@sampledge/core';

export const { projects, opportunities, surveys, approvals, notificationsSeed, countryActivity, agents } = seed;

type Client = { id: string; name: string; sector: string | null };
export const vendors: Vendor[] = [...seed.vendors];
export const clients: Client[] = [...seed.clients];

export function setRegistries(v: Vendor[] | null, c: Client[] | null) {
  vendors.splice(0, vendors.length, ...(v ?? seed.vendors));
  clients.splice(0, clients.length, ...(c ?? seed.clients));
}
