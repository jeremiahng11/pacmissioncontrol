// Render a document's markdown deliverable as a Word-openable .doc file.
// We emit Word-flavored HTML (Word opens HTML with full formatting — headings,
// bold, and tables), which avoids a heavy docx dependency.

import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: false });

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

const STYLE = `
  body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #1f2937; line-height: 1.5; }
  h1 { font-size: 22pt; color: #111827; margin: 0 0 4pt; }
  h2 { font-size: 15pt; color: #1f2937; margin: 18pt 0 6pt; border-bottom: 1px solid #d1d5db; padding-bottom: 3pt; }
  h3 { font-size: 12.5pt; color: #374151; margin: 12pt 0 4pt; }
  p { margin: 0 0 8pt; }
  ul, ol { margin: 0 0 8pt 18pt; }
  li { margin: 0 0 3pt; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0 12pt; }
  th, td { border: 1px solid #9ca3af; padding: 6pt 8pt; text-align: left; vertical-align: top; font-size: 10pt; }
  th { background: #eef2ff; font-weight: bold; }
  tr:nth-child(even) td { background: #f9fafb; }
  .meta { color: #6b7280; font-size: 10pt; margin: 0 0 14pt; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 14pt 0; }
`;

export function toWordDoc({ title, subtitle, markdown }) {
  const body = marked.parse(markdown || "");
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${esc(title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>${STYLE}</style></head>
<body>
<h1>${esc(title)}</h1>
${subtitle ? `<div class="meta">${esc(subtitle)}</div>` : ""}
${body}
</body></html>`;
}

export function safeFilename(name) {
  return (String(name || "document").replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "document") + ".doc";
}
