#!/usr/bin/env node
// Uploads approved entries + images from review_state.json into Supabase.
//
// - Knowledge entries go into `catholic_knowledge` (is_active=true).
// - Approved images are inserted into `catholic_images` with a `knowledge_id`
//   FK pointing back to the knowledge row.
//
// Image storage: by default we store the direct Wikimedia Commons URL as
// `image_url` — CC-BY / CC-BY-SA / PD content is legal to hotlink with
// attribution. Pass `--r2` to also copy each file to a Cloudflare R2 bucket
// (requires @aws-sdk/client-s3 and R2_* env vars).
//
// Usage:
//   SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=...  node 04-upload-approved.js review/review_state.json
//   Add --dry-run to preview what would be inserted.
//   Add --r2 to upload images to Cloudflare R2 (optional).

const fs = require("fs");
const path = require("path");

const DRY_RUN = process.argv.includes("--dry-run");
const USE_R2 = process.argv.includes("--r2");
const stateArg = process.argv.find((a, i) => i >= 2 && !a.startsWith("--"));
if (!stateArg) {
  console.error("Usage: node 04-upload-approved.js <review_state.json> [--dry-run] [--r2]");
  process.exit(1);
}
const STATE_PATH = path.resolve(stateArg);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

function slugForImage(entrySlug, img, i) {
  return `${entrySlug}-${i + 1}`;
}

function extractSummary(md) {
  const m = md.match(/##\s*Summary\s*\n([\s\S]*?)(?=\n##\s|\n*$)/i);
  if (!m) return null;
  return m[1].trim().replace(/\s+/g, " ").slice(0, 500);
}

function extractKeywords(md, fallback) {
  const set = new Set(fallback || []);
  const name = fallback && fallback[0];
  if (name) {
    set.add(name);
    set.add(name.toLowerCase());
  }
  // Names in bold in the markdown are decent keyword candidates.
  const bolds = md.match(/\*\*([^*\n]{3,40})\*\*/g) || [];
  for (const b of bolds) set.add(b.replace(/\*\*/g, "").trim());
  return Array.from(set).filter(Boolean).slice(0, 20);
}

function extractSources(md) {
  const m = md.match(/##\s*Sources\s*\n([\s\S]*?)(?=\n##\s|\n*$)/i);
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter((l) => l.length > 2);
}

async function supabaseInsert(table, rows, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${table}${options.onConflict ? `?on_conflict=${options.onConflict}` : ""}`;
  const prefer = ["return=representation"];
  if (options.onConflict) prefer.push("resolution=merge-duplicates");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: prefer.join(","),
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${table} insert ${res.status}: ${body.slice(0, 400)}`);
  }
  return res.json();
}

async function uploadToR2(/* img, key */) {
  // Intentionally a stub. Wire up @aws-sdk/client-s3 + R2 creds when ready.
  throw new Error("--r2 upload not implemented yet. Re-run without --r2 to use Commons URLs.");
}

function buildKnowledgeRow(entry) {
  const fm = entry.frontmatter || {};
  return {
    entity_type: fm.entity_type,
    entity_name: fm.entity_name,
    slug: entry.slug,
    location_city: fm.location_city || null,
    location_country: fm.location_country || null,
    date_occurred: fm.date_occurred || null,
    date_approved: fm.date_approved || null,
    approval_status: fm.approval_status || null,
    approving_authority: fm.approving_authority || null,
    content_markdown: entry.finalMarkdown,
    summary: extractSummary(entry.finalMarkdown),
    keywords: extractKeywords(entry.finalMarkdown, [fm.entity_name, fm.location_city, fm.location_country]),
    sources: extractSources(entry.finalMarkdown),
    is_active: true,
  };
}

function buildImageRow(entry, knowledgeId, img, i) {
  return {
    entity_type: entry.frontmatter.entity_type,
    entity_name: entry.frontmatter.entity_name,
    keywords: [entry.frontmatter.entity_name, entry.frontmatter.location_city].filter(Boolean).join(", "),
    image_url: img.r2Url || img.imageUrl,
    thumbnail_url: img.thumbnailUrl,
    attribution: img.artist || img.credit || `Wikimedia Commons: ${img.title}`,
    license_type: img.license,
    alt_text: img.description || img.title,
    knowledge_id: knowledgeId,
    approved: true,
  };
}

async function main() {
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  const approved = (state.entries || []).filter((e) => e.status === "approved");
  console.log(`${approved.length} approved entries (of ${state.entries.length})`);

  let inserted = 0;
  let imagesInserted = 0;

  for (const entry of approved) {
    const knowRow = buildKnowledgeRow(entry);
    if (DRY_RUN) {
      console.log(`DRY knowledge: ${entry.slug}  summary="${(knowRow.summary || "").slice(0, 80)}…"`);
    } else {
      const [row] = await supabaseInsert("catholic_knowledge", [knowRow], { onConflict: "slug" });
      inserted++;
      console.log(`✓ knowledge: ${entry.slug} (id=${row.id})`);

      const images = entry.approvedImages || [];
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (USE_R2) {
          const key = `knowledge/${entry.type}/${slugForImage(entry.slug, img, i)}`;
          img.r2Url = await uploadToR2(img, key);
        }
        await supabaseInsert("catholic_images", [buildImageRow(entry, row.id, img, i)]);
        imagesInserted++;
      }
      if (images.length) console.log(`    + ${images.length} image(s)`);
    }
  }

  console.log(`\nDone. Inserted ${inserted} knowledge rows, ${imagesInserted} images.`);
  if (DRY_RUN) console.log("(dry-run — nothing was written)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
