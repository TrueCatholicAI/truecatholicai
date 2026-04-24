#!/usr/bin/env node
// Scrapes the Carlo Acutis Eucharistic miracles catalog INDEX only.
// Do NOT pull panel text or images from this site — those are IP of the
// Associazione Amici di Carlo Acutis. We use the list as a research index.
//
// Output: knowledge/data/acutis_index.json
//   [{ name, country, date, slug, source_url }, ...]

const fs = require("fs");
const path = require("path");

const LIST_URL = "http://www.miracolieucaristici.org/en/liste/list.html";
const OUT_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(OUT_DIR, "acutis_index.json");

function slugify(s) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseCountryFromHref(href) {
  // scheda.html?nat=italia&wh=lanciano → "italia"
  const m = href.match(/[?&]nat=([^&]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

function splitNameAndDate(text) {
  // "Lanciano, 750" → ["Lanciano", "750"]
  // "Buenos Aires, 1992-1996" → ["Buenos Aires", "1992-1996"]
  // Some entries may have no date; handle gracefully.
  const trimmed = text.replace(/\s+/g, " ").trim();
  const lastComma = trimmed.lastIndexOf(",");
  if (lastComma === -1) return { name: trimmed, date: null };
  const tail = trimmed.slice(lastComma + 1).trim();
  if (/^\d/.test(tail) || /\d{3,4}/.test(tail)) {
    return { name: trimmed.slice(0, lastComma).trim(), date: tail };
  }
  return { name: trimmed, date: null };
}

// Catalog sections that aren't miracle sites — exclude from the index.
const NON_MIRACLE_SECTIONS = new Set([
  "INTRODUCTORY PANELS",
  "SAINTS, MYSTICS AND THE EUCHARIST",
  "OUR LADY AND THE EUCHARIST",
  "MIRACULOUS COMMUNIONS",
]);

function looksLikeSectionHeader(text) {
  if (!text) return true;
  if (NON_MIRACLE_SECTIONS.has(text.trim())) return true;
  // Heuristic: all-caps multi-word headers (≥3 words) are thematic sections,
  // not country names.
  const words = text.trim().split(/\s+/);
  if (words.length >= 3 && text === text.toUpperCase()) return true;
  return false;
}

function extractEntries(html) {
  // Walk the document linearly so we can track the "current country" from
  // preceding headers while collecting each miracle anchor.
  const entries = [];
  const tokenRe =
    /(<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>)|(<a\b[^>]*href="([^"]*scheda[^"]*)"[^>]*>([\s\S]*?)<\/a>)/gi;

  let currentCountry = null;
  let inSection = false;
  let m;
  while ((m = tokenRe.exec(html)) !== null) {
    if (m[1]) {
      const headerText = m[2].replace(/<[^>]+>/g, "").trim();
      if (headerText && headerText.length < 60) {
        currentCountry = headerText;
        inSection = looksLikeSectionHeader(headerText);
      }
    } else if (m[3]) {
      if (inSection) continue;
      const href = m[4];
      const linkText = m[5].replace(/<[^>]+>/g, "").trim();
      if (!linkText) continue;

      const { name, date } = splitNameAndDate(linkText);
      if (!name) continue;

      const country = currentCountry || parseCountryFromHref(href);
      const absoluteUrl = new URL(href, LIST_URL).toString();
      entries.push({
        name,
        country,
        date,
        slug: slugify(name),
        source_url: absoluteUrl,
      });
    }
  }
  return entries;
}

function dedupe(entries) {
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    const key = `${e.slug}|${(e.country || "").toLowerCase()}|${e.date || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

async function main() {
  console.log(`Fetching ${LIST_URL} …`);
  const res = await fetch(LIST_URL, {
    headers: { "User-Agent": "TrueCatholicAI-knowledge-indexer/1.0" },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${LIST_URL}`);
  }
  const html = await res.text();

  const raw = extractEntries(html);
  const entries = dedupe(raw);

  if (!entries.length) {
    console.error(
      "No entries extracted. The page structure may have changed — inspect the HTML and update selectors."
    );
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(entries, null, 2) + "\n");

  const byCountry = entries.reduce((acc, e) => {
    const c = e.country || "unknown";
    acc[c] = (acc[c] || 0) + 1;
    return acc;
  }, {});
  console.log(`Wrote ${entries.length} entries → ${OUT_FILE}`);
  console.log("By country:", byCountry);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
