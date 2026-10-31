/**
 * Route tests against a real MongoDB (set MONGO_TEST_URI; default mongodb://127.0.0.1:27099). Uses a throwaway
 * database named t2o_routes_test, which it drops. Needs dev dependencies express, supertest.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";
import { createSampledgeRouter } from "../routes/sampledge.js";
import User from "../model/User.js";
import Respondent from "../model/Respondent.js";
import Response from "../model/Response.js";
import SurveyProject from "../model/ProjectLaunch.js";
import Question from "../model/Question.js";
import Option from "../model/Option.js";
import Answers from "../model/Answers.js";
import { migrate } from "../migrations/2026-10-31-sampledge-fields.js";

const NOW = new Date("2026-10-31T12:00:00Z");
const dobForAge = (age) => new Date(Date.UTC(NOW.getUTCFullYear() - age, 0, 1));
const consent = (purposes) => ({ consents: purposes.map((p) => ({ purpose: p, granted: true, at: new Date("2026-01-01"), policyVersion: "v1" })), consentState: Object.fromEntries(["survey_invitations", "profiling", "client_sharing", "health_data"].map((p) => [p, purposes.includes(p)])) });
const person = (i, extra = {}) => ({
    _id: new mongoose.Types.ObjectId(), origin: "t2o.example", respondentID: `T2O-${i}`, name: { first: `First${i}`, last: `Secret${i}` },
    mail: `p${i}@example.com`, phone: `+1415555${String(i).padStart(4, "0")}`, gender: "Female", dob: dobForAge(30), timezone: "UTC", category: "b2c",
    address: [{ tag: "home", street: `${i} hidden street`, country: "usa", countryCode: "US", region: "US-CA", gps: { type: "Point", coordinates: [1, 2] } }],
    paymentMethod: { method: "paypal", details: { email: `pay${i}@example.com` } },
    accountStatus: "active", lastActiveAt: new Date("2026-10-01"), unsubscribedAt: null, deletionRequestedAt: null, isDeleted: false,
    ...consent(["survey_invitations", "client_sharing"]), ...extra,
});
const auth = (req, res, next) => (req.headers.authorization === "Bearer good" ? next() : res.status(401).json({ status: "error", message: "Unauthorized" }));
const app = (panel = "t2o", origin = "t2o.example") => { const a = express(); a.use("/s", createSampledgeRouter({ panel, authenticate: auth, originOf: () => origin, now: () => NOW })); return a; };
const as = (a) => ({ get: (u) => request(a).get(u).set("authorization", "Bearer good"), post: (u, b) => request(a).post(u).set("authorization", "Bearer good").send(b), put: (u, b) => request(a).put(u).set("authorization", "Bearer good").send(b) });
let people;

before(async () => {
    await mongoose.connect(`${process.env.MONGO_TEST_URI ?? "mongodb://127.0.0.1:27099"}/t2o_routes_test`);
    await mongoose.connection.db.dropDatabase();
    await Promise.all([User, Respondent, Response, SurveyProject, Question, Option, Answers].map((m) => m.init()));
    people = [
        person(1), person(2), person(3, { gender: "Male", dob: dobForAge(40) }),
        person(4, { dob: dobForAge(22), address: [{ tag: "h", country: "usa", countryCode: "US", region: "US-TX" }] }),
        person(5, { accountStatus: "deleted" }),                                  // never counted
        person(6, { ...consent([]) }),                                            // total but not reachable
        person(7, { lastActiveAt: new Date("2025-01-01") }),                      // inactive
        person(8, { address: [{ tag: "h", country: "india", countryCode: "IN" }] }),
        person(9, { origin: "mfr.example" }),                                     // other panel
    ];
    await User.collection.insertMany(people);
    await Question.collection.insertMany([
        { origin: "t2o.example", name: "car_ownership", label: "Do you own a car?", type: "radio", category: ["auto"] },
        { origin: "t2o.example", name: "home_phone", label: "Home phone", type: "phone", category: ["contact"] },
        { origin: "t2o.example", name: "about_you", label: "Tell us about you", type: "open end multiline", category: ["general"] },
    ]);
    await Option.collection.insertMany([
        { origin: "t2o.example", question: "car_ownership", label: "Yes", value: "yes" },
        { origin: "t2o.example", question: "car_ownership", label: "No", value: "no" },
    ]);
    await Answers.collection.insertMany([
        { origin: "t2o.example", user: String(people[0]._id), question: "car_ownership", answer: ["yes"] },
        { origin: "t2o.example", user: String(people[1]._id), question: "car_ownership", answer: ["no"] },
        { origin: "t2o.example", user: String(people[2]._id), question: "car_ownership", answer: ["yes"] },
        { origin: "t2o.example", user: String(people[0]._id), question: "about_you", answer: ["I am First1 Secret1 from 1 hidden street"] },
        { origin: "t2o.example", user: String(people[0]._id), question: "home_phone", answer: ["+14155550001"] },
    ]);
});
after(async () => { await mongoose.connection.db.dropDatabase(); await mongoose.disconnect(); });

test("needs auth, a panel and an origin resolver", async () => {
    assert.equal((await request(app()).get("/s/questions")).status, 401);
    assert.throws(() => createSampledgeRouter({ panel: "xyz", authenticate: auth, originOf: () => "o" }), /panel/);
    assert.throws(() => createSampledgeRouter({ panel: "t2o", originOf: () => "o" }), /authenticate/);
});

test("feasibility counts reachable panelists with breakdowns", async () => {
    const r = await as(app()).post("/s/feasibility", { country: "us", activeWithinDays: 90 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, "success");
    const d = r.body.data;
    assert.equal(d.total, 6, "excludes deleted, other country and other panel");
    assert.equal(d.active, 4, "excludes no-consent and inactive");
    assert.deepEqual(d.byGender, { female: 3, male: 1 });
    assert.deepEqual(d.byAgeBand, { "18-24": 1, "30-34": 2, "35-44": 1 });
});

test("feasibility filters: gender, age, region, profile question; bad filters are refused", async () => {
    const a = as(app());
    const f = async (filters) => (await a.post("/s/feasibility", { country: "US", filters })).body;
    assert.equal((await f([{ type: "gender", value: ["male"] }])).data.active, 1);
    assert.equal((await f([{ type: "age", value: { gte: 25, lte: 34 } }])).data.active, 3, "includes the inactive panelist: no activeWithinDays given");
    assert.equal((await f([{ type: "ageBand", value: ["18-24"] }])).data.active, 1);
    assert.equal((await f([{ type: "region", value: ["US-TX"] }])).data.active, 1);
    assert.equal((await f([{ type: "car_ownership", value: ["yes"] }])).data.active, 2);
    assert.equal((await f([{ type: "car_ownership", value: ["yes"] }, { type: "gender", value: ["female"] }])).data.active, 1);
    const bad = await a.post("/s/feasibility", { country: "US", filters: [{ type: "home_phone", value: ["x"] }] });
    assert.equal(bad.status, 400);
    assert.match(bad.body.message, /Unknown filter/, "contact-detail questions cannot be filtered on");
    assert.equal((await a.post("/s/feasibility", { filters: [] })).status, 400);
    assert.equal((await a.post("/s/feasibility", { country: "US", filters: [{ type: "gender", value: ["robot"] }] })).status, 400);
    assert.equal((await a.post("/s/feasibility", { country: "US", filters: [{ type: "respondentType", value: ["Patient"] }] })).status, 400);
});

test("project sync creates, updates, keeps the schedule, and refuses other projects' pids", async () => {
    const a = as(app());
    const body = { pid: "SE-1", name: "Car owners", markets: [{ marketID: "US-1", country: ["us"], filters: [{ type: "car_ownership", value: ["yes"] }], quotas: [{ quotaID: "F", label: "Female", filters: [{ type: "gender", value: ["female"] }], target: 2 }, { quotaID: "M", target: 2 }], completes: 4, loi: 12, ir: 35 }] };
    const c = await a.put("/s/project", body);
    assert.equal(c.status, 201, JSON.stringify(c.body));
    assert.deepEqual(c.body.data, { pid: "SE-1", status: "Drafted", markets: [{ marketID: "US-1", quotas: 2 }] });
    await SurveyProject.updateOne({ pid: "SE-1" }, { $set: { "markets.0.schedule": { batch: 50 }, status: "Live" } });
    const u = await a.put("/s/project", { ...body, name: "Car owners v2" });
    assert.equal(u.status, 200);
    const stored = await SurveyProject.findOne({ pid: "SE-1" }).lean();
    assert.equal(stored.name, "Car owners v2");
    assert.equal(stored.status, "Live", "Sampledge does not change status");
    assert.equal(stored.markets[0].schedule.batch, 50, "schedule kept");
    assert.equal(stored.markets[0].country[0], "US");
    assert.equal(stored.origin, "t2o.example");
    await SurveyProject.collection.insertOne({ origin: "t2o.example", pid: "OWN-1", source: "panel", markets: [] });
    assert.equal((await a.put("/s/project", { ...body, pid: "OWN-1" })).status, 409);
    assert.equal((await a.put("/s/project", { pid: "SE-2", markets: [{ marketID: "A" }, { marketID: "A" }] })).status, 400);
    const v = await a.put("/s/project", { pid: "SE-3", markets: [{ marketID: "A", quotas: [{ label: "no id" }] }] });
    assert.equal(v.status, 400);
    assert.match(v.body.message, /quotaID/);
});

test("project status and the response feed", async () => {
    const t = (m) => new Date(Date.UTC(2026, 9, 31, 11, m));
    const mk = (p, status, quotaID, start, end, changed) => ({ _id: new mongoose.Types.ObjectId(), origin: "t2o.example", user: p._id, survey: { slug: "car" }, project: { pid: "SE-1", marketID: "US-1", quotaID }, status, timeline: { start, end }, statusChangedAt: changed, points: 100, qualityReasons: status === "qualityterminate" ? ["speeder"] : [], deviceType: "mobile" });
    const docs = [
        mk(people[0], "complete", "F", t(0), t(12), t(12)),
        mk(people[1], "complete", "F", t(0), t(10), t(13)),
        mk(people[2], "complete", "M", t(0), t(14), t(14)),
        mk(people[3], "terminate", null, t(0), t(2), t(15)),
        mk(people[6], "qualityterminate", null, t(0), t(3), t(16)),
        mk(people[7], "invited", null, null, null, t(1)),
        { ...mk(people[8], "complete", "F", t(0), t(9), t(9)), origin: "mfr.example" },
    ];
    await Response.collection.insertMany(docs);
    const a = as(app());
    const s = await a.get("/s/project/SE-1");
    assert.equal(s.status, 200, JSON.stringify(s.body));
    const m = s.body.data.markets[0];
    assert.deepEqual(m.counts, { invited: 6, started: 5, complete: 3, terminate: 1, overquota: 0, qualityTerminate: 1, dropout: 0 });
    assert.equal(m.incidence, 0.75);
    assert.equal(m.medianLoiMinutes, 12);
    assert.deepEqual(m.quotas.map((q) => [q.quotaID, q.target, q.complete]), [["F", 2, 2], ["M", 2, 1]]);
    assert.equal((await a.get("/s/project/NOPE")).status, 404);
    assert.equal((await as(app("mfr", "mfr.example")).get("/s/project/SE-1")).status, 404, "other panel cannot see it");

    const p1 = await a.get("/s/project/SE-1/responses?limit=4");
    assert.equal(p1.status, 200);
    assert.deepEqual(p1.body.data.items.map((i) => i.status), ["invited", "complete", "complete", "complete"]);
    const p2 = await a.get(`/s/project/SE-1/responses?limit=4&cursor=${p1.body.data.nextCursor}`);
    assert.deepEqual(p2.body.data.items.map((i) => i.status), ["terminate", "qualityterminate"]);
    assert.equal(p2.body.data.nextCursor, null);
    const row = p1.body.data.items[1];
    assert.equal(row.respondentID, "T2O-1");
    assert.equal(row.loiMinutes, 12);
    assert.deepEqual(row.profile, { countryCode: "US", region: "US-CA", ageBand: "30-34", gender: "female", category: "b2c" });
    assert.deepEqual(p2.body.data.items[1].qualityReasons, ["speeder"]);
    const since = await a.get(`/s/project/SE-1/responses?since=${t(14).toISOString()}`);
    assert.equal(since.body.data.items.length, 2);
    assert.equal((await a.get("/s/project/SE-1/responses?cursor=garbage")).status, 400);
    const all = JSON.stringify([p1.body, p2.body]);
    for (const leak of ["Secret", "@example.com", "hidden street", "paypal", "+1415"]) assert.ok(!all.includes(leak), `leaked ${leak}`);
});

test("respondent profile: pseudonymous, no contact or free-text answers", async () => {
    const a = as(app());
    const r = await a.get("/s/respondent-profile/T2O-1");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const d = r.body.data;
    assert.equal(d.respondentID, "T2O-1");
    assert.equal(d.countryCode, "US");
    assert.deepEqual(d.answers, [{ question: "car_ownership", values: ["yes"] }], "phone and open-text answers left out");
    const text = JSON.stringify(r.body);
    for (const leak of ["Secret1", "First1", "p1@example.com", "hidden street", "paypal", "4155550001"]) assert.ok(!text.includes(leak), `leaked ${leak}`);
    for (const key of ["name", "mail", "phone", "dob", "address", "paymentMethod", "parent", "socials"]) assert.ok(!(key in d), `returned ${key}`);
    assert.equal((await a.get("/s/respondent-profile/T2O-5")).status, 404, "deleted accounts are not returned");
    assert.equal((await a.get("/s/respondent-profile/T2O-9")).status, 404, "other panel's respondent");
});

test("profile questions list leaves out contact and free-text questions", async () => {
    const r = await as(app()).get("/s/questions");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.questions.map((q) => q.name), ["car_ownership"]);
    assert.deepEqual(r.body.data.questions[0].options, [{ label: "Yes", value: "yes", isExclusive: false }, { label: "No", value: "no", isExclusive: false }]);
    assert.ok(r.body.data.builtIn.includes("gender"));
    assert.ok(!r.body.data.builtIn.includes("respondentType"));
    assert.equal((await as(app()).get("/s/questions?category=contact")).body.data.questions.length, 0);
});

test("MyHealthOpinions needs health-data consent to count or share", async () => {
    await Respondent.collection.insertMany([
        { origin: "mho.example", respondentID: "MHO-1", category: "Professional", gender: "Male", dob: dobForAge(45), email: "doc@example.com", phone: "+14155550101", address: [{ tag: "h", countryCode: "US" }], accountStatus: "active", ...consent(["survey_invitations", "health_data", "client_sharing"]), hcpVerification: { status: "verified", method: "licence_lookup" } },
        { origin: "mho.example", respondentID: "MHO-2", category: "Patient", gender: "Female", dob: dobForAge(50), email: "pat@example.com", phone: "+14155550102", address: [{ tag: "h", countryCode: "US" }], accountStatus: "active", ...consent(["survey_invitations"]) },
    ]);
    const a = as(app("mho", "mho.example"));
    const f = await a.post("/s/feasibility", { country: "US" });
    assert.equal(f.body.data.total, 2);
    assert.equal(f.body.data.active, 1);
    assert.equal((await a.post("/s/feasibility", { country: "US", filters: [{ type: "respondentType", value: ["Professional"] }] })).body.data.active, 1);
    const p = await a.get("/s/respondent-profile/MHO-1");
    assert.equal(p.body.data.respondentType, "Professional");
    assert.equal(p.body.data.hcpVerification.status, "verified");
    assert.ok(!JSON.stringify(p.body).includes("doc@example.com"));
});

test("migration on real MongoDB: dry run writes nothing, apply fixes data", async () => {
    const db = mongoose.connection.db;
    await db.collection("respondents").insertOne({ origin: "mho.example", respondentID: "MHO-OLD", phone: "+14155550103", email: "old@example.com", concent: { canShareGPS: true }, address: [{ country: "united kingdom" }], terms: ["t1"] });
    await db.collection("users").insertOne({ origin: "t2o.example", respondentID: "OLD", address: [{ country: "u.s.a." }, { country: "narnia" }], terms: ["t1"], isDeleted: true });
    await db.collection("responses").insertOne({ origin: "t2o.example", user: new mongoose.Types.ObjectId(), status: "complete", updatedAt: new Date("2026-05-05") });
    const dry = await migrate(db, { apply: false, log: () => {} });
    assert.equal(dry.renamedConcent, 1);
    assert.ok((await db.collection("respondents").findOne({ respondentID: "MHO-OLD" })).concent, "dry run changed nothing");
    const done = await migrate(db, { apply: true, legacyPolicy: "terms-2024", log: () => {} });
    assert.deepEqual(done.unmappedCountries, { narnia: 1 });
    const r = await db.collection("respondents").findOne({ respondentID: "MHO-OLD" });
    assert.equal(r.concent, undefined);
    assert.equal(r.consent.canShareGPS, true);
    assert.equal(r.address[0].countryCode, "GB");
    assert.equal(r.accountStatus, "active");
    assert.equal(r.consentState.survey_invitations, true);
    assert.equal(r.consents[0].channel, "legacy_terms");
    const u = await db.collection("users").findOne({ respondentID: "OLD" });
    assert.equal(u.accountStatus, "deleted");
    assert.equal(u.address[0].countryCode, "US");
    assert.equal(u.address[1].countryCode, undefined);
    const resp = await db.collection("responses").findOne({ updatedAt: new Date("2026-05-05") });
    assert.equal(resp.statusChangedAt.toISOString(), "2026-05-05T00:00:00.000Z");
    const again = await migrate(db, { apply: true, legacyPolicy: "terms-2024", log: () => {} });
    assert.equal(again.renamedConcent + again.accountStatus + again.statusChangedAt + again.legacyConsent, 0, "running twice changes nothing");
});
