/**
 * Text extraction from uploaded questionnaires: Word (.docx), Excel (.xlsx), PDF and plain text.
 * Files are processed in memory and never stored. Type is checked from the file's magic bytes,
 * not only its name.
 */
import { BadRequestException } from '@nestjs/common';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export async function extractText(fileName: string, base64: string): Promise<{ text: string; kind: string; pages?: number }> {
  const buf = Buffer.from(base64, 'base64');
  if (!buf.length) throw new BadRequestException('The file is empty');
  if (buf.length > MAX_UPLOAD_BYTES) throw new BadRequestException('Files up to 8 MB are supported');
  const ext = (fileName.toLowerCase().match(/\.([a-z0-9]+)$/) ?? [])[1] ?? '';
  const zip = buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const pdf = buf.subarray(0, 5).toString('latin1') === '%PDF-';

  if (ext === 'docx') {
    if (!zip) throw new BadRequestException('This is not a valid .docx file');
    const mammoth = await import('mammoth');
    const r = await mammoth.extractRawText({ buffer: buf });
    return { text: r.value, kind: 'docx' };
  }
  if (ext === 'xlsx') {
    if (!zip) throw new BadRequestException('This is not a valid .xlsx file');
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const lines: string[] = [];
    wb.eachSheet((ws) => {
      ws.eachRow((row) => {
        const cells = (row.values as unknown[]).slice(1).map((v) => (v && typeof v === 'object' && 'text' in (v as object) ? String((v as { text: unknown }).text) : v == null ? '' : String(v))).map((s) => s.trim()).filter(Boolean);
        if (cells.length) lines.push(cells.join(' '));
      });
    });
    return { text: lines.join('\n'), kind: 'xlsx' };
  }
  if (ext === 'pdf') {
    if (!pdf) throw new BadRequestException('This is not a valid PDF file');
    const { extractText: pdfText, getDocumentProxy } = await import('unpdf');
    const doc = await getDocumentProxy(new Uint8Array(buf));
    const r = await pdfText(doc, { mergePages: false });
    const pages = r.text as string[];
    return { text: pages.join('\n'), kind: 'pdf', pages: r.totalPages };
  }
  if (['txt', 'csv', 'md'].includes(ext)) {
    if (zip || pdf || buf.includes(0)) throw new BadRequestException('This does not look like a text file');
    return { text: buf.toString('utf8'), kind: ext };
  }
  throw new BadRequestException('Upload a .docx, .xlsx, .pdf, .txt, .csv or .md file. Legacy .doc and .xls are not supported: save them as .docx or .xlsx first.');
}
