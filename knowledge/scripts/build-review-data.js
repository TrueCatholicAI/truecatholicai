#!/usr/bin/env node
// Bundles all draft markdown + image candidates into a single review_data.json
// that the review dashboard (review/index.html) loads via fetch.
//
// Run after generating drafts and image candidates, before opening the dashboard.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DRAFTS_ROOT = path.join(ROOT, "drafts");
const DATA_DIR = path.join(ROOT, "data");
const OUT_FILE = path.join(ROOT, "review", "review_data.json");

const TYPES = [
  { key: "eucharistic", draftsDir: "eucharistic-miracles", candidatesFile: "image_candidates_eucharistic.json" },
  { key: "marian",      draftsDir: "marian-apparitions",   candidatesFile: "image_candidates_marian.json" },
];

function parseFrontmatter(raw) {
  if (!raw.startsWith("---")) return { meta: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: raw };
  const fmBlock = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\n+/, "");
  const meta = {};
  for (const line of fmBlock.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    let v = line.slice(idx + 1).trim();
    if (v === "null" || v === "") v = null;
    else if (v === "true") v = true;
    else if (v === "false") v = false;
    else if (v.startsWith('"') && v.endsWith('"')) {
      try { v = JSON.parse(v); } catch (_) { /* keep raw */ }
    }
    meta[k] = v;
  }
  return { meta, body };
}

function loadDrafts(draftsDir) {
  if (!fs.existsSync(draftsDir)) return [];
  return fs
    .readdirSync(draftsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const raw = fs.readFileSync(path.join(draftsDir, f), "utf8");
      const { meta, body } = parseFrontmatter(raw);
      return {
        slug: meta.slug || f.replace(/\.md$/, ""),
        frontmatter: meta,
        markdown: body,
      };
    });
}

function loadCandidates(candidatesFile) {
  const p = path.join(DATA_DIR, candidatesFile);
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function main() {
  const bundle = { generatedAt: new Date().toISOString(), entries: [] };

  for (const t of TYPES) {
    const drafts = loadDrafts(path.join(DRAFTS_ROOT, t.draftsDir));
    const candidates = loadCandidates(t.candidatesFile);
    for (const d of drafts) {
      bundle.entries.push({
        type: t.key,
        slug: d.slug,
        frontmatter: d.frontmatter,
        markdown: d.markdown,
        imageCandidates: (candidates[d.slug] && candidates[d.slug].candidates) || [],
      });
    }
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(bundle, null, 2) + "\n");
  console.log(`Bundled ${bundle.entries.length} entries → ${OUT_FILE}`);
}

main();
