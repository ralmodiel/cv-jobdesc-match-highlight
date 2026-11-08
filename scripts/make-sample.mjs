// Builds public/sample-cv.docx (the "Try a sample" CV) from src/lib/sample.js: node scripts/make-sample.mjs [out.docx]
import { writeFileSync } from "node:fs";
import { AlignmentType, BorderStyle, Document, HeadingLevel, LevelFormat, Packer, Paragraph, Tab, TabStopType, TextRun } from "docx";
import { SAMPLE_CV as cv } from "../src/lib/sample.js";

const RIGHT = 10040; // text width in twips: Letter (12240) minus 1100 margins
const heading = (text) => new Paragraph({ text, heading: HeadingLevel.HEADING_1 });
const dated = (bold, rest, when) => new Paragraph({
  tabStops: [{ type: TabStopType.RIGHT, position: RIGHT }],
  spacing: { before: 160, after: 60 },
  children: [new TextRun({ text: bold, bold: true }), new TextRun(rest), new TextRun({ children: [new Tab(), when], color: "555555" })],
});
const bullet = (children) => new Paragraph({ numbering: { reference: "dots", level: 0 }, spacing: { after: 40 }, children });

const doc = new Document({
  creator: "CV Highlighter",
  title: `${cv.name} – CV`,
  styles: {
    default: { document: { run: { font: "Calibri", size: 21 }, paragraph: { spacing: { after: 80, line: 264 } } } },
    paragraphStyles: [
      { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", run: { size: 40, bold: true, color: "1F2A44" }, paragraph: { spacing: { after: 40 } } },
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 23, bold: true, color: "1F4E79", allCaps: true },
        paragraph: { spacing: { before: 280, after: 100 }, outlineLevel: 0, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "9DB3CC", space: 2 } } } },
    ],
  },
  numbering: {
    config: [{ reference: "dots", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] }],
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } },
    children: [
      new Paragraph({ text: cv.name, heading: HeadingLevel.TITLE }),
      new Paragraph({ children: [new TextRun({ text: cv.contact, color: "555555", size: 19 })] }),
      heading("Summary"),
      new Paragraph(cv.summary),
      heading("Experience"),
      ...cv.experience.flatMap((x) => [dated(x.role, ` — ${x.org}`, x.when), ...x.bullets.map((t) => bullet([new TextRun(t)]))]),
      heading("Skills"),
      ...cv.skills.map((s) => {
        const [label, rest] = s.split(/:\s*/);
        return bullet([new TextRun({ text: `${label}: `, bold: true }), new TextRun(rest)]);
      }),
      heading("Education"),
      ...cv.education.map((e) => dated(e.degree, `, ${e.org}`, e.when)),
    ],
  }],
});

const out = process.argv[2] || "public/sample-cv.docx";
writeFileSync(out, await Packer.toBuffer(doc));
console.log(`wrote ${out}`);
