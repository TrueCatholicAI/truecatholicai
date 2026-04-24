-- Migration: Catholic knowledge library
-- Adds the catholic_knowledge table (entries for miracles, apparitions, shroud, etc.)
-- and extends the existing catholic_images table to link to those entries.
-- Run in the Supabase SQL editor.

-- 1. Knowledge entries
CREATE TABLE IF NOT EXISTS catholic_knowledge (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type          TEXT NOT NULL CHECK (entity_type IN (
                         'eucharistic_miracle',
                         'marian_apparition',
                         'shroud',
                         'saint',
                         'sacred_place',
                         'church_history'
                       )),
  entity_name          TEXT NOT NULL,
  slug                 TEXT UNIQUE NOT NULL,
  location_city        TEXT,
  location_country     TEXT,
  latitude             DECIMAL,
  longitude            DECIMAL,
  date_occurred        TEXT,
  date_approved        TEXT,
  approval_status      TEXT,
  approving_authority  TEXT,
  content_markdown     TEXT NOT NULL,
  summary              TEXT,
  keywords             TEXT[] NOT NULL DEFAULT '{}',
  sources              TEXT[] DEFAULT '{}',
  is_active            BOOLEAN DEFAULT FALSE,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_catholic_knowledge_entity_type ON catholic_knowledge(entity_type);
CREATE INDEX IF NOT EXISTS idx_catholic_knowledge_is_active   ON catholic_knowledge(is_active);
CREATE INDEX IF NOT EXISTS idx_catholic_knowledge_keywords    ON catholic_knowledge USING GIN (keywords);

-- updated_at trigger
CREATE OR REPLACE FUNCTION touch_catholic_knowledge_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_catholic_knowledge_updated_at ON catholic_knowledge;
CREATE TRIGGER trg_catholic_knowledge_updated_at
  BEFORE UPDATE ON catholic_knowledge
  FOR EACH ROW EXECUTE FUNCTION touch_catholic_knowledge_updated_at();

-- RLS: read-only to anon/auth, writes through service role only.
ALTER TABLE catholic_knowledge ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catholic_knowledge_public_read ON catholic_knowledge;
CREATE POLICY catholic_knowledge_public_read
  ON catholic_knowledge FOR SELECT
  USING (is_active = TRUE);

-- 2. Extend catholic_images to link into the knowledge table
ALTER TABLE catholic_images ADD COLUMN IF NOT EXISTS knowledge_id UUID;
ALTER TABLE catholic_images ADD COLUMN IF NOT EXISTS alt_text     TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_catholic_images_knowledge'
  ) THEN
    ALTER TABLE catholic_images
      ADD CONSTRAINT fk_catholic_images_knowledge
      FOREIGN KEY (knowledge_id) REFERENCES catholic_knowledge(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_catholic_images_knowledge_id ON catholic_images(knowledge_id);
