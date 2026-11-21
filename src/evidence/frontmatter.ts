// Minimal frontmatter reader. Supports `key: value` pairs between `---`
// fences, with optional double quotes around the value. That is all the
// case files need, and it keeps the project free of a YAML dependency.

export interface ParsedDoc {
  data: Record<string, string>;
  body: string;
}

export function parseFrontmatter(source: string, label = "document"): ParsedDoc {
  const text = source.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) {
    throw new Error(`${label}: missing frontmatter (file must start with ---)`);
  }
  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    throw new Error(`${label}: frontmatter is not closed with ---`);
  }
  const head = text.slice(4, end);
  const body = text.slice(end + 4).replace(/^\n+/, "").trimEnd();
  const data: Record<string, string> = {};
  head.split("\n").forEach((line, i) => {
    if (!line.trim() || line.trim().startsWith("#")) return;
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      throw new Error(`${label}: cannot read frontmatter line ${i + 2}: "${line}"`);
    }
    let value = (m[2] ?? "").trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"');
    }
    data[m[1]!] = value;
  });
  return { data, body };
}
