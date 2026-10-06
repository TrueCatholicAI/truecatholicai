# Catholic Knowledge Library — Pipeline

Automated data gathering for Eucharistic miracles, Marian apparitions, and the Shroud of Turin. Produces drafts Michael reviews, then pushes approved entries and images into Supabase (`catholic_knowledge` + `catholic_images`).

See `/home/michael/truecatholic/truecatholicai/knowledge/migrations/001-catholic-knowledge.sql` for the schema.

## Prerequisites

- Node 18+ (uses native `fetch`).
- A local static server for the review dashboard. `python3 -m http.server` works.
- Env vars:
  - `OPENROUTER_API_KEY` — for Haiku drafts (step 3).
  - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — for upload (step 7).

## End-to-end flow

```
┌────────────────────────────────┐
│ 1. Run migration in Supabase   │
└──────────────┬─────────────────┘
               ▼
┌────────────────────────────────┐
│ 2. Scrape Acutis index         │ → data/acutis_index.json
└──────────────┬─────────────────┘
               ▼
┌────────────────────────────────┐
│ 3. Generate draft entries      │ → drafts/*/*.md
└──────────────┬─────────────────┘
               ▼
┌────────────────────────────────┐
│ 4. Scrape Wikimedia images     │ → data/image_candidates_*.json, review/thumbs/
└──────────────┬─────────────────┘
               ▼
┌────────────────────────────────┐
│ 5. Build review bundle         │ → review/review_data.json
└──────────────┬─────────────────┘
               ▼
┌────────────────────────────────┐
│ 6. Review in browser           │ → download review_state.json
└──────────────┬─────────────────┘
               ▼
┌────────────────────────────────┐
│ 7. Upload approved to Supabase │
└────────────────────────────────┘
```

## Step-by-step

### 1. Apply the migration

```bash
# Open Supabase SQL editor, paste migrations/001-catholic-knowledge.sql, run.
# Then migrations/002-image-captions-kinds.sql (captions, several images per entry).
```

### 2. Scrape the Acutis catalog index (list only — no panel text, no images)

```bash
node scripts/01-scrape-acutis-index.js
```

The Carlo Acutis catalog is used as a research index only. His exhibit text and curated photography are the IP of the Associazione Amici di Carlo Acutis — we do not reproduce them.

### 3. Generate draft knowledge entries via Claude Haiku

```bash
# Start small — 20 miracles is a good first pass for review.
OPENROUTER_API_KEY=sk-or-... node scripts/02-generate-entries.js eucharistic --limit 20

# Or all Marian apparitions (15 entries):
OPENROUTER_API_KEY=sk-or-... node scripts/02-generate-entries.js marian
```

The script rate-limits itself to one request every 5 seconds. Drafts are written to `drafts/eucharistic-miracles/*.md` and `drafts/marian-apparitions/*.md`.

### 4. Scrape Wikimedia Commons for candidate images

```bash
node scripts/03-scrape-wikimedia-images.js eucharistic --limit 20
node scripts/03-scrape-wikimedia-images.js marian
```

Only PD / CC-BY / CC-BY-SA / CC0 results are kept. Thumbnails download to `review/thumbs/`.

### 5. Build the review bundle

```bash
node scripts/build-review-data.js
```

Produces `review/review_data.json`, which the dashboard loads.

### 6. Review in browser

```bash
cd review && python3 -m http.server 8080
# open http://localhost:8080/
```

For each entry:
- Edit the markdown directly in the textarea.
- Approve / reject the entry.
- Approve / reject each image candidate.

State persists in `localStorage`. When you're done, click **Export review_state.json** — the file downloads to your default download dir. Move it to `review/review_state.json` before the upload step.

Tip: you can re-import a saved `review_state.json` later to continue where you left off.

### 7. Upload approved entries + images to Supabase

```bash
# Dry-run first to see what would be inserted.
SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/04-upload-approved.js review/review_state.json --dry-run

# Live run.
SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/04-upload-approved.js review/review_state.json
```

By default, approved images are stored as direct Wikimedia Commons URLs (legal with attribution for PD / CC-BY / CC-BY-SA). `--r2` would copy each file to Cloudflare R2 — stub only; wire up when R2 bucket is provisioned.

## Several images for one entry

An entry can have more than one image: its main picture and, for the incorruptibles, a photograph of the body. Each `catholic_images` row has:

- `caption` — shown under the image in place of the entry's name. Say what it is and when: "Incorrupt body of St. Bernadette, Nevers, photographed 1925".
- `image_kind` — `main`, `incorrupt`, `relic`, `place` or `other`.
- `sort_order` — lowest first; the lowest is the lead image.

The app shows the lead beside the opening of the answer and one more image after the text. An `incorrupt` image always takes that second place, and comes first when the question is about incorruptibility. An entry whose only image is the body photograph leads with it.

Images approved in the review dashboard upload in the order they were approved (step 7). For one found by hand, which is how most photographs of incorrupt bodies will arrive:

```bash
# Preview. Nothing is written without --write.
SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/05-add-image.js --entity "Saint Bernadette Soubirous" \
    --commons "File:Bernadette soubirous exhumated body 1925.jpg" \
    --kind incorrupt \
    --caption "Incorrupt body of St. Bernadette, Nevers, photographed at the 1925 exhumation"
```

`--commons` takes a file name or a Commons page link and looks up the URL, credit and license; anything not public domain or CC is refused. For an image from elsewhere, pass `--url`, `--attribution` and `--license` yourself. The entity has to be in the library already; the script lists the closest names if it isn't. New images appear in the app within five minutes.

## Hand-authored entries (`manual/`)

Some entries don't come out of the scraper — they're written by hand and inserted directly. Source markdown lives in `manual/` (committed; not gitignored, unlike `drafts/`).

Currently:
- `manual/saint-carlo-acutis.md` — Saint Carlo Acutis and the Eucharistic Miracles Exhibition catalog (the catalog is the research index for this whole library).

Planned:
- Shroud of Turin entry (Michael has 21 pages of reconstruction findings live at `truecatholicai.github.io/shroud-reconstruction`).
- Martyrs of Gorkum.

## What NOT to automate

- Do NOT scrape text or images from miracolieucaristici.org beyond the list. That content is IP of the Acutis association.
- Do NOT bypass the review step. AI drafts are drafts, not final content.
- Do NOT insert images from non-PD / non-CC sources.
