// Test stand-in for the backend's utils/mongooseModel (the real one was not shared). Assumed behaviour:
// adds origin/isActive/isDeleted and timestamps, applies indexes, virtuals, `method` and `pre` hooks.
import mongoose from "mongoose";
export function mongooseModel(name, def, indexes = [], opts = {}) {
    const schema = new mongoose.Schema({ origin: { type: String }, isActive: { type: Boolean, default: true }, isDeleted: { type: Boolean, default: false }, ...def }, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });
    for (const [fields, o] of indexes) schema.index(fields, o);
    for (const [k, fn] of Object.entries(opts.virtuals ?? {})) schema.virtual(k).get(fn);
    for (const [k, fn] of Object.entries(opts.method ?? {})) schema.methods[k] = fn;
    for (const [k, fn] of Object.entries(opts.pre ?? {})) schema.pre(k, fn);
    return mongoose.models[name] ?? mongoose.model(name, schema);
}
