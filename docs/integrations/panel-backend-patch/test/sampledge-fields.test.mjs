/**
 * Tests for the Sampledge integration fields. Run from the backend root: node --test test/sampledge-fields.test.mjs
 * Needs dev dependency mingo@6 (in-memory aggregation). Uses your real utils/mongooseModel; if you want to
 * run it outside the backend, put test/mongooseModel.stub.js at utils/index.js.
 */
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { Aggregator } from "mingo";
import "mingo/init/system";
import User from "../model/User.js";
import Respondent from "../model/Respondent.js";
import Response, { RESPONSE_STATUS } from "../model/Response.js";
import SurveyProject from "../model/ProjectLaunch.js";
import { ageParts, ageBand, assertAdmin, dedupeKeyFor, reachableMatch, toCountryCode, toRespondentProfile, toResponseExport, projectStatus } from "../integration/index.js";

// Runs only the model's own pre-save hook (validation is skipped: the email MX lookup needs DNS).
const hook = (Model) => { const fn = Model.schema.s.hooks._pres.get("save").map((h) => h.fn).find((f) => String(f).includes("toCountryCode")); return (doc) => new Promise((res, rej) => { try { fn.call(doc, (e) => (e ? rej(e) : res())); } catch (e) { rej(e); } }); };
const runPreSave = { User: hook(User), Respondent: hook(Respondent) };
const baseUser = { name: { first: "Test", last: "Zyxwvu" }, gender: "Female", dob: new Date("1999-07-15"), mail: "x@example.com", timezone: "UTC", origin: "t2o", category: "b2c" };

test("age uses days, not months twice", () => {
    // Born 15 Jul 1999; on 10 Jul 2026 they are still 26, not 27.
    assert.deepEqual(ageParts("1999-07-15", new Date(2026, 6, 10)), { years: 26, month: 11, day: 25 });
    assert.equal(ageParts("1999-07-15", new Date(2026, 6, 15)).years, 27);
    assert.equal(ageBand("1999-07-15", new Date(2026, 6, 10)), "25-29");
    assert.equal(ageBand("1950-01-01", new Date(2026, 0, 1)), "65+");
    const u = new User(baseUser);
    assert.equal(typeof u.age.years, "number");
    assert.equal(u.isMinor, false);
    assert.equal(u.parentalConsentStatus, "not_required");
});

test("country free text maps to ISO codes, unknown stays null", async () => {
    assert.equal(toCountryCode(" United States "), "US");
    assert.equal(toCountryCode("usa"), "US");
    assert.equal(toCountryCode("uk"), "GB");
    assert.equal(toCountryCode("atlantis"), null);
    const u = new User({ ...baseUser, address: [{ tag: "home", country: "india", state: "maharashtra" }, { tag: "work", country: "atlantis" }] });
    await runPreSave.User(u);
    assert.equal(u.address[0].countryCode, "IN");
    assert.equal(u.address[1].countryCode, null);
    assert.ok(new User({ ...baseUser, address: [{ tag: "h", countryCode: "USA" }] }).validateSync()?.errors["address.0.countryCode"]);
});

test("consent history: latest decision wins, state is kept for queries", async () => {
    const u = new User({ ...baseUser, consents: [
        { purpose: "survey_invitations", granted: true, at: new Date("2026-01-01"), policyVersion: "v1" },
        { purpose: "survey_invitations", granted: false, at: new Date("2026-06-01"), policyVersion: "v2" },
        { purpose: "profiling", granted: true, at: new Date("2026-01-01"), policyVersion: "v1" },
    ] });
    await runPreSave.User(u);
    assert.equal(u.hasConsent("survey_invitations"), false);
    assert.equal(u.hasConsent("profiling"), true);
    assert.equal(u.hasConsent("client_sharing"), false);
    assert.equal(u.consentState.survey_invitations, false);
    assert.equal(u.consentState.profiling, true);
    assert.ok(new User({ ...baseUser, consents: [{ purpose: "marketing", granted: true, policyVersion: "v1" }] }).validateSync()?.errors["consents.0.purpose"]);
    const m = reachableMatch({ activeWithinDays: 90, now: new Date("2026-10-31T00:00:00Z") });
    assert.equal(m["consentState.survey_invitations"], true);
    assert.equal(m.lastActiveAt.$gte.toISOString(), "2026-08-02T00:00:00.000Z");
});

test("dedupe key: same person across panels, needs the secret", async () => {
    assert.equal(dedupeKeyFor("a@b.com", undefined), null);
    const k = dedupeKeyFor("Jane.Doe+t2o@gmail.com", "s");
    assert.equal(k, dedupeKeyFor("janedoe@googlemail.com", "s"));
    assert.notEqual(k, dedupeKeyFor("janedoe@gmail.com", "other"));
    process.env.PANEL_DEDUPE_SECRET = "s";
    const r = new Respondent({ ...baseUser, email: "janedoe@gmail.com", category: "Patient", phone: "14155552671" });
    await runPreSave.Respondent(r);
    assert.equal(r.dedupeKey, k);
    delete process.env.PANEL_DEDUPE_SECRET;
});

test("admin check accepts role or category, same allowed list as before", () => {
    assert.doesNotThrow(() => assertAdmin({ role: "admin" }));
    assert.doesNotThrow(() => assertAdmin({ category: "root" }));
    assert.throws(() => assertAdmin({ role: "respondent", category: "b2c" }), /Permission denied/);
    assert.throws(() => assertAdmin(null), /Permission denied/);
});

test("Respondent: consent field renamed, HCP verification, awaited saves", async () => {
    const r = new Respondent({ ...baseUser, email: "p@example.com", category: "Professional", consent: { canShareGPS: true }, hcpVerification: { method: "licence_lookup", status: "verified" } });
    assert.equal(r.consent.canShareGPS, true);
    assert.equal(r.validateSync()?.errors?.hcpVerification, undefined);
    let saved = false;
    r.save = async () => { await new Promise((x) => setTimeout(x, 5)); saved = true; return r; };
    await r.resetPassword({ role: "admin" }, "new-pass-123");
    assert.equal(saved, true, "resetPassword waits for the save");
});

test("Response: quality terminate is its own status and needs a reviewer for completes", async () => {
    const mk = (status) => { const r = new Response({ user: new mongoose.Types.ObjectId(), survey: { slug: "s1" }, status, timeline: { start: new Date() }, project: { pid: "P1", marketID: "US-1" } }); r.save = async () => r; return r; };
    const a = mk("started");
    await a.qualityTerminate(["speeder"]);
    assert.equal(a.status, "qualityterminate");
    assert.ok(a.timeline.end);
    const b = mk("complete");
    await assert.rejects(b.qualityTerminate(["duplicate"]), /reviewer/);
    await b.qualityTerminate(["duplicate"], "admin-7");
    assert.equal(b.reviewedBy, "admin-7");
    await assert.rejects(mk("started").qualityTerminate([]), /at least one/);
    await assert.rejects(mk("started").qualityTerminate(["vibes"]), /Unknown quality reason/);
    const c = mk("invited"); await c.complete(); assert.equal(c.status, "complete");
    await assert.rejects(c.terminate(), /Unable/);
    const bad = new Response({ user: new mongoose.Types.ObjectId(), status: "maybe" });
    assert.ok(bad.validateSync()?.errors?.status);
    assert.ok(RESPONSE_STATUS.includes("qualityterminate"));
});

test("serializers return no personal fields", () => {
    const u = new User({ ...baseUser, respondentID: "T2O-0001", phone: "14155552671", qualityScore: 91,
        address: [{ tag: "home", country: "usa", countryCode: "US", region: "US-CA", street: "1 main st", gps: { coordinates: [1, 2] } }],
        paymentMethod: { method: "paypal", details: { email: "pay@x.com" } }, parent: { name: { first: "P" } }, socials: [{ channel: "x", account: "@me" }],
        consents: [{ purpose: "client_sharing", granted: true, policyVersion: "v1" }, { purpose: "survey_invitations", granted: true, policyVersion: "v1" }],
        isVerified: { email: "verified" }, createdAt: new Date("2025-03-04") });
    const p = toRespondentProfile(u, "t2o", [{ question: "car_ownership", answer: ["yes"] }]);
    const text = JSON.stringify(p);
    for (const leak of ["Test", "Zyxwvu", "x@example.com", "4155552671", "1 main st", "paypal", "pay@x.com", "@me", "1999", "\"P\""]) assert.ok(!text.includes(leak), `leaked ${leak}`);
    assert.deepEqual(Object.keys(p).sort(), ["accountStatus", "ageBand", "answers", "category", "consents", "countryCode", "gender", "isMinor", "joinedMonth", "lastActiveMonth", "panel", "parentalConsent", "qualityScore", "region", "respondentID", "verified"]);
    assert.equal(p.countryCode, "US");
    assert.equal(p.verified.email, true);
    assert.deepEqual(p.answers, [{ question: "car_ownership", values: ["yes"] }]);
    assert.equal(p.joinedMonth, "2025-03");
    // no sharing consent -> no answers
    const noShare = new User({ ...baseUser, respondentID: "T2O-2" });
    assert.deepEqual(toRespondentProfile(noShare, "mfr", [{ question: "q", answer: ["a"] }]).answers, []);

    const mho = new Respondent({ ...baseUser, email: "doc@x.com", category: "Professional", respondentID: "MHO-1", hcpVerification: { status: "verified", method: "licence_lookup" },
        consents: [{ purpose: "client_sharing", granted: true, policyVersion: "v1" }] });
    const hp = toRespondentProfile(mho, "mho", [{ question: "specialty", answer: ["cardiology"] }]);
    assert.equal(hp.respondentType, "Professional");
    assert.equal(hp.hcpVerification.status, "verified");
    assert.deepEqual(hp.answers, [], "MHO answers need health-data consent too");

    const resp = new Response({ user: u._id, survey: { slug: "s1" }, status: "complete", project: { pid: "P1", marketID: "US-1", quotaID: "Q-F" }, timeline: { start: new Date("2026-10-31T11:46:10Z"), end: new Date("2026-10-31T11:58:00Z") }, points: 120, deviceType: "mobile" });
    const row = toResponseExport(resp, u, "t2o");
    assert.equal(row.loiMinutes, 11.8);
    assert.equal(row.respondentID, "T2O-0001");
    assert.equal(row.profile.countryCode, "US");
    assert.ok(!JSON.stringify(row).includes("x@example.com"));
});

test("project status counts per market and quota", async () => {
    const t = (min) => new Date(Date.UTC(2026, 9, 31, 12, min));
    const docs = [
        ...Array.from({ length: 3 }, (_, i) => ({ project: { pid: "P1", marketID: "US-1", quotaID: "F" }, status: "complete", timeline: { start: t(0), end: t(10 + i) } })),
        { project: { pid: "P1", marketID: "US-1", quotaID: "M" }, status: "complete", timeline: { start: t(0), end: t(20) } },
        { project: { pid: "P1", marketID: "US-1" }, status: "terminate", timeline: { start: t(0), end: t(2) } },
        { project: { pid: "P1", marketID: "US-1" }, status: "overquota", timeline: { start: t(0), end: t(1) } },
        { project: { pid: "P1", marketID: "US-1" }, status: "qualityterminate", timeline: { start: t(0), end: t(3) } },
        { project: { pid: "P1", marketID: "US-1" }, status: "started", timeline: { start: t(0), end: null } },
        { project: { pid: "P1", marketID: "US-1" }, status: "invited", timeline: { start: null, end: null } },
        { project: { pid: "P1", marketID: "IN-1" }, status: "complete", timeline: { start: t(0), end: t(9) } },
        { project: { pid: "P2", marketID: "US-1" }, status: "complete", timeline: { start: t(0), end: t(9) } },
    ];
    const fakeResponse = { aggregate: async (pipeline) => new Aggregator(pipeline).run(docs) };
    const fakeProject = { findOne: () => ({ lean: async () => ({ pid: "P1", status: "Live", markets: [
        { marketID: "US-1", completes: 400, quotas: [{ quotaID: "F", label: "Female", target: 200 }, { quotaID: "M", label: "Male", target: 200 }] },
        { marketID: "IN-1", completes: 100 },
    ] }) }) };
    const s = await projectStatus({ Response: fakeResponse, SurveyProject: fakeProject }, "P1");
    const us = s.markets[0];
    assert.deepEqual(us.counts, { invited: 9, started: 8, complete: 4, terminate: 1, overquota: 1, qualityTerminate: 1, dropout: 0 });
    assert.equal(us.incidence, 0.8);
    assert.equal(us.medianLoiMinutes, 11.5);
    assert.deepEqual(us.quotas.map((q) => [q.quotaID, q.complete]), [["F", 3], ["M", 1]]);
    assert.equal(us.lastCompleteAt, t(20).toISOString());
    assert.equal(s.markets[1].counts.complete, 1);
});

test("SurveyProject markets accept quotas", () => {
    const p = new SurveyProject({ pid: "P1", markets: [{ marketID: "US-1", quotas: [{ quotaID: "F", filters: [{ type: "gender", value: ["female"] }], target: 200 }] }] });
    assert.equal(p.validateSync(), undefined);
    assert.equal(p.markets[0].quotas[0].target, 200);
    assert.ok(new SurveyProject({ pid: "P1", markets: [{ marketID: "US-1", quotas: [{ target: 5 }] }] }).validateSync()?.errors);
});

test("migration dry run reports without writing", async () => {
    const { Query } = await import("mingo");
    const data = {
        users: [{ _id: 1, address: [{ country: "usa" }, { country: "atlantis" }], terms: ["v1"] }, { _id: 2, accountStatus: "active", address: [{ country: "uk", countryCode: "GB" }] }],
        respondents: [{ _id: 3, concent: { canShareGPS: true }, address: [{ country: "india" }] }],
        responses: [{ _id: 4, updatedAt: new Date() }, { _id: 5, statusChangedAt: new Date() }],
    };
    const writes = [];
    const col = (n) => ({
        countDocuments: async (f) => new Query(f).find(data[n]).all().length,
        find: (f) => new Query(f).find(data[n]).all(),
        updateMany: async () => writes.push(n), updateOne: async () => writes.push(n),
    });
    const r = await (await import("../migrations/2026-10-31-sampledge-fields.js")).migrate({ collection: col }, { apply: false, legacyPolicy: "terms-2024", log: () => {} });
    assert.deepEqual(writes, []);
    assert.equal(r.renamedConcent, 1);
    assert.equal(r.accountStatus, 2);
    assert.equal(r.countryCodes, 2);
    assert.deepEqual(r.unmappedCountries, { atlantis: 1 });
    assert.equal(r.statusChangedAt, 1);
    assert.equal(r.legacyConsent, 1);
});
