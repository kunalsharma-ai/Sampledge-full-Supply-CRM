/**
 * The objects the backend returns to Sampledge. Each one copies only allowed fields from the stored
 * document (an allowlist), so a field added to a model later is never exposed by accident.
 * Never returned: name, email, phone, date of birth, address and GPS, profile picture, payment
 * details, parent details, passwords and tokens, socials, referrer, notification identities.
 */
import { ageBand, ageParts, hasConsent } from "./fields.js";
import { toCountryCode } from "./country.js";

const iso = (d) => (d ? new Date(d).toISOString() : null);
const lower = (v) => (v ? String(v).toLowerCase() : null);
const primaryAddress = (doc) => (Array.isArray(doc?.address) && doc.address.length ? doc.address[0] : null);

function location(doc) {
    const a = primaryAddress(doc);
    return {
        countryCode: a?.countryCode ?? toCountryCode(a?.country) ?? null,
        region: a?.region ?? null,
    };
}

function minorInfo(doc) {
    const a = ageParts(doc?.dob);
    const isMinor = a ? a.years < 18 : null;
    let parentalConsent = "not_required";
    if (isMinor) parentalConsent = doc?.parent?.consent === true ? "granted" : doc?.parent?.consent === false ? "refused" : "pending";
    return { isMinor, parentalConsent };
}

const verified = (v) => ({
    email: v?.email === "verified",
    phone: v?.phone === "verified",
    video: v?.video === "verified",
    inPerson: v?.inPersonVisit === "verified",
});

/** The pseudonymous fields every respondent object shares. */
function baseProfile(doc, panel) {
    return {
        respondentID: doc?.respondentID ?? null,
        panel,
        ...location(doc),
        ageBand: ageBand(doc?.dob),
        gender: lower(doc?.gender),
    };
}

/**
 * Respondent profile for Sampledge.
 * @param doc     User (t2o, mfr) or Respondent (mho) document
 * @param panel   "t2o" | "mfr" | "mho"
 * @param answers optional [{question, answer: [..]}] from Answers (load with .select("+answer"))
 */
export function toRespondentProfile(doc, panel, answers = []) {
    const isHealth = panel === "mho";
    const consents = {
        invitations: hasConsent(doc, "survey_invitations"),
        profiling: hasConsent(doc, "profiling"),
        clientSharing: hasConsent(doc, "client_sharing"),
        ...(isHealth && { healthData: hasConsent(doc, "health_data") }),
    };
    // Profile answers go out only with consent to share; on MHO also with explicit health-data consent.
    const mayShareAnswers = consents.clientSharing && (!isHealth || consents.healthData);
    const out = {
        ...baseProfile(doc, panel),
        category: isHealth ? "healthcare" : lower(doc?.category),
        qualityScore: typeof doc?.qualityScore === "number" ? doc.qualityScore : null,
        verified: verified(doc?.isVerified),
        ...minorInfo(doc),
        joinedMonth: doc?.createdAt ? iso(doc.createdAt).slice(0, 7) : null,
        accountStatus: doc?.accountStatus ?? "active",
        lastActiveMonth: doc?.lastActiveAt ? iso(doc.lastActiveAt).slice(0, 7) : null,
        consents,
        answers: mayShareAnswers ? answers.map((a) => ({ question: a.question, values: [].concat(a.answer ?? []) })) : [],
    };
    if (isHealth) {
        out.respondentType = doc?.category ?? null; // Professional | Care Giver | Patient
        out.hcpVerification = doc?.category === "Professional" ? { status: doc?.hcpVerification?.status ?? "unverified", method: doc?.hcpVerification?.method ?? null } : null;
        delete out.isMinor; delete out.parentalConsent; // MHO has no minors flow
    }
    return out;
}

/**
 * One response row for Sampledge's response feed.
 * @param response Response document
 * @param user     the respondent's User/Respondent document (for the pseudonymous profile)
 */
export function toResponseExport(response, user, panel) {
    const start = response?.timeline?.start ?? null;
    const end = response?.timeline?.end ?? null;
    const loiMinutes = start && end ? Math.round(((new Date(end) - new Date(start)) / 60000) * 10) / 10 : (response?.loi || null);
    const p = baseProfile(user, panel);
    return {
        responseID: String(response?._id ?? ""),
        respondentID: p.respondentID,
        pid: response?.project?.pid ?? null,
        marketID: response?.project?.marketID ?? null,
        quotaID: response?.project?.quotaID ?? null,
        surveySlug: response?.survey?.slug ?? null,
        status: response?.status ?? null,
        qualityReasons: [...(response?.qualityReasons ?? [])],
        start: iso(start),
        end: iso(end),
        loiMinutes,
        deviceType: response?.deviceType ?? null,
        points: response?.points ?? 0,
        profile: { countryCode: p.countryCode, region: p.region, ageBand: p.ageBand, gender: p.gender, category: panel === "mho" ? user?.category ?? null : lower(user?.category) },
        updatedAt: iso(response?.statusChangedAt ?? response?.updatedAt),
    };
}

/** Wraps data in the backend's existing envelope. */
export const envelope = (data, message = "OK") => ({ status: "success", message, data });
