#!/usr/bin/env node
// Searches Wikimedia Commons for public-domain and CC-licensed images per
// knowledge entity. Writes candidates to image_candidates.json and downloads
// thumbnails locally for the review dashboard.
//
// IMPORTANT: only PD / CC-BY / CC-BY-SA results are kept. Anything with an
// unrecognized or restrictive license is filtered out.
//
// Usage:
//   node 03-scrape-wikimedia-images.js eucharistic
//   node 03-scrape-wikimedia-images.js marian --limit 5
//   node 03-scrape-wikimedia-images.js eucharistic --only lanciano,siena

const fs = require("fs");
const path = require("path");

const API = "https://commons.wikimedia.org/w/api.php";
const USER_AGENT =
  "TrueCatholicAI-knowledge-indexer/1.0 (https://truecatholicai.org; truecatholicai@protonmail.com)";
const THUMB_WIDTH = 480;
const MAX_CANDIDATES = 5;
const SEARCH_LIMIT = 15;
const RATE_LIMIT_MS = 500;

const ALLOWED_LICENSE_PATTERNS = [
  /^pd\b/i,
  /public domain/i,
  /^cc[- ]?by($|[- ])/i,
  /^cc[- ]?by[- ]?sa/i,
  /^cc[- ]?zero/i,
  /^cc0/i,
];

const DATA_DIR = path.join(__dirname, "..", "data");
const THUMBS_DIR = path.join(__dirname, "..", "review", "thumbs");

const TYPES = {
  eucharistic: { indexFile: "acutis_index.json" },
  marian: { indexFile: "marian_index.json" },
};

function parseArgs(argv) {
  const args = { type: null, limit: null, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (TYPES[a]) args.type = a;
    else if (a === "--limit") args.limit = parseInt(argv[++i], 10);
    else if (a === "--only") args.only = argv[++i].split(",").map((s) => s.trim());
  }
  if (!args.type) {
    console.error("Usage: node 03-scrape-wikimedia-images.js <eucharistic|marian> [--limit N] [--only slug1,slug2]");
    process.exit(1);
  }
  return args;
}

function licenseAllowed(licenseShort) {
  if (!licenseShort) return false;
  return ALLOWED_LICENSE_PATTERNS.some((re) => re.test(licenseShort));
}

function buildQueries(entry) {
  const queries = [];
  if (entry.name) queries.push(entry.name);
  if (entry.name && entry.city) queries.push(`${entry.name} ${entry.city}`);
  if (entry.city && entry.country) queries.push(`${entry.city} ${entry.country} church`);
  // Eucharistic miracles: the relic is usually kept in a specific church.
  if (entry.name && /eucharist|miracle/i.test(entry.name) === false) {
    queries.push(`Eucharistic miracle ${entry.name}`);
  }
  // Dedupe + keep order.
  return [...new Set(queries.filter(Boolean))];
}

async function searchCommons(query) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: "6",
    gsrlimit: String(SEARCH_LIMIT),
    prop: "imageinfo",
    iiprop: "url|size|extmetadata|mime",
    iiurlwidth: String(THUMB_WIDTH),
    iiextmetadatafilter: "License|LicenseShortName|Artist|Credit|ImageDescription|ObjectName|UsageTerms",
  });
  const res = await fetch(`${API}?${params.toString()}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Commons ${res.status} for ${query}`);
  const data = await res.json();
  const pages = (data.query && data.query.pages) || {};
  return Object.values(pages);
}

function extractCandidate(page) {
  const info = page.imageinfo && page.imageinfo[0];
  if (!info) return null;
  if (!info.mime || !/^image\//.test(info.mime)) return null;

  const meta = info.extmetadata || {};
  const licenseShort = (meta.LicenseShortName && meta.LicenseShortName.value) || "";
  if (!licenseAllowed(licenseShort)) return null;

  const strip = (s) => (s ? String(s).replace(/<[^>]+>/g, "").trim() : "");
  return {
    title: page.title,
    pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
    imageUrl: info.url,
    thumbnailUrl: info.thumburl || info.url,
    width: info.width,
    height: info.height,
    mime: info.mime,
    license: licenseShort,
    artist: strip(meta.Artist && meta.Artist.value),
    credit: strip(meta.Credit && meta.Credit.value),
    description: strip(meta.ImageDescription && meta.ImageDescription.value),
    objectName: strip(meta.ObjectName && meta.ObjectName.value),
    usageTerms: strip(meta.UsageTerms && meta.UsageTerms.value),
  };
}

async function downloadThumb(url, destPath) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`thumb ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const typeCfg = TYPES[args.type];

  const indexPath = path.join(DATA_DIR, typeCfg.indexFile);
  let entries = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  if (args.only) entries = entries.filter((e) => args.only.includes(e.slug));
  if (args.limit) entries = entries.slice(0, args.limit);

  fs.mkdirSync(THUMBS_DIR, { recursive: true });

  const candidatesPath = path.join(DATA_DIR, `image_candidates_${args.type}.json`);
  const existing = fs.existsSync(candidatesPath)
    ? JSON.parse(fs.readFileSync(candidatesPath, "utf8"))
    : {};

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    console.log(`[${i + 1}/${entries.length}] ${entry.name}`);

    const seen = new Set();
    const found = [];
    for (const q of buildQueries(entry)) {
      if (found.length >= MAX_CANDIDATES) break;
      try {
        const pages = await searchCommons(q);
        for (const page of pages) {
          if (found.length >= MAX_CANDIDATES) break;
          const cand = extractCandidate(page);
          if (!cand) continue;
          if (seen.has(cand.imageUrl)) continue;
          seen.add(cand.imageUrl);
          found.push({ ...cand, matchedQuery: q });
        }
      } catch (err) {
        console.error(`    query "${q}" failed: ${err.message}`);
      }
      await sleep(RATE_LIMIT_MS);
    }

    // Download thumbnails so the review dashboard can render them offline.
    for (let j = 0; j < found.length; j++) {
      const cand = found[j];
      const ext = (cand.mime.split("/")[1] || "jpg").replace("jpeg", "jpg");
      const localName = `${entry.slug}-${j + 1}.${ext}`;
      const destPath = path.join(THUMBS_DIR, localName);
      try {
        await downloadThumb(cand.thumbnailUrl, destPath);
        cand.localThumb = `thumbs/${localName}`;
      } catch (err) {
        console.error(`    thumb failed: ${err.message}`);
      }
    }

    existing[entry.slug] = {
      entityName: entry.name,
      entityType: args.type,
      candidates: found,
    };
    console.log(`    ${found.length} candidate(s)`);
  }

  fs.writeFileSync(candidatesPath, JSON.stringify(existing, null, 2) + "\n");
  console.log(`\nWrote ${candidatesPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
