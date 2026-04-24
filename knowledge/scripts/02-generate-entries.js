#!/usr/bin/env node
// Batch-generates draft knowledge entries via Claude Haiku over OpenRouter.
//
// Drafts are ALWAYS reviewed by Michael before upload. AI is a starting point,
// not the source of truth. The prompt instructs the model to omit anything it
// is unsure about rather than fabricate.
//
// Usage:
//   OPENROUTER_API_KEY=sk-or-...  node 02-generate-entries.js eucharistic
//   OPENROUTER_API_KEY=sk-or-...  node 02-generate-entries.js marian
//   OPENROUTER_API_KEY=sk-or-...  node 02-generate-entries.js eucharistic --limit 20
//   OPENROUTER_API_KEY=sk-or-...  node 02-generate-entries.js eucharistic --only lanciano,siena
//
// Skips entries that already have a draft file unless --force is passed.

const fs = require("fs");
const path = require("path");

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "anthropic/claude-haiku-4.5";
const RATE_LIMIT_MS = 5000;
// OpenRouter Haiku pricing (Apr 2026): $1/M input, $5/M output. Used for cost
// estimate only — keep in sync with pricing page if it changes.
const COST_PER_MTOK_IN = 1.0;
const COST_PER_MTOK_OUT = 5.0;

const TYPES = {
  eucharistic: {
    indexFile: "acutis_index.json",
    draftsDir: "eucharistic-miracles",
    label: "Eucharistic Miracle",
  },
  marian: {
    indexFile: "marian_index.json",
    draftsDir: "marian-apparitions",
    label: "Marian Apparition",
  },
};

const DATA_DIR = path.join(__dirname, "..", "data");
const DRAFTS_ROOT = path.join(__dirname, "..", "drafts");

function parseArgs(argv) {
  const args = { type: null, limit: null, only: null, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (TYPES[a]) args.type = a;
    else if (a === "--limit") args.limit = parseInt(argv[++i], 10);
    else if (a === "--only") args.only = argv[++i].split(",").map((s) => s.trim());
    else if (a === "--force") args.force = true;
  }
  if (!args.type) {
    console.error(`Usage: node 02-generate-entries.js <${Object.keys(TYPES).join("|")}> [--limit N] [--only slug1,slug2] [--force]`);
    process.exit(1);
  }
  return args;
}

function buildPrompt(entry, typeCfg) {
  const label = typeCfg.label;
  const location = [entry.city, entry.country].filter(Boolean).join(", ") || entry.country || "unknown location";
  const date = entry.date || "unknown date";

  const system =
    "You are a Catholic historian writing reference-library entries. Use only well-documented historical facts. " +
    "Include scientific investigation results where available and cite the institution that performed them. " +
    "If you are unsure about a specific detail — a date, a name, a measurement — OMIT it rather than guessing. " +
    "Do not fabricate. Do not speculate. Do not editorialize. Neutral, factual, reverent tone. " +
    "Output raw markdown only — no preamble, no closing remarks, no code fences.";

  const user = [
    `Write a knowledge-library entry for the ${label} of ${entry.name}, ${location}, ${date}.`,
    "",
    "Use exactly these sections, in this order, as H2 headings:",
    "",
    "## Summary",
    "Two or three sentences that capture the core of what happened and why it matters.",
    "",
    "## Historical Account",
    "What happened, who was involved, when. Primary witnesses and contemporary records.",
    "",
    "## Evidence and Investigation",
    "Scientific analyses, preservation status, expert findings. Name the investigating bodies and dates.",
    "",
    "## Current Status",
    "Where the relic/site is today. Whether and how it can be visited.",
    "",
    "## Church Approval",
    "Which authority approved it, when, and on what basis. If approval is disputed or only local, say so.",
    "",
    "## Key Facts",
    "Bulleted list of the most important, verifiable details.",
    "",
    "## Sources",
    "Bulleted list of primary and secondary sources referenced (author + work, or institution + report).",
    "",
    "Rules:",
    "- Omit any detail you are not confident about.",
    "- Do not copy language from the Carlo Acutis exhibit catalog.",
    "- Do not invent dates, blood types, or measurements.",
  ].join("\n");

  return { system, user };
}

async function callModel(system, user) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + process.env.OPENROUTER_API_KEY,
      "HTTP-Referer": "https://truecatholicai.org",
      "X-Title": "TrueCatholic AI — knowledge library",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 2048,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const content =
    data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : "";
  const usage = data.usage || {};
  return {
    content,
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
  };
}

function buildFrontmatter(entry, typeCfg) {
  const fm = {
    entity_name: entry.name,
    entity_type: typeCfg.draftsDir === "eucharistic-miracles" ? "eucharistic_miracle" : "marian_apparition",
    slug: entry.slug,
    location_city: entry.city || null,
    location_country: entry.country || null,
    date_occurred: entry.date || null,
    approval_status: entry.approval_status || null,
    approving_authority: entry.approving_authority || null,
    acutis_source_url: entry.source_url || null,
    generated_by: MODEL,
    generated_at: new Date().toISOString(),
    reviewed: false,
  };
  const lines = ["---"];
  for (const [k, v] of Object.entries(fm)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && (v.includes(":") || v.includes("#"))) {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY env var is required.");
    process.exit(1);
  }
  const args = parseArgs(process.argv.slice(2));
  const typeCfg = TYPES[args.type];

  const indexPath = path.join(DATA_DIR, typeCfg.indexFile);
  if (!fs.existsSync(indexPath)) {
    console.error(`Index not found: ${indexPath}. Run scraper first.`);
    process.exit(1);
  }
  let entries = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  if (args.only) entries = entries.filter((e) => args.only.includes(e.slug));
  if (args.limit) entries = entries.slice(0, args.limit);

  const draftsDir = path.join(DRAFTS_ROOT, typeCfg.draftsDir);
  fs.mkdirSync(draftsDir, { recursive: true });

  let totalIn = 0;
  let totalOut = 0;
  let generated = 0;
  let skipped = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const outFile = path.join(draftsDir, `${entry.slug}.md`);
    if (fs.existsSync(outFile) && !args.force) {
      console.log(`[${i + 1}/${entries.length}] skip (exists): ${entry.slug}`);
      skipped++;
      continue;
    }

    console.log(`[${i + 1}/${entries.length}] ${entry.name} (${entry.country || "?"})`);
    const { system, user } = buildPrompt(entry, typeCfg);
    try {
      const { content, promptTokens, completionTokens } = await callModel(system, user);
      totalIn += promptTokens;
      totalOut += completionTokens;
      generated++;

      const body = buildFrontmatter(entry, typeCfg) + content.trim() + "\n";
      fs.writeFileSync(outFile, body);
      console.log(`    ✓ ${promptTokens}in/${completionTokens}out → ${path.relative(process.cwd(), outFile)}`);
    } catch (err) {
      console.error(`    ✗ ${err.message}`);
    }

    if (i < entries.length - 1) await sleep(RATE_LIMIT_MS);
  }

  const estCost =
    (totalIn / 1_000_000) * COST_PER_MTOK_IN + (totalOut / 1_000_000) * COST_PER_MTOK_OUT;
  console.log("\n--- Summary ---");
  console.log(`Generated: ${generated}  Skipped: ${skipped}  Total: ${entries.length}`);
  console.log(`Tokens: ${totalIn} in, ${totalOut} out`);
  console.log(`Est. cost: $${estCost.toFixed(4)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
