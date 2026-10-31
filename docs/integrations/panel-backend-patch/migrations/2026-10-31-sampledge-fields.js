/**
 * One-off migration for the Sampledge integration fields.
 *
 *   node migrations/2026-10-31-sampledge-fields.js            # dry run: prints what would change
 *   node migrations/2026-10-31-sampledge-fields.js --apply    # writes
 *   ... --apply --legacy-consent=<policyVersion>              # also see step 5
 *
 * Env: MONGO_URI. Collection names default to Mongoose's (users, respondents, responses); override
 * with USERS_COLLECTION, RESPONDENTS_COLLECTION, RESPONSES_COLLECTION.
 *
 * Steps
 *  1. respondents: rename the misspelled `concent` to `consent`.
 *  2. users + respondents: set accountStatus ("deleted" where isDeleted is true, else "active").
 *  3. users + respondents: fill address.countryCode from the free-text country; lists what it could not map.
 *  4. responses: set statusChangedAt from updatedAt (or createdAt) where missing.
 *  5. Optional, off by default: existing panelists have no consent records, so feasibility counts them
 *     as not reachable. If your sign-up terms already covered survey invitations, --legacy-consent
 *     records that consent with the policy version you name and channel "legacy_terms", only for
 *     people who accepted terms. This is your legal call; the script never assumes it.
 */
import mongoose from "mongoose";
import { toCountryCode } from "../integration/country.js";

const APPLY = process.argv.includes("--apply");
const legacyArg = process.argv.find((a) => a.startsWith("--legacy-consent="));
const LEGACY_POLICY = legacyArg ? legacyArg.split("=")[1] : null;
const names = {
    users: process.env.USERS_COLLECTION || "users",
    respondents: process.env.RESPONDENTS_COLLECTION || "respondents",
    responses: process.env.RESPONSES_COLLECTION || "responses",
};

export async function migrate(db, { apply = APPLY, legacyPolicy = LEGACY_POLICY, log = console.log } = {}) {
    const report = { apply, renamedConcent: 0, accountStatus: 0, countryCodes: 0, unmappedCountries: {}, statusChangedAt: 0, legacyConsent: 0 };
    const users = db.collection(names.users), respondents = db.collection(names.respondents), responses = db.collection(names.responses);

    // 1
    const concentFilter = { concent: { $exists: true } };
    report.renamedConcent = await respondents.countDocuments(concentFilter);
    if (apply && report.renamedConcent) await respondents.updateMany(concentFilter, { $rename: { concent: "consent" } });

    for (const col of [users, respondents]) {
        // 2
        const missing = { accountStatus: { $exists: false } };
        report.accountStatus += await col.countDocuments(missing);
        if (apply) {
            await col.updateMany({ ...missing, isDeleted: true }, { $set: { accountStatus: "deleted" } });
            await col.updateMany(missing, { $set: { accountStatus: "active" } });
        }
        // 3
        const cursor = col.find({ "address.0": { $exists: true } }, { projection: { address: 1 } });
        for await (const doc of cursor) {
            const set = {};
            doc.address.forEach((a, i) => {
                if (a.countryCode || !a.country) return;
                const code = toCountryCode(a.country);
                if (code) set[`address.${i}.countryCode`] = code;
                else report.unmappedCountries[a.country] = (report.unmappedCountries[a.country] ?? 0) + 1;
            });
            if (Object.keys(set).length) {
                report.countryCodes += 1;
                if (apply) await col.updateOne({ _id: doc._id }, { $set: set });
            }
        }
        // 5
        if (legacyPolicy) {
            const f = { "terms.0": { $exists: true }, "consents.purpose": { $ne: "survey_invitations" } };
            report.legacyConsent += await col.countDocuments(f);
            if (apply) await col.updateMany(f, [
                { $set: { consents: { $concatArrays: [{ $ifNull: ["$consents", []] }, [{ purpose: "survey_invitations", granted: true, at: { $ifNull: ["$createdAt", "$$NOW"] }, policyVersion: legacyPolicy, channel: "legacy_terms" }]] }, "consentState.survey_invitations": true } },
            ]);
        }
    }

    // 4
    const noChange = { statusChangedAt: { $exists: false } };
    report.statusChangedAt = await responses.countDocuments(noChange);
    if (apply && report.statusChangedAt) await responses.updateMany(noChange, [{ $set: { statusChangedAt: { $ifNull: ["$updatedAt", "$createdAt", "$$NOW"] } } }]);

    log(JSON.stringify(report, null, 2));
    if (!apply) log("Dry run: nothing written. Re-run with --apply.");
    return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    if (!process.env.MONGO_URI) { console.error("Set MONGO_URI"); process.exit(1); }
    await mongoose.connect(process.env.MONGO_URI);
    try { await migrate(mongoose.connection.db); } finally { await mongoose.disconnect(); }
}
