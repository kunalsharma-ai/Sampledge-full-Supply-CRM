/**
 * SPSS system file (.sav) writer: uncompressed, little-endian, UTF-8, with variable labels, value
 * labels, long variable names and a weight variable. Written from the published format
 * description; no SPSS library is involved.
 */

export type SavVar =
  | { name: string; label: string; kind: 'numeric'; decimals?: number; values?: { value: number; label: string }[]; format?: 'F' | 'DATETIME' }
  | { name: string; label: string; kind: 'string'; width: number };
export type SavCell = number | string | null | undefined;

const SPSS_EPOCH_OFFSET = 12_219_379_200; // seconds from 1582-10-14 (SPSS day 0) to 1970-01-01
/** A JavaScript date as an SPSS DATETIME value. */
export const spssDate = (d: Date) => d.getTime() / 1000 + SPSS_EPOCH_OFFSET;

class Out {
  private parts: Buffer[] = [];
  i32(n: number) { const b = Buffer.alloc(4); b.writeInt32LE(n); this.parts.push(b); }
  f64(n: number) { const b = Buffer.alloc(8); b.writeDoubleLE(n); this.parts.push(b); }
  raw(b: Buffer) { this.parts.push(b); }
  /** Text in a fixed-width, space-padded field (truncated on a character boundary). */
  fixed(s: string, len: number) { this.parts.push(pad(fit(s, len), len)); }
  done() { return Buffer.concat(this.parts); }
}
/** UTF-8 bytes of s, cut to at most max bytes without splitting a character. */
function fit(s: string, max: number) {
  let b = Buffer.from(s, 'utf8');
  if (b.length <= max) return b;
  let end = max;
  while (end > 0 && (b[end] & 0xc0) === 0x80) end--;
  b = b.subarray(0, end);
  return b;
}
const pad = (b: Buffer, len: number) => Buffer.concat([b, Buffer.alloc(Math.max(0, len - b.length), 0x20)]);
const roundUp = (n: number, m: number) => Math.ceil(n / m) * m;
const fmt = (type: number, width: number, dec: number) => (type << 16) | (width << 8) | dec;

/** SPSS-safe long names (unique, start with a letter, ≤ 64 chars) and 8-byte short names. */
function names(vars: SavVar[]) {
  const longSeen = new Set<string>(), shortSeen = new Set<string>();
  return vars.map((v) => {
    let long = v.name.replace(/[^A-Za-z0-9_.@#$]/g, '_');
    if (!/^[A-Za-z@]/.test(long)) long = `V${long}`;
    long = long.replace(/[._]+$/, '').slice(0, 64) || 'V';
    let l = long, i = 1;
    while (longSeen.has(l.toUpperCase())) l = `${long.slice(0, 60)}_${i++}`;
    longSeen.add(l.toUpperCase());
    let short = l.toUpperCase().slice(0, 8), j = 1;
    while (shortSeen.has(short)) { const suf = String(j++); short = l.toUpperCase().slice(0, 8 - suf.length) + suf; }
    shortSeen.add(short);
    return { long: l, short };
  });
}

export function writeSav(vars: SavVar[], rows: SavCell[][], opts: { label?: string; weightVar?: string; now?: Date } = {}): Buffer {
  const nm = names(vars);
  // Dictionary positions in 8-byte units (strings > 8 take continuation slots).
  const slots = vars.map((v) => (v.kind === 'string' ? roundUp(Math.min(255, Math.max(1, v.width)), 8) / 8 : 1));
  const firstSlot: number[] = []; let acc = 0;
  slots.forEach((s) => { firstSlot.push(acc + 1); acc += s; });
  const caseSize = acc;
  const weightIdx = opts.weightVar ? vars.findIndex((v) => v.name === opts.weightVar) : -1;
  const now = opts.now ?? new Date();
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][now.getUTCMonth()];
  const two = (n: number) => String(n).padStart(2, '0');

  const o = new Out();
  // File header
  o.fixed('$FL2', 4);
  o.fixed('@(#) SPSS DATA FILE Sampledge', 60);
  o.i32(2); o.i32(caseSize); o.i32(0); o.i32(weightIdx >= 0 ? firstSlot[weightIdx] : 0); o.i32(rows.length); o.f64(100);
  o.fixed(`${two(now.getUTCDate())} ${mon} ${two(now.getUTCFullYear() % 100)}`, 9);
  o.fixed(`${two(now.getUTCHours())}:${two(now.getUTCMinutes())}:${two(now.getUTCSeconds())}`, 8);
  o.fixed(opts.label ?? '', 64);
  o.raw(Buffer.alloc(3));

  // Variable records
  vars.forEach((v, i) => {
    const width = v.kind === 'string' ? Math.min(255, Math.max(1, v.width)) : 0;
    const f = v.kind === 'string' ? fmt(1, width, 0) : v.format === 'DATETIME' ? fmt(22, 20, 0) : fmt(5, 8, v.decimals ?? 0);
    const label = fit(v.label, 255);
    o.i32(2); o.i32(width); o.i32(label.length ? 1 : 0); o.i32(0); o.i32(f); o.i32(f); o.fixed(nm[i].short, 8);
    if (label.length) { o.i32(label.length); o.raw(Buffer.concat([label, Buffer.alloc(roundUp(label.length, 4) - label.length, 0x20)])); }
    for (let k = 1; k < slots[i]; k++) { o.i32(2); o.i32(-1); o.i32(0); o.i32(0); o.i32(0); o.i32(0); o.fixed('', 8); }
  });

  // Value labels (numeric variables only)
  vars.forEach((v, i) => {
    if (v.kind !== 'numeric' || !v.values?.length) return;
    o.i32(3); o.i32(v.values.length);
    for (const vl of v.values) {
      o.f64(vl.value);
      const l = fit(vl.label, 120);
      const total = roundUp(l.length + 1, 8);
      o.raw(Buffer.concat([Buffer.from([l.length]), l, Buffer.alloc(total - 1 - l.length, 0x20)]));
    }
    o.i32(4); o.i32(1); o.i32(firstSlot[i]);
  });

  // Machine integer info (7/3), floating point info (7/4), long names (7/13), encoding (7/20)
  o.i32(7); o.i32(3); o.i32(4); o.i32(8);
  [20, 0, 0, -1, 1, 1, 2, 65001].forEach((n) => o.i32(n));
  o.i32(7); o.i32(4); o.i32(8); o.i32(3);
  o.f64(-Number.MAX_VALUE); o.f64(Number.MAX_VALUE); o.f64(-1.7976931348623155e308);
  const longNames = Buffer.from(nm.map((n) => `${n.short}=${n.long}`).join('\t'), 'utf8');
  o.i32(7); o.i32(13); o.i32(1); o.i32(longNames.length); o.raw(longNames);
  const enc = Buffer.from('UTF-8');
  o.i32(7); o.i32(20); o.i32(1); o.i32(enc.length); o.raw(enc);
  o.i32(999); o.i32(0);

  // Data, uncompressed: one 8-byte slot per numeric value; strings space-padded to their slots.
  for (const row of rows) {
    vars.forEach((v, i) => {
      const x = row[i];
      if (v.kind === 'string') o.raw(pad(fit(x === null || x === undefined ? '' : String(x), Math.min(255, Math.max(1, v.width))), slots[i] * 8));
      else o.f64(typeof x === 'number' && Number.isFinite(x) ? x : -Number.MAX_VALUE);
    });
  }
  return o.done();
}
