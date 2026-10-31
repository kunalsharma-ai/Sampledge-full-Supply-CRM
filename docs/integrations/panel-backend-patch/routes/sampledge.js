/**
 * Routes Sampledge calls on each panel. Mount once per app:
 *
 *   import { createSampledgeRouter } from "./routes/sampledge.js";
 *   app.use("/api/v1/sampledge", createSampledgeRouter({
 *       panel: "t2o",                      // "t2o" | "mfr" | "mho"
 *       authenticate: appTokenMiddleware,  // your existing app-token check (required)
 *       originOf: (req) => req.origin,     // how your app resolves the tenant from the host (required)
 *   }));
 *
 * Routes (all answer in the {status, message, data} envelope):
 *   POST /feasibility                    counts for a country and filters
 *   PUT  /project                        create or update a project from Sampledge
 *   GET  /project/:pid                   counts per market and quota
 *   GET  /project/:pid/responses         response feed, oldest change first, ?since=&cursor=&limit=
 *   GET  /respondent-profile/:respondentID
 *   GET  /questions                      profile questions Sampledge can filter on, ?category=
 *
 * Nothing here sends invitations or changes a respondent; those stay on your existing routes, which
 * Sampledge calls only after a person approves. No route returns name, email, phone, date of birth,
 * address, GPS, payment or parent details.
 */
import express from "express";
import mongoose from "mongoose";
import User from "../model/User.js";
import Respondent from "../model/Respondent.js";
import Response from "../model/Response.js";
import SurveyProject from "../model/ProjectLaunch.js";
import Question from "../model/Question.js";
import Option from "../model/Option.js";
import Answers from "../model/Answers.js";
import { AGE_BANDS, envelope, projectStatus, reachableMatch, toRespondentProfile, toResponseExport } from "../integration/index.js";

const PANELS = ["t2o", "mfr", "mho"];
// Question types that hold contact details or free text; never offered as filters or returned as answers.
const PRIVATE_TYPES = ["open end single line", "open end multiline", "phone", "email", "zipcode", "document"];
const isPrivateType = (t) => PRIVATE_TYPES.includes(String(t ?? "").toLowerCase());
const BUILT_IN = ["gender", "age", "ageBand", "region", "category", "respondentType"];

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const yearsAgo = (n, now) => { const d = new Date(now); d.setFullYear(d.getFullYear() - n); return d; };
const asList = (v) => [].concat(v ?? []).map((x) => String(x));
const genderValue = (g) => { const s = String(g).toLowerCase(); return s === "male" ? "Male" : s === "female" ? "Female" : s === "other" ? "Other" : null; };

export function createSampledgeRouter({ panel, authenticate, originOf, models = {}, now = () => new Date() } = {}) {
    if (!PANELS.includes(panel)) throw new Error(`panel must be one of ${PANELS.join(", ")}`);
    if (typeof authenticate !== "function") throw new Error("authenticate middleware is required");
    if (typeof originOf !== "function") throw new Error("originOf(req) is required");
    const M = { User, Respondent, Response, SurveyProject, Question, Option, Answers, ...models };
    const People = panel === "mho" ? M.Respondent : M.User;
    const isHealth = panel === "mho";

    const router = express.Router();
    router.use(express.json({ limit: "1mb" }));
    router.use(authenticate);
    router.use((req, _res, next) => {
        const origin = originOf(req);
        if (!origin) return next(new HttpError(400, "Unknown panel host"));
        req.sampledgeOrigin = origin;
        next();
    });

    /** Question name -> {question, keys}; keys are what Answers and Options may store (name or id). */
    async function findQuestion(origin, name) {
        const q = await M.Question.findOne({ origin, name: String(name).toLowerCase(), isDeleted: { $ne: true } }).lean();
        if (!q || isPrivateType(q.type)) return null;
        return { question: q, keys: [q.name, String(q._id)] };
    }

    /** Translates Sampledge filters into a Mongo filter on User/Respondent. */
    async function peopleFilter(origin, { country, filters = [] }) {
        const t = now();
        const and = [{ origin }, { accountStatus: { $nin: ["deleted", "blocked"] } }, { isDeleted: { $ne: true } }];
        if (country) and.push({ "address.0.countryCode": String(country).toUpperCase() });
        for (const f of filters) {
            if (!f || typeof f.type !== "string") throw new HttpError(400, "Each filter needs a type");
            const v = f.value;
            switch (f.type) {
                case "gender": {
                    const g = asList(v).map(genderValue);
                    if (g.some((x) => !x)) throw new HttpError(400, "gender values are male, female or other");
                    and.push({ gender: { $in: g } });
                    break;
                }
                case "age": {
                    const gte = Number(v?.gte ?? 0), lte = Number(v?.lte ?? 120);
                    if (!Number.isFinite(gte) || !Number.isFinite(lte) || gte > lte) throw new HttpError(400, "age needs {gte, lte}");
                    and.push({ dob: { $lte: yearsAgo(gte, t), $gt: yearsAgo(lte + 1, t) } });
                    break;
                }
                case "ageBand": {
                    const ors = asList(v).map((b) => {
                        const band = AGE_BANDS.find(([lo, hi]) => b === `${lo}-${hi}` || b === `${lo}+`);
                        if (!band) throw new HttpError(400, `Unknown age band ${b}`);
                        return { dob: { $lte: yearsAgo(band[0], t), $gt: yearsAgo(band[1] + 1, t) } };
                    });
                    and.push({ $or: ors });
                    break;
                }
                case "region": and.push({ "address.0.region": { $in: asList(v) } }); break;
                case "category":
                    if (isHealth) throw new HttpError(400, "Use respondentType on MyHealthOpinions");
                    and.push({ category: { $in: asList(v).map((x) => x.toLowerCase()) } });
                    break;
                case "respondentType":
                    if (!isHealth) throw new HttpError(400, "respondentType applies to MyHealthOpinions only");
                    and.push({ category: { $in: asList(v) } });
                    break;
                default: {
                    const q = await findQuestion(origin, f.type);
                    if (!q) throw new HttpError(400, `Unknown filter or profile question: ${f.type}`);
                    const users = await M.Answers.distinct("user", { origin, question: { $in: q.keys }, answer: { $in: asList(v) } });
                    const ids = users.filter((u) => mongoose.isValidObjectId(u)).map((u) => new mongoose.Types.ObjectId(String(u)));
                    and.push({ _id: { $in: ids } });
                }
            }
        }
        return { $and: and };
    }

    router.post("/feasibility", wrap(async (req, res) => {
        const origin = req.sampledgeOrigin;
        const { country, filters, activeWithinDays } = req.body ?? {};
        if (!country) throw new HttpError(400, "country is required (ISO code, e.g. US)");
        if (filters !== undefined && !Array.isArray(filters)) throw new HttpError(400, "filters must be a list of {type, value}");
        const days = activeWithinDays === undefined ? undefined : Number(activeWithinDays);
        if (days !== undefined && !(days > 0)) throw new HttpError(400, "activeWithinDays must be a positive number");
        const base = await peopleFilter(origin, { country, filters });
        const reachable = { $and: [base, reachableMatch({ activeWithinDays: days, healthData: isHealth, now: now() })] };
        const t = now();
        // $bucket needs ascending boundaries: oldest band first, by date of birth.
        const bands = [...AGE_BANDS].reverse();
        const boundaries = [...bands.map(([, hi]) => yearsAgo(hi + 1, t)), new Date(yearsAgo(bands.at(-1)[0], t).getTime() + 1)];
        const [total, facets] = await Promise.all([
            People.countDocuments(base),
            People.aggregate([
                { $match: reachable },
                { $facet: {
                    active: [{ $count: "n" }],
                    byGender: [{ $group: { _id: "$gender", n: { $sum: 1 } } }],
                    byRegion: [{ $group: { _id: { $arrayElemAt: ["$address.region", 0] }, n: { $sum: 1 } } }],
                    byAgeBand: [{ $bucket: { groupBy: "$dob", boundaries, default: "other", output: { n: { $sum: 1 } } } }],
                } },
            ]),
        ]);
        const f = facets[0] ?? {};
        const toMap = (rows, key) => Object.fromEntries(rows.filter((r) => r._id !== null && r._id !== undefined).map((r) => [key(r._id), r.n]));
        const label = (i) => { const [lo, hi] = bands[i]; return hi >= 120 ? `${lo}+` : `${lo}-${hi}`; };
        res.json(envelope({
            country: String(country).toUpperCase(),
            total,
            active: f.active?.[0]?.n ?? 0,
            byGender: toMap(f.byGender ?? [], (g) => String(g).toLowerCase()),
            byAgeBand: toMap((f.byAgeBand ?? []).filter((r) => r._id !== "other"), (d) => label(boundaries.findIndex((b) => b.getTime() === new Date(d).getTime()))),
            byRegion: toMap(f.byRegion ?? [], String),
            activeWithinDays: days ?? null,
            asOf: t.toISOString(),
        }));
    }));

    router.put("/project", wrap(async (req, res) => {
        const origin = req.sampledgeOrigin;
        const b = req.body ?? {};
        if (!b.pid || typeof b.pid !== "string") throw new HttpError(400, "pid is required");
        if (!Array.isArray(b.markets) || !b.markets.length) throw new HttpError(400, "markets must list at least one market");
        const ids = b.markets.map((m) => m?.marketID);
        if (ids.some((x) => !x) || new Set(ids).size !== ids.length) throw new HttpError(400, "Each market needs a unique marketID");
        // Only these fields come from Sampledge; status and schedule stay under your control.
        const markets = b.markets.map((m) => ({
            marketID: m.marketID, country: asList(m.country).map((c) => c.toUpperCase()), targetGroup: m.targetGroup,
            filters: m.filters ?? [], quotas: m.quotas ?? [], softLaunch: m.softLaunch, cpi: m.cpi, loi: m.loi, ir: m.ir,
            completes: m.completes, links: m.links,
        }));
        let doc = await M.SurveyProject.findOne({ origin, pid: b.pid });
        const created = !doc;
        if (!doc) doc = new M.SurveyProject({ origin, pid: b.pid, source: "sampledge" });
        else if (doc.source && doc.source !== "sampledge") throw new HttpError(409, "This pid belongs to a project not created by Sampledge");
        // Keep each existing market's schedule when Sampledge updates the rest of it.
        const previous = new Map((doc.markets ?? []).map((m) => [m.marketID, m.schedule]));
        doc.set({ name: b.name, note: b.note, markets: markets.map((m) => ({ ...m, schedule: previous.get(m.marketID) })) });
        try { await doc.save(); } catch (e) {
            if (e instanceof mongoose.Error.ValidationError) throw new HttpError(400, Object.values(e.errors).map((x) => x.message).join("; "));
            throw e;
        }
        res.status(created ? 201 : 200).json(envelope({ pid: doc.pid, status: doc.status, markets: doc.markets.map((m) => ({ marketID: m.marketID, quotas: (m.quotas ?? []).length })) }, created ? "Project created" : "Project updated"));
    }));

    router.get("/project/:pid", wrap(async (req, res) => {
        const origin = req.sampledgeOrigin;
        const scoped = {
            SurveyProject: { findOne: (q) => M.SurveyProject.findOne({ ...q, origin }) },
            Response: { aggregate: (p) => M.Response.aggregate([{ $match: { origin } }, ...p]) },
        };
        const s = await projectStatus(scoped, req.params.pid);
        if (!s) throw new HttpError(404, "Unknown project");
        res.json(envelope(s));
    }));

    router.get("/project/:pid/responses", wrap(async (req, res) => {
        const origin = req.sampledgeOrigin;
        const limit = Math.min(Math.max(parseInt(req.query.limit ?? "100", 10) || 100, 1), 500);
        const q = { origin, "project.pid": req.params.pid };
        if (req.query.cursor) {
            let c;
            try { c = JSON.parse(Buffer.from(String(req.query.cursor), "base64url").toString()); } catch { throw new HttpError(400, "Bad cursor"); }
            if (!c?.t || !mongoose.isValidObjectId(c.id)) throw new HttpError(400, "Bad cursor");
            const t = new Date(c.t);
            q.$or = [{ statusChangedAt: { $gt: t } }, { statusChangedAt: t, _id: { $gt: new mongoose.Types.ObjectId(c.id) } }];
        } else if (req.query.since) {
            const since = new Date(String(req.query.since));
            if (isNaN(since.getTime())) throw new HttpError(400, "since must be an ISO date");
            q.statusChangedAt = { $gt: since };
        }
        const rows = await M.Response.find(q).sort({ statusChangedAt: 1, _id: 1 }).limit(limit + 1).lean();
        const page = rows.slice(0, limit);
        const people = await People.find({ origin, _id: { $in: page.map((r) => r.user) } }).lean();
        const byId = new Map(people.map((p) => [String(p._id), p]));
        const last = page.at(-1);
        res.json(envelope({
            items: page.map((r) => toResponseExport(r, byId.get(String(r.user)) ?? {}, panel)),
            nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ t: last.statusChangedAt, id: String(last._id) })).toString("base64url") : null,
        }));
    }));

    router.get("/respondent-profile/:respondentID", wrap(async (req, res) => {
        const origin = req.sampledgeOrigin;
        const person = await People.findOne({ origin, respondentID: req.params.respondentID }).lean();
        if (!person || person.accountStatus === "deleted" || person.isDeleted) throw new HttpError(404, "Unknown respondent");
        const raw = await M.Answers.find({ origin, user: String(person._id) }).select("+answer").lean();
        const qs = await M.Question.find({ origin, $or: [{ name: { $in: raw.map((a) => a.question) } }, { _id: { $in: raw.map((a) => a.question).filter((x) => mongoose.isValidObjectId(x)) } }] }).lean();
        const byKey = new Map(qs.flatMap((q) => [[q.name, q], [String(q._id), q]]));
        const answers = raw.filter((a) => byKey.has(a.question) && !isPrivateType(byKey.get(a.question).type)).map((a) => ({ question: byKey.get(a.question).name, answer: a.answer }));
        res.json(envelope(toRespondentProfile(person, panel, answers)));
    }));

    router.get("/questions", wrap(async (req, res) => {
        const origin = req.sampledgeOrigin;
        const q = { origin, isDeleted: { $ne: true }, type: { $nin: PRIVATE_TYPES } };
        if (req.query.category) q.category = String(req.query.category).toLowerCase();
        const questions = await M.Question.find(q).sort({ name: 1 }).lean();
        const opts = await M.Option.find({ origin, question: { $in: questions.flatMap((x) => [x.name, String(x._id)]) } }).sort({ _id: 1 }).lean();
        res.json(envelope({
            builtIn: BUILT_IN.filter((b) => (isHealth ? b !== "category" : b !== "respondentType")),
            ageBands: AGE_BANDS.map(([lo, hi]) => (hi >= 120 ? `${lo}+` : `${lo}-${hi}`)),
            questions: questions.map((x) => ({
                name: x.name, label: x.label, type: x.type, category: x.category ?? [], parent: x.parent ?? null,
                options: opts.filter((o) => o.question === x.name || o.question === String(x._id)).map((o) => ({ label: o.label, value: o.value, isExclusive: !!o.isExclusive })),
            })),
        }));
    }));

    // Errors in the same envelope. Internal details are logged, never sent.
    router.use((err, _req, res, _next) => {
        if (err instanceof HttpError) return res.status(err.status).json({ status: "error", message: err.message, data: null });
        if (err?.type === "entity.parse.failed") return res.status(400).json({ status: "error", message: "Body must be valid JSON", data: null });
        console.error("[sampledge]", err);
        res.status(500).json({ status: "error", message: "Internal error", data: null });
    });
    return router;
}

