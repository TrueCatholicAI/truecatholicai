#!/usr/bin/env node
// Adds one image to an entity: a second picture for a saint, a photograph of
// an incorrupt body, a relic. Use it for images found by hand; candidates from
// step 4 still go through the review dashboard.
//
// From Wikimedia Commons (URL, thumbnail, credit and license are looked up):
//   node scripts/05-add-image.js --entity "Saint Bernadette Soubirous" \
//     --commons "File:Bernadette Soubirous-sarcophagus 2.jpg" \
//     --kind incorrupt --caption "Incorrupt body of St. Bernadette, Nevers, photographed 1925"
//
// From anywhere else (you supply the credit and license yourself):
//   node scripts/05-add-image.js --entity "Saint Teresa of Ávila" --url https://... \
//     --attribution "Photo: ..." --license "CC BY-SA 4.0" \
//     --kind incorrupt --caption "..."
//
// Prints what it would insert and stops. Add --write to insert it.
//
//   --kind     main | incorrupt | relic | place | other   (default: main)
//   --caption  shown under the image; required for anything but main, since it
//              is what tells the reader what they are looking at, and when
//   --order    position among the entity's images, lowest first
//              (default: after the ones already there)
//   --thumb    smaller version of --url (default: --url itself)
//   --unlisted the entity has images but no knowledge-library entry; give --type
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and migration 002.

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const USER_AGENT =
  "TrueCatholicAI-knowledge-indexer/1.0 (https://truecatholicai.org; truecatholicai@protonmail.com)";
const THUMB_WIDTH = 480;
const KINDS = ["main", "incorrupt", "relic", "place", "other"];

// Same list as 03-scrape-wikimedia-images.js.
const ALLOWED_LICENSE_PATTERNS = [
  /^pd\b/i,
  /public domain/i,
  /^cc[- ]?by($|[- ])/i,
  /^cc[- ]?by[- ]?sa/i,
  /^cc[- ]?zero/i,
  /^cc0/i,
];

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) fail(`Unexpected argument: ${a}`);
    const key = a.slice(2);
    if (key === "write" || key === "unlisted") args[key] = true;
    else args[key] = argv[++i];
  }
  return args;
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

// "St. Teresa of Avila" and "Saint Teresa of Ávila (Doctor)" are the same entry.
function nameKey(name) {
  return String(name || "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/^st\.? /, "saint ").replace(/\s+/g, " ").trim();
}

const args = parseArgs(process.argv);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) fail("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
if (!args.entity) fail('Which entity? --entity "Saint Bernadette Soubirous"');
if (!args.commons && !args.url) fail("Which image? --commons \"File:...\" or --url https://...");
const kind = args.kind || "main";
if (!KINDS.includes(kind)) fail(`--kind must be one of: ${KINDS.join(", ")}`);
if (kind !== "main" && !args.caption) {
  fail(`--kind ${kind} needs --caption: say what the image shows and when, e.g. "Incorrupt body of St. Bernadette, Nevers, photographed 1925".`);
}

async function supabase(pathAndQuery, init) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...((init && init.headers) || {}),
    },
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text ? JSON.parse(text) : null };
}

async function findEntity(name) {
  const res = await supabase("catholic_knowledge?is_active=eq.true&select=id,entity_name,entity_type");
  if (!res.ok) fail(`Could not read catholic_knowledge (HTTP ${res.status}).`);
  const key = nameKey(name);
  const hit = res.body.find((r) => nameKey(r.entity_name) === key);
  if (hit) return hit;
  if (args.unlisted) {
    if (!args.type) fail("--unlisted needs --type (saint, marian_apparition, artwork, other).");
    return { id: null, entity_name: name, entity_type: args.type };
  }
  const words = key.split(" ").filter((w) => w.length >= 4 && w !== "saint");
  const near = res.body.filter((r) => words.some((w) => nameKey(r.entity_name).includes(w))).slice(0, 8);
  fail(
    `"${name}" is not in the knowledge library.` +
      (near.length ? `\nClosest entries:\n${near.map((r) => "  " + r.entity_name).join("\n")}` : "") +
      "\nUse the entry's exact name, or add --unlisted --type <type> for an entity that only has images."
  );
}

async function fromCommons(input) {
  // Accept "File:Name.jpg" or a commons.wikimedia.org/wiki/File:... link.
  let title = input.trim();
  const m = title.match(/\/wiki\/(File:[^?#]+)/i);
  if (m) title = decodeURIComponent(m[1]);
  title = title.replace(/_/g, " ");
  if (!/^File:/i.test(title)) title = "File:" + title;

  const params = new URLSearchParams({
    action: "query",
    format: "json",
    titles: title,
    prop: "imageinfo",
    iiprop: "url|size|extmetadata|mime",
    iiurlwidth: String(THUMB_WIDTH),
    iiextmetadatafilter: "License|LicenseShortName|Artist|Credit|ImageDescription|ObjectName|UsageTerms",
  });
  const res = await fetch(`${COMMONS_API}?${params.toString()}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) fail(`Commons returned HTTP ${res.status} for ${title}.`);
  const data = await res.json();
  const page = Object.values((data.query && data.query.pages) || {})[0];
  const info = page && page.imageinfo && page.imageinfo[0];
  if (!info) fail(`Commons has no file called "${title}". Check the name on its Commons page.`);

  const meta = info.extmetadata || {};
  // Commons repeats some credits in a hidden element ("Unknown authorUnknown author").
  const strip = (s) => {
    const text = s ? String(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "";
    const half = text.slice(0, text.length / 2);
    return half && text === half + half ? half : text;
  };
  // The API appends tracking parameters to file URLs.
  const bare = (url) => String(url).split("?")[0];
  const license = (meta.LicenseShortName && meta.LicenseShortName.value) || "";
  if (!license || !ALLOWED_LICENSE_PATTERNS.some((re) => re.test(license))) {
    fail(`"${title}" is licensed "${license || "unknown"}", which is not one we can reuse (public domain, CC BY, CC BY-SA, CC0).`);
  }
  return {
    imageUrl: bare(info.url),
    thumbnailUrl: bare(info.thumburl || info.url),
    attribution: strip(meta.Artist && meta.Artist.value) || strip(meta.Credit && meta.Credit.value) || `Wikimedia Commons: ${page.title}`,
    license,
    description: strip(meta.ImageDescription && meta.ImageDescription.value) || page.title,
  };
}

async function main() {
  const entity = await findEntity(args.entity);

  let image;
  if (args.commons) {
    image = await fromCommons(args.commons);
  } else {
    if (!/^https:\/\//.test(args.url)) fail("--url must be an https:// link to the image file.");
    if (!args.attribution || !args.license) {
      fail("An image from outside Commons needs --attribution and --license, so the credit under it is right.");
    }
    image = { imageUrl: args.url, thumbnailUrl: args.thumb || args.url, attribution: args.attribution, license: args.license, description: "" };
  }

  // What the entity already has. Reading the new columns doubles as the check
  // that migration 002 is in.
  const filter = entity.id
    ? `or=(knowledge_id.eq.${entity.id},entity_name.eq.${encodeURIComponent('"' + entity.entity_name + '"')})`
    : `entity_name=eq.${encodeURIComponent(entity.entity_name)}`;
  let existing = await supabase(`catholic_images?${filter}&select=image_url,image_kind,caption,sort_order&order=sort_order.asc`);
  let migrated = true;
  if (!existing.ok) {
    migrated = false;
    existing = await supabase(`catholic_images?${filter}&select=image_url`);
    if (!existing.ok) fail(`Could not read catholic_images (HTTP ${existing.status}).`);
  }
  if (existing.body.some((r) => r.image_url === image.imageUrl)) {
    fail(`${entity.entity_name} already has this image.`);
  }
  const lastOrder = existing.body.reduce((max, r) => Math.max(max, r.sort_order || 0), -1);

  const row = {
    entity_type: entity.entity_type,
    entity_name: entity.entity_name,
    keywords: [entity.entity_name],
    image_url: image.imageUrl,
    thumbnail_url: image.thumbnailUrl,
    attribution: image.attribution,
    license_type: image.license,
    alt_text: args.caption || image.description || entity.entity_name,
    knowledge_id: entity.id,
    approved: true,
    caption: args.caption || null,
    image_kind: kind,
    sort_order: args.order !== undefined ? Number(args.order) : lastOrder + 1,
  };
  if (!Number.isInteger(row.sort_order)) fail("--order must be a whole number.");

  console.log(`${entity.entity_name}${entity.id ? "" : "  (no knowledge-library entry)"}`);
  console.log(`  has ${existing.body.length} image(s) now` +
    (migrated && existing.body.length ? ": " + existing.body.map((r) => `${r.sort_order} ${r.image_kind}`).join(", ") : ""));
  console.log("  adding:");
  for (const k of ["image_kind", "sort_order", "caption", "attribution", "license_type", "image_url", "thumbnail_url"]) {
    console.log(`    ${k.padEnd(14)} ${row[k]}`);
  }
  console.log(`  shown as: ${(row.caption || row.entity_name)} · ${row.attribution}`);

  if (!migrated) console.log("\nMigration 002 is not in yet (no image_kind column). Paste migrations/002-image-captions-kinds.sql first; --write will fail until then.");
  if (!args.write) {
    console.log("\nNothing written. Run again with --write to insert it.");
    return;
  }
  const res = await supabase("catholic_images", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify([row]) });
  if (!res.ok) fail(`Insert failed (HTTP ${res.status}): ${JSON.stringify(res.body)}`);
  console.log(`\nInserted (id=${res.body[0].id}). The app picks it up within five minutes.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
