-- Migration 002: Parish widget — Phase 1, Sprint 1
-- Spec: docs/parish-widget-phase1.md
-- Adds four NEW tables (parishes, parish_ministries, parish_leads, parish_usage)
-- plus the our-lady-of-grace seed parish and its 10 ministries.
-- Touches NO existing table. Idempotent — safe to re-run.
--
-- Run in the Supabase SQL editor (same procedure as knowledge/migrations/001).
--
-- RLS: all four tables are service-role only. RLS is enabled with NO policies,
-- so anon/authenticated PostgREST access is fully blocked; the Worker's service
-- role key bypasses RLS. The widget never talks to Supabase directly.

-- ============ 1. parishes ============
CREATE TABLE IF NOT EXISTS parishes (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug                 TEXT UNIQUE NOT NULL,
  name                 TEXT NOT NULL,
  city                 TEXT,
  state                TEXT,
  accent_color         TEXT DEFAULT '#8B2F2F',
  pastor_name          TEXT,
  office_phone         TEXT,
  office_email         TEXT,
  mass_times           TEXT,
  confession_times     TEXT,
  website_url          TEXT,
  mode                 TEXT NOT NULL DEFAULT 'concierge' CHECK (mode IN ('concierge','full')),
  enabled              BOOLEAN NOT NULL DEFAULT false,
  trial_ends_at        DATE,
  monthly_message_cap  INT NOT NULL DEFAULT 2500,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ 2. parish_ministries ============
CREATE TABLE IF NOT EXISTS parish_ministries (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  parish_id      UUID NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  contact_name   TEXT,
  contact_email  TEXT,
  contact_phone  TEXT,
  how_to_join    TEXT,
  active         BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (parish_id, name)
);

-- ============ 3. parish_leads ============
CREATE TABLE IF NOT EXISTS parish_leads (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  parish_id    UUID NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  ministry_id  UUID REFERENCES parish_ministries(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  contact      TEXT NOT NULL,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  exported     BOOLEAN NOT NULL DEFAULT false
);

-- ============ 4. parish_usage ============
-- One row per message exchange. NO conversation text is ever stored here —
-- topic bucket and token counts only (see spec section 6, data protection).
-- `flagged` is included now (spec section 6/7: abuse + origin-mismatch flag,
-- wired up in Sprint 3) to avoid a second manual migration paste.
CREATE TABLE IF NOT EXISTS parish_usage (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  parish_id   UUID NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  topic       TEXT,
  tokens_in   INT,
  tokens_out  INT,
  flagged     BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_parish_ministries_parish ON parish_ministries (parish_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_parish_leads_parish      ON parish_leads (parish_id, created_at);
CREATE INDEX IF NOT EXISTS idx_parish_usage_parish_time ON parish_usage (parish_id, created_at);

-- ============ RLS: service-role only ============
ALTER TABLE parishes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE parish_ministries ENABLE ROW LEVEL SECURITY;
ALTER TABLE parish_leads      ENABLE ROW LEVEL SECURITY;
ALTER TABLE parish_usage      ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: anon + authenticated are denied everything;
-- the service role bypasses RLS.

-- ============ Seed: Our Lady of Grace (test parish) ============
-- Realistic Indiana parish data. Phone numbers use the reserved 555 range and
-- emails use example.org so no real household is ever contacted by test data.
-- Michael can edit the row in Supabase at any time — no deploy needed.
INSERT INTO parishes
  (slug, name, city, state, accent_color, pastor_name, office_phone, office_email,
   mass_times, confession_times, website_url, mode, enabled, monthly_message_cap)
VALUES
  ('our-lady-of-grace',
   'Our Lady of Grace Catholic Church',
   'Noblesville', 'IN',
   '#8B2F2F',
   'Fr. Clayton',
   '(317) 555-0142',
   'office@olg.example.org',
   'Saturday Vigil: 5:30 PM; Sunday: 8:00 AM, 10:30 AM; Monday-Friday: 8:30 AM; Holy Days: 8:30 AM and 7:00 PM',
   'Saturday: 4:00-5:00 PM; Wednesday: 5:30-6:30 PM; or by appointment through the parish office',
   'https://www.olg.example.org',
   'concierge',
   true,
   2500)
ON CONFLICT (slug) DO NOTHING;

WITH p AS (SELECT id FROM parishes WHERE slug = 'our-lady-of-grace')
INSERT INTO parish_ministries (parish_id, name, description, contact_name, contact_email, contact_phone, how_to_join)
SELECT p.id, m.name, m.description, m.contact_name, m.contact_email, m.contact_phone, m.how_to_join
FROM p, (VALUES
  ('Lectors',
   'Proclaim the Scripture readings at Mass. Lectors serve on a rotating monthly schedule and receive training and a workbook with the readings.',
   'Susan Miller', 'lectors@olg.example.org', NULL,
   'Contact the parish office or Susan Miller. Training for new lectors is offered quarterly.'),
  ('Extraordinary Ministers of Holy Communion',
   'Assist with the distribution of Holy Communion at Mass and bring Communion to the homebound and hospitalized.',
   'Deacon Tom Wagner', 'emhc@olg.example.org', NULL,
   'Speak with Deacon Tom after Mass or call the parish office. Diocesan training and a mandate are required.'),
  ('Ushers & Hospitality',
   'Welcome parishioners and visitors, assist with seating, take up the collection, and help with the orderly flow of Mass.',
   'Mike Kowalski', NULL, '(317) 555-0187',
   'Contact the parish office. New ushers shadow an experienced team for a month.'),
  ('Music Ministry & Choir',
   'Lead sung worship at Sunday Mass and special liturgies. Adult choir rehearses Thursday evenings; cantors and instrumentalists also welcome.',
   'Anna Reyes', 'music@olg.example.org', NULL,
   'Come to a Thursday rehearsal at 7:00 PM in the church or email Anna Reyes. No audition required for choir.'),
  ('Altar Servers',
   'Boys and girls who have received First Communion assist the priest at the altar during Mass.',
   'Fr. Clayton', NULL, '(317) 555-0142',
   'Parents can contact the parish office. Training sessions are held twice a year after the 10:30 AM Mass.'),
  ('Knights of Columbus',
   'Catholic men''s fraternal organization serving the parish and community: fish fries, charity drives, and support for seminarians.',
   'Dave Schmidt', 'kofc@olg.example.org', NULL,
   'Attend a first-Tuesday council meeting at 7:00 PM in the parish hall, or contact Dave Schmidt.'),
  ('Women''s Group',
   'Fellowship, faith study, and service projects for the women of the parish. Meets the second Saturday of each month after morning Mass.',
   'Karen Novak', 'womensgroup@olg.example.org', NULL,
   'Just come to a monthly meeting — newcomers are always welcome. Questions to Karen Novak.'),
  ('Religious Education Catechists',
   'Teach and assist in the parish religious education program for grades K-8, Sunday mornings September through April.',
   'Beth Hartman', 'reled@olg.example.org', '(317) 555-0165',
   'Contact Beth Hartman in the parish office. Safe-environment certification (provided) is required before serving.'),
  ('St. Vincent de Paul Society',
   'Serves neighbors in need with food, utility, and rent assistance, and friendly home visits.',
   'Jim O''Connor', 'svdp@olg.example.org', NULL,
   'Attend a second-Thursday meeting at 6:30 PM in the parish hall or contact Jim O''Connor.'),
  ('Greeters',
   'Offer a warm welcome at the church doors before each weekend Mass — a simple, high-impact ministry great for families.',
   'Linda Perez', NULL, '(317) 555-0129',
   'Sign up in the narthex or call the parish office; serve as often as your schedule allows.')
) AS m(name, description, contact_name, contact_email, contact_phone, how_to_join)
ON CONFLICT (parish_id, name) DO NOTHING;
