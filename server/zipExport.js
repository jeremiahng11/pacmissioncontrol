// Package a code deliverable into a downloadable .zip. Orbit (Development) is
// asked to emit each file with a "===== FILE: path =====" marker before its
// code fence; we also fall back to common filename-before-fence patterns.

import JSZip from "jszip";

export function extractFiles(md) {
  const text = md || "";
  const files = [];

  // 1) Explicit markers (most reliable).
  const markerRe = /=+\s*FILE:\s*(.+?)\s*=+\s*\n```[^\n]*\n([\s\S]*?)```/g;
  let m;
  while ((m = markerRe.exec(text))) files.push({ path: m[1].trim(), content: m[2].replace(/\n$/, "") });
  if (files.length) return dedupe(files);

  // 2) Fallback: a filename on the line just before a fenced block.
  const blockRe = /(^|\n)([^\n]*)\n```([^\n]*)\n([\s\S]*?)```/g;
  while ((m = blockRe.exec(text))) {
    const prev = m[2].trim();
    const content = m[4].replace(/\n$/, "");
    let path = null;
    const bt = prev.match(/`([\w./-]+\.[a-zA-Z0-9]+)`/);
    const colon = prev.match(/(?:file|path)\s*[:=]\s*([\w./-]+\.[a-zA-Z0-9]+)/i);
    const heading = prev.match(/^#{1,6}\s+`?([\w./-]+\.[a-zA-Z0-9]+)`?/);
    if (bt) path = bt[1];
    else if (colon) path = colon[1];
    else if (heading) path = heading[1];
    else if (/^[\w./-]+\.[a-zA-Z0-9]+$/.test(prev)) path = prev;
    if (path) files.push({ path, content });
  }
  return dedupe(files);
}

function dedupe(files) {
  const seen = new Set();
  return files.filter((f) => { const k = f.path; if (seen.has(k)) return false; seen.add(k); return true; });
}

function safePath(p) {
  return String(p).replace(/^[/\\]+/, "").replace(/\.\.[/\\]/g, "").replace(/[^\w./-]/g, "_").slice(0, 200) || "file.txt";
}

export async function buildZip(files, title, fullMarkdown) {
  const zip = new JSZip();
  if (files.length) {
    for (const f of files) zip.file(safePath(f.path), f.content);
    // Always include the full deliverable for context.
    zip.file("DELIVERABLE.md", fullMarkdown || "");
  } else {
    zip.file("DELIVERABLE.md", fullMarkdown || "(no content)");
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export const hasCode = (md) => /```/.test(md || "");

// All fenced code blocks (used when there are no explicit filenames).
export function extractCodeBlocks(md) {
  const re = /```([^\n]*)\n([\s\S]*?)```/g;
  const out = [];
  let m;
  while ((m = re.exec(md || ""))) out.push({ lang: String(m[1] || "").trim().toLowerCase().split(/\s+/)[0], content: m[2].replace(/\n$/, "") });
  return out;
}

const LANG_EXT = {
  html: "html", htm: "html", js: "js", javascript: "js", jsx: "jsx", ts: "ts", typescript: "ts", tsx: "tsx",
  py: "py", python: "py", dart: "dart", json: "json", css: "css", scss: "scss", java: "java", go: "go", golang: "go",
  rb: "rb", ruby: "rb", php: "php", yaml: "yml", yml: "yml", sh: "sh", bash: "sh", shell: "sh", sql: "sql",
  xml: "xml", md: "md", markdown: "md", c: "c", cpp: "cpp", "c++": "cpp", cs: "cs", csharp: "cs", rs: "rs",
  rust: "rs", kt: "kt", kotlin: "kt", swift: "swift", vue: "vue", svelte: "svelte", toml: "toml", dockerfile: "dockerfile",
  text: "txt", txt: "txt",
};
export const langExt = (lang) => LANG_EXT[lang] || "txt";

const MIME = {
  html: "text/html", css: "text/css", js: "text/javascript", jsx: "text/javascript", ts: "text/typescript",
  json: "application/json", xml: "application/xml", svg: "image/svg+xml", md: "text/markdown",
};
export const mimeForExt = (ext) => MIME[ext] || "text/plain; charset=utf-8";
export const baseName = (p) => String(p).split(/[/\\]/).pop() || "file.txt";
export const extOf = (name) => (String(name).split(".").pop() || "txt").toLowerCase();
