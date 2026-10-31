/**
 * Schema fragments shared by User (Turn2Opinion, MyFrequentRewards) and Respondent (MyHealthOpinions)
 * for the Sampledge integration: consent per purpose, account status, a cross-panel dedupe key and
 * recruitment source. Plus helpers for age that the integration and the models both use.
 */
import crypto from "crypto";
import mongoose from "mongoose";

/** Purposes a panelist consents to. "health_data" applies to MyHealthOpinions only. */
export const CONSENT_PURPOSES = ["survey_invitations", "profiling", "client_sharing", "health_data"];

const consentRecord = new mongoose.Schema({
    purpose: { type: String, enum: CONSENT_PURPOSES, required: true },
    granted: { type: Boolean, required: true },
    at: { type: Date, required: true, default: Date.now },
    policyVersion: { type: String, trim: true, required: true },
    // Where it was captured (signup form, profile page, re-consent email); no IP or device stored here.
    channel: { type: String, trim: true, lowercase: true },
}, { _id: false });

export const ACCOUNT_STATUS = ["active", "paused", "blocked", "deleted"];

export const integrationFields = {
    // Full history; the latest record per purpose is what counts (see hasConsent).
    consents: { type: [consentRecord], default: [] },
    // Latest decision per purpose, kept in step with `consents` on save so counts can be queried quickly.
    consentState: {
        survey_invitations: { type: Boolean, default: false },
        profiling: { type: Boolean, default: false },
        client_sharing: { type: Boolean, default: false },
        health_data: { type: Boolean, default: false },
    },
    accountStatus: { type: String, enum: ACCOUNT_STATUS, default: "active", index: true },
    lastActiveAt: { type: Date, default: null, index: true },
    unsubscribedAt: { type: Date, default: null },
    deletionRequestedAt: { type: Date, default: null },
    // HMAC of the normalised email, same secret on all three panels: lets Sampledge spot one person on
    // two panels without seeing the email. Never returned to clients.
    dedupeKey: { type: String, default: null, select: false, index: true },
    recruitment: {
        source: { type: String, trim: true, lowercase: true, default: null },
        campaign: { type: String, trim: true, default: null },
    },
};

/** Fields to add to each address entry. */
export const addressFields = {
    countryCode: { type: String, trim: true, uppercase: true, match: [/^[A-Z]{2}$/, "Use a 2-letter ISO country code"], default: null },
    // ISO 3166-2 subdivision when known (e.g. US-CA, IN-MH), otherwise the state as entered.
    region: { type: String, trim: true, default: null },
};

/** Latest decision per purpose wins; no record means no consent. */
export function hasConsent(doc, purpose) {
    const list = (doc?.consents ?? []).filter((c) => c.purpose === purpose);
    if (!list.length) return false;
    const latest = list.reduce((a, b) => (new Date(b.at) >= new Date(a.at) ? b : a));
    return latest.granted === true;
}

export function dedupeKeyFor(email, secret = process.env.PANEL_DEDUPE_SECRET) {
    if (!email || !secret) return null;
    let [local, domain] = String(email).trim().toLowerCase().split("@");
    if (!domain) return null;
    if (domain === "gmail.com" || domain === "googlemail.com") { local = local.split("+")[0].replace(/\./g, ""); domain = "gmail.com"; }
    return crypto.createHmac("sha256", secret).update(`${local}@${domain}`).digest("hex");
}

/** Exact age split into years, months and days. Fixes the earlier bug that compared months twice. */
export function ageParts(dob, today = new Date()) {
    if (!dob) return null;
    const d = new Date(dob);
    if (isNaN(d.getTime())) return null;
    let years = today.getFullYear() - d.getFullYear();
    let month = today.getMonth() - d.getMonth();
    let day = today.getDate() - d.getDate();
    if (day < 0) {
        month -= 1;
        day += new Date(today.getFullYear(), today.getMonth(), 0).getDate(); // days in the previous month
    }
    if (month < 0) { years -= 1; month += 12; }
    return { years, month, day };
}

export const AGE_BANDS = [[13, 17], [18, 24], [25, 29], [30, 34], [35, 44], [45, 54], [55, 64], [65, 120]];
export function ageBand(dob, today = new Date()) {
    const a = ageParts(dob, today);
    if (!a) return null;
    const b = AGE_BANDS.find(([lo, hi]) => a.years >= lo && a.years <= hi);
    return b ? (b[1] >= 120 ? `${b[0]}+` : `${b[0]}-${b[1]}`) : null;
}

// Same list both models used. "administrator" is a valid User role but was never allowed here; add it if intended.
const ADMIN_ROLES = ["admin", "superadmin", "root"];
/**
 * Admin check used by both resetPassword methods. User checked admin.category and Respondent checked
 * admin.role; this accepts either, so neither existing caller loses access. Note that role is
 * select:false on User, so a User admin must be loaded with .select("+role").
 */
export function assertAdmin(admin) {
    const values = [admin?.role, admin?.category].filter(Boolean).map((v) => String(v).toLowerCase());
    if (!values.some((v) => ADMIN_ROLES.includes(v))) throw new Error("Permission denied");
}

/** Sets consentState from the consent history. Called from the models' pre-save hook. */
export function syncConsentState(doc) {
    for (const p of CONSENT_PURPOSES) doc.set(`consentState.${p}`, hasConsent(doc, p));
}

/**
 * Mongo filter for panelists Sampledge may count in feasibility and invite: active account, not
 * unsubscribed or awaiting deletion, consented to invitations, and active recently if asked.
 */
export function reachableMatch({ activeWithinDays, healthData = false, now = new Date() } = {}) {
    const m = {
        accountStatus: "active",
        unsubscribedAt: null,
        deletionRequestedAt: null,
        "consentState.survey_invitations": true,
    };
    if (healthData) m["consentState.health_data"] = true;
    if (activeWithinDays) m.lastActiveAt = { $gte: new Date(now.getTime() - activeWithinDays * 86400000) };
    return m;
}
