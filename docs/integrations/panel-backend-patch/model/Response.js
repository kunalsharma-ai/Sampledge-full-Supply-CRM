import mongoose from "mongoose";
import { mongooseModel } from "../utils/index.js";

/**
 * Statuses a response can have. "qualityterminate" is new: a respondent removed for quality (speeding,
 * straightlining, duplicate, geo mismatch, failed attention check), kept apart from "terminate" so
 * incidence and billing are right. Stored lowercase because the field lowercases its value.
 */
export const RESPONSE_STATUS = ["invited", "started", "complete", "terminate", "overquota", "qualityterminate", "dropout"];
export const QUALITY_REASONS = ["speeder", "straightliner", "duplicate", "geo_mismatch", "failed_attention", "open_end_quality", "other"];
const OPEN = [null, "", "dropout", "invited", "started"];

const methods = {
    async complete() {
        if (!OPEN.includes(this.status)) throw new Error("Unable to change status of your response");
        return this.setStatus("complete");
    },
    async terminate() {
        if (!OPEN.includes(this.status)) throw new Error("Unable to change status of your response");
        return this.setStatus("terminate");
    },
    async overquota() {
        if (!OPEN.includes(this.status)) throw new Error("Unable to change status of your response");
        return this.setStatus("overquota");
    },
    /**
     * Removes a response for quality. From an open response it can be automatic (e.g. a speeder check).
     * Reversing a complete removes someone's reward, so it needs the id of the person who reviewed it.
     */
    async qualityTerminate(reasons = [], reviewedBy = null) {
        const list = [].concat(reasons).filter(Boolean);
        if (!list.length) throw new Error("Give at least one quality reason");
        const bad = list.filter((r) => !QUALITY_REASONS.includes(r));
        if (bad.length) throw new Error(`Unknown quality reason: ${bad.join(", ")}`);
        if (this.status === "complete") {
            if (!reviewedBy) throw new Error("Removing a complete needs the reviewer's id");
        } else if (!OPEN.includes(this.status)) {
            throw new Error("Unable to change status of your response");
        }
        this.qualityReasons = list;
        this.reviewedBy = reviewedBy;
        return this.setStatus("qualityterminate");
    },
    async setStatus(status) {
        this.status = status;
        this.statusChangedAt = new Date();
        if (["complete", "terminate", "overquota", "qualityterminate"].includes(status) && !this.timeline?.end) {
            this.set("timeline.end", new Date());
        }
        await this.save();
        return this;
    }
};

export default mongooseModel(
    "Response",
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        survey: {
            name: { type: String },
            slug: { type: String },
        },
        // Which Sampledge project, market and quota this response counts toward (null for panel-only surveys).
        project: {
            pid: { type: String, trim: true, default: null },
            marketID: { type: String, trim: true, default: null },
            quotaID: { type: String, trim: true, default: null },
        },
        timeline: {
            start: { type: Date },
            end: { type: Date, required: false, default: null },
        },
        telemetry: [
            {
                key: { type: String },
                value: { type: String }
            }
        ],
        status: {
            type: String,
            trim: true,
            lowercase: true,
            default: "invited",
            // Older records with other values still load; only new writes are checked.
            validate: {
                validator: function (v) {
                    if (v === null || v === undefined || v === "") return true;
                    if (!this.isModified || !this.isModified("status")) return true;
                    return RESPONSE_STATUS.includes(v);
                },
                message: (p) => `${p.value} is not a valid response status`
            }
        },
        statusChangedAt: { type: Date, default: Date.now },
        qualityReasons: [{ type: String, enum: QUALITY_REASONS }],
        reviewedBy: { type: String, default: null },
        deviceType: { type: String, enum: ["desktop", "mobile", "tablet", "other", null], default: null },
        loi: {
            type: Number,
            default: 0
        },
        source: {
            type: String
        },
        points: {
            type: Number,
            required: true,
            default: 0
        },
        forReview: {
            type: mongoose.Schema.Types.Mixed
        },
        rating: {
            type: Number,
            default: 3
        }
    },
    [
        [
            {
                "survey.slug": 1,
                user: 1
            },
            {
                unique: 1
            }
        ],
        // Project status counts and the "changed since" response feed for Sampledge.
        [{ "project.pid": 1, "project.marketID": 1, status: 1 }, {}],
        [{ "project.pid": 1, statusChangedAt: -1 }, {}]
    ],
    {
        // Every other model passes methods as `method`; this one used `methods`. Both keys are given so the
        // methods register whichever one utils/mongooseModel reads. Keep one once you have checked.
        method: methods,
        methods
    }
);
