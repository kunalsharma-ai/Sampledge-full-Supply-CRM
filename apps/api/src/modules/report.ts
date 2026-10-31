/**
 * PowerPoint report (bar charts list options bottom-up in PowerPoint, so data is passed reversed).
 * from survey results: a title slide with the base and exclusions, then one
 * slide per question (bar charts for choice questions, a summary table for numeric and NPS).
 * Every figure comes from `surveyResults`; nothing is written that the data does not support.
 */
import PptxGenJS from 'pptxgenjs';
import type { surveyResults } from '@sampledge/core';

type Results = ReturnType<typeof surveyResults> & { survey: { name: string; version: number }; flagged: number; rejected: number; excludedFlagged: boolean; synthetic?: number };

const INK = '0B1020';
const MUTED = '5B6478';
const BLUE = '246BFD';
const CYAN = '0EB5D8';
const pct = (x: number) => `${Math.round(x * 100)}%`;

export async function buildReport(r: Results): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = `${r.survey.name}: results`;
  pptx.company = 'Sampledge';

  const title = pptx.addSlide();
  title.background = { color: INK };
  title.addText(r.survey.name, { x: 0.6, y: 2.2, w: 12, h: 1, fontSize: 36, bold: true, color: 'FFFFFF', fontFace: 'Arial' });
  title.addText('Survey results', { x: 0.6, y: 3.1, w: 12, h: 0.6, fontSize: 20, color: '9FB4FF', fontFace: 'Arial' });
  const notes = [
    `Base: ${r.base.toLocaleString('en-US')} completed interviews (questionnaire v${r.survey.version})`,
    r.synthetic ? `${r.synthetic.toLocaleString('en-US')} of these are SYNTHETIC demo interviews, not real respondents` : null,
    r.weighted ? `Weighted (rim weighting); effective base ${r.effectiveBase.toLocaleString('en-US')}` : 'Unweighted',
    r.rejected ? `${r.rejected} rejected interview(s) excluded` : null,
    r.excludedFlagged ? `${r.flagged} quality-flagged interview(s) excluded` : r.flagged ? `Includes ${r.flagged} quality-flagged interview(s)` : null,
    r.banner ? `Columns by ${r.banner.id}: letters mark a column significantly higher than the lettered column (95%, two-proportion z-test, n ≥ 30)` : null,
    `Generated ${new Date().toISOString().slice(0, 10)} by Sampledge from recorded responses`,
  ].filter(Boolean).join('\n');
  title.addText(notes, { x: 0.6, y: 4.3, w: 12, h: 2, fontSize: 13, color: 'C9D2E8', fontFace: 'Arial', valign: 'top' });

  for (const q of r.questions) {
    const s = pptx.addSlide();
    s.addText(`${q.id}. ${q.text}`, { x: 0.5, y: 0.3, w: 12.3, h: 0.9, fontSize: 20, bold: true, color: INK, fontFace: 'Arial', valign: 'top', fit: 'shrink' });
    s.addText(`Base: ${q.base.toLocaleString('en-US')}${q.type === 'multi' ? ' · multiple answers allowed' : ''}`, { x: 0.5, y: 1.15, w: 12.3, h: 0.35, fontSize: 11, color: MUTED, fontFace: 'Arial' });
    if (q.type === 'single' || q.type === 'multi') {
      if (r.banner && q.rows[0]?.byBanner) {
        const header = [{ text: '' }, { text: 'Total' }, ...r.banner.cols.map((c) => ({ text: `${c.label} (${c.letter})\nn=${c.base}` }))];
        const rows = q.rows.map((row) => [{ text: row.label }, { text: pct(row.pct) }, ...row.byBanner!.map((c) => ({ text: `${pct(c.pct)}${c.sig.length ? ` ${c.sig.join('')}` : ''}` }))]);
        s.addTable([header, ...rows], { x: 0.5, y: 1.7, w: 12.3, fontSize: 11, fontFace: 'Arial', color: INK, border: { type: 'solid', color: 'D8DEEA', pt: 0.5 }, fill: { color: 'FFFFFF' }, autoPage: true });
      } else {
        s.addChart(pptx.ChartType.bar, [{ name: q.id, labels: [...q.rows].reverse().map((x) => x.label), values: [...q.rows].reverse().map((x) => Math.round(x.pct * 1000) / 10) }], {
          x: 0.5, y: 1.6, w: 12.3, h: 5.5, barDir: 'bar', chartColors: [q.type === 'multi' ? CYAN : BLUE], showValue: true, dataLabelFormatCode: '0"%"', valAxisMaxVal: 100, valAxisHidden: true, catAxisLabelFontSize: 12, dataLabelFontSize: 11,
        });
      }
    } else if (q.type === 'numeric') {
      s.addTable([[{ text: 'Mean' }, { text: 'Median' }, { text: 'Min' }, { text: 'Max' }], [{ text: String(q.mean) }, { text: String(q.median) }, { text: String(q.min) }, { text: String(q.max) }]], { x: 0.5, y: 1.8, w: 8, fontSize: 16, fontFace: 'Arial', color: INK, border: { type: 'solid', color: 'D8DEEA', pt: 0.5 } });
    } else if (q.type === 'nps') {
      s.addText(`NPS ${q.nps > 0 ? '+' : ''}${q.nps}`, { x: 0.5, y: 1.8, w: 5, h: 1.2, fontSize: 48, bold: true, color: BLUE, fontFace: 'Arial' });
      s.addChart(pptx.ChartType.bar, [{ name: 'Share', labels: ['Detractors (0–6)', 'Passives (7–8)', 'Promoters (9–10)'], values: [q.detractors, q.passives, q.promoters].map((x) => Math.round(x * 1000) / 10) }], { x: 0.5, y: 3.2, w: 12.3, h: 3.8, barDir: 'bar', chartColors: ['F04438', 'F5A524', '13C996'], showValue: true, dataLabelFormatCode: '0"%"', valAxisHidden: true, valAxisMaxVal: 100 });
    } else if (q.type === 'matrix') {
      const header = [{ text: '' }, ...(q.rows[0]?.dist ?? []).map((d) => ({ text: d.label }))];
      s.addTable([header, ...q.rows.map((row) => [{ text: row.label }, ...row.dist.map((d) => ({ text: pct(d.pct) }))])], { x: 0.5, y: 1.7, w: 12.3, fontSize: 11, fontFace: 'Arial', color: INK, border: { type: 'solid', color: 'D8DEEA', pt: 0.5 }, autoPage: true });
    } else if (q.type === 'text' && q.coded?.length) {
      const coded = [...q.coded].sort((a, b) => a.pct - b.pct);
      s.addChart(pptx.ChartType.bar, [{ name: q.id, labels: coded.map((x) => x.label), values: coded.map((x) => Math.round(x.pct * 1000) / 10) }], {
        x: 0.5, y: 1.6, w: 12.3, h: 5.5, barDir: 'bar', chartColors: [CYAN], showValue: true, dataLabelFormatCode: '0"%"', valAxisMaxVal: 100, valAxisHidden: true, catAxisLabelFontSize: 12, dataLabelFontSize: 11,
      });
    } else if (q.type === 'text') {
      s.addText(q.samples.slice(0, 8).map((t) => `“${t}”`).join('\n') || 'No answers', { x: 0.5, y: 1.7, w: 12.3, h: 5.3, fontSize: 13, color: INK, fontFace: 'Arial', valign: 'top' });
      s.addText(`Showing up to 8 of ${q.base} verbatims, unedited.`, { x: 0.5, y: 7.0, w: 12.3, h: 0.3, fontSize: 10, color: MUTED, fontFace: 'Arial' });
    }
  }
  return (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
}
