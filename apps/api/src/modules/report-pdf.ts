/**
 * PDF version of the survey report: the same content as the PowerPoint (title page with base and
 * exclusions, then each question) laid out for reading and printing. Every figure comes from
 * `surveyResults`; charts are drawn as plain bars so the file needs no fonts or images beyond
 * the PDF standard set.
 */
import PDFDocument from 'pdfkit';
import type { surveyResults } from '@sampledge/core';

type Results = ReturnType<typeof surveyResults> & { survey: { name: string; version: number }; flagged: number; rejected: number; excludedFlagged: boolean; synthetic?: number };

const INK = '#0B1020';
const MUTED = '#5B6478';
const LINE = '#D8DEEA';
const BLUE = '#246BFD';
const CYAN = '#0EB5D8';
const pct = (x: number) => `${Math.round(x * 100)}%`;
/** The standard PDF fonts cover Latin-1 only; replace the few symbols the app uses outside it. */
const latin = (s: string) => s.replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');

export function buildPdfReport(r: Results): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 56, right: 56 }, bufferPages: true, info: { Title: latin(`${r.survey.name}: results`), Producer: 'Sampledge', Creator: 'Sampledge' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res, rej) => { doc.on('end', () => res(Buffer.concat(chunks))); doc.on('error', rej); });

  const W = doc.page.width - 112;
  const left = 56;
  const bottom = () => doc.page.height - 56;
  const ensure = (h: number) => { if (doc.y + h > bottom()) doc.addPage(); };
  const text = (s: string, o: { size?: number; color?: string; bold?: boolean; gap?: number; width?: number; x?: number } = {}) => {
    doc.font(o.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(o.size ?? 10).fillColor(o.color ?? INK).text(latin(s), o.x ?? left, doc.y, { width: o.width ?? W });
    if (o.gap) doc.moveDown(o.gap);
  };

  // Title page
  doc.rect(0, 0, doc.page.width, 230).fill(INK);
  doc.y = 90;
  text(r.survey.name, { size: 26, bold: true, color: '#FFFFFF', gap: 0.3 });
  text('Survey results', { size: 15, color: '#9FB4FF' });
  doc.y = 270;
  const notes = [
    `Base: ${r.base.toLocaleString('en-US')} completed interviews (questionnaire v${r.survey.version})`,
    r.synthetic ? `${r.synthetic.toLocaleString('en-US')} of these are SYNTHETIC demo interviews, not real respondents` : null,
    r.weighted ? `Weighted (rim weighting); effective base ${r.effectiveBase.toLocaleString('en-US')}` : 'Unweighted',
    r.rejected ? `${r.rejected} rejected interview(s) excluded` : null,
    r.excludedFlagged ? `${r.flagged} quality-flagged interview(s) excluded` : r.flagged ? `Includes ${r.flagged} quality-flagged interview(s)` : null,
    r.banner ? `Columns by ${r.banner.id}: letters mark a column significantly higher than the lettered column (95%, two-proportion z-test, n >= 30)` : null,
    `Generated ${new Date().toISOString().slice(0, 10)} by Sampledge from recorded responses`,
  ].filter((x): x is string => !!x);
  for (const n of notes) text(n, { size: 11, color: n.includes('SYNTHETIC') ? '#B54708' : MUTED, bold: n.includes('SYNTHETIC'), gap: 0.4 });

  const bars = (rows: { label: string; pct: number }[], color: string) => {
    const labelW = W * 0.42, barW = W * 0.46;
    for (const row of rows) {
      doc.font('Helvetica').fontSize(9.5);
      const h = Math.max(14, doc.heightOfString(latin(row.label), { width: labelW - 8 }));
      ensure(h + 6);
      const y = doc.y;
      doc.fillColor(INK).text(latin(row.label), left, y, { width: labelW - 8 });
      doc.rect(left + labelW, y + 1, barW, 10).fill('#EEF2F8');
      if (row.pct > 0) doc.rect(left + labelW, y + 1, Math.max(1, barW * Math.min(1, row.pct)), 10).fill(color);
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(9.5).text(pct(row.pct), left + labelW + barW + 6, y, { width: W - labelW - barW - 6, align: 'right' });
      doc.y = y + h + 6;
    }
  };

  const table = (header: string[], rows: string[][], firstW = 0.34) => {
    const cols = header.length;
    const fw = W * (cols > 1 ? firstW : 1), cw = cols > 1 ? (W - fw) / (cols - 1) : 0;
    const x = (i: number) => (i === 0 ? left : left + fw + (i - 1) * cw);
    const w = (i: number) => (i === 0 ? fw : cw);
    const drawRow = (cells: string[], bold: boolean) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
      const h = Math.max(...cells.map((c, i) => doc.heightOfString(latin(c), { width: w(i) - 8 }))) + 8;
      ensure(h);
      const y = doc.y;
      cells.forEach((c, i) => doc.fillColor(bold ? MUTED : INK).text(latin(c), x(i) + 4, y + 4, { width: w(i) - 8, align: i === 0 ? 'left' : 'right' }));
      doc.moveTo(left, y + h).lineTo(left + W, y + h).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.y = y + h;
    };
    drawRow(header, true);
    rows.forEach((r) => drawRow(r, false));
  };

  // Questions flow down the page; a question starts a new page only when its heading and first
  // rows would not fit.
  doc.addPage();
  r.questions.forEach((q, qi) => {
    if (qi > 0) { doc.moveDown(1.6); ensure(150); if (doc.y > 56) { doc.moveTo(left, doc.y - 10).lineTo(left + W, doc.y - 10).lineWidth(0.5).strokeColor(LINE).stroke(); } }
    text(`${q.id}. ${q.text}`, { size: 14, bold: true, gap: 0.2 });
    text(`Base: ${q.base.toLocaleString('en-US')}${q.type === 'multi' ? ' - multiple answers allowed' : ''}`, { size: 9.5, color: MUTED, gap: 1 });
    if (q.type === 'single' || q.type === 'multi') {
      if (r.banner && q.rows[0]?.byBanner) {
        table(['', 'Total', ...r.banner.cols.map((c) => `${c.label} (${c.letter}) n=${c.base}`)], q.rows.map((row) => [row.label, pct(row.pct), ...row.byBanner!.map((c) => (c.base ? `${pct(c.pct)}${c.sig.length ? ` ${c.sig.join('')}` : ''}` : '-'))]));
      } else bars(q.rows, q.type === 'multi' ? CYAN : BLUE);
    } else if (q.type === 'numeric') {
      table(['Mean', 'Median', 'Min', 'Max'], [[q.mean, q.median, q.min, q.max].map((v) => String(v))], 0.25);
    } else if (q.type === 'nps') {
      text(`NPS ${q.nps > 0 ? '+' : ''}${q.nps}`, { size: 30, bold: true, color: BLUE, gap: 0.6 });
      bars([{ label: 'Promoters (9-10)', pct: q.promoters }, { label: 'Passives (7-8)', pct: q.passives }, { label: 'Detractors (0-6)', pct: q.detractors }], BLUE);
    } else if (q.type === 'matrix') {
      table(['', ...(q.rows[0]?.dist ?? []).map((d) => d.label)], q.rows.map((row) => [row.label, ...row.dist.map((d) => pct(d.pct))]), 0.3);
    } else if (q.type === 'text') {
      if (q.coded?.length) { text('Coded answers', { size: 10.5, bold: true, gap: 0.4 }); bars([...q.coded].sort((a, b) => b.pct - a.pct), CYAN); doc.moveDown(0.8); }
      text(`Verbatims (up to 8 of ${q.base}, unedited)`, { size: 10.5, bold: true, gap: 0.4 });
      for (const t of q.samples.slice(0, 8)) { ensure(20); text(`"${t}"`, { size: 9.5, gap: 0.35 }); }
      if (!q.samples.length) text('No answers', { size: 9.5, color: MUTED });
    }
  });

  // Footer on every page: survey name and page number.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - 36;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(latin(`${r.survey.name} - results${r.synthetic ? ' - includes synthetic demo data' : ''}`), left, y, { width: W * 0.8, lineBreak: false });
    doc.text(`${i + 1} / ${range.count}`, left, y, { width: W, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}
