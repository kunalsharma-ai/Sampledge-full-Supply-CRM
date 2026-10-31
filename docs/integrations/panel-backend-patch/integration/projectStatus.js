/**
 * Project status for Sampledge: counts per market and quota from Response, joined to the
 * SurveyProject's targets. One aggregation, no personal data.
 */
const COUNT_KEYS = { invited: "invited", started: "started", complete: "complete", terminate: "terminate", overquota: "overquota", qualityterminate: "qualityTerminate", dropout: "dropout" };

function median(xs) {
    const v = xs.filter((x) => typeof x === "number" && x > 0).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return Math.round((v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2) * 10) / 10;
}

/**
 * @param Response      the Response model
 * @param SurveyProject the SurveyProject model
 * @param pid           Sampledge project id
 * @returns the project status object, or null if the project is unknown
 */
export async function projectStatus({ Response, SurveyProject }, pid) {
    const project = await SurveyProject.findOne({ pid }).lean();
    if (!project) return null;
    const rows = await Response.aggregate([
        { $match: { "project.pid": pid } },
        {
            $group: {
                _id: { marketID: "$project.marketID", quotaID: "$project.quotaID", status: "$status" },
                n: { $sum: 1 },
                lastAt: { $max: "$timeline.end" },
                lois: { $push: { $cond: [{ $and: [{ $eq: ["$status", "complete"] }, { $ne: ["$timeline.end", null] }] }, { $divide: [{ $subtract: ["$timeline.end", "$timeline.start"] }, 60000] }, null] } },
            },
        },
    ]);
    const markets = (project.markets ?? []).map((m) => {
        const mine = rows.filter((r) => r._id.marketID === m.marketID);
        const counts = Object.fromEntries(Object.values(COUNT_KEYS).map((k) => [k, 0]));
        let lastCompleteAt = null;
        const lois = [];
        for (const r of mine) {
            const key = COUNT_KEYS[r._id.status];
            if (key) counts[key] += r.n;
            if (r._id.status === "complete") {
                lois.push(...r.lois);
                if (r.lastAt && (!lastCompleteAt || r.lastAt > lastCompleteAt)) lastCompleteAt = r.lastAt;
            }
        }
        // Everyone who started is counted as started: started-only plus every finished outcome.
        counts.started += counts.complete + counts.terminate + counts.overquota + counts.qualityTerminate + counts.dropout;
        counts.invited += counts.started;
        const screened = counts.complete + counts.terminate;
        return {
            marketID: m.marketID,
            status: m.status ?? project.status,
            target: m.completes ?? null,
            counts,
            medianLoiMinutes: median(lois),
            // Incidence = complete / (complete + terminate). Overquota and quality terminates are excluded.
            incidence: screened ? Math.round((counts.complete / screened) * 1000) / 1000 : null,
            quotas: (m.quotas ?? []).map((q) => ({
                quotaID: q.quotaID,
                label: q.label ?? null,
                target: q.target ?? null,
                complete: mine.filter((r) => r._id.quotaID === q.quotaID && r._id.status === "complete").reduce((a, r) => a + r.n, 0),
            })),
            lastCompleteAt: lastCompleteAt ? new Date(lastCompleteAt).toISOString() : null,
        };
    });
    return { pid, status: project.status, markets, asOf: new Date().toISOString() };
}
