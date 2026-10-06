-- Migration: several images per entity, each with its own caption
-- Lets a saint have a main picture and, say, a photograph of an incorrupt
-- body. An entity's images are the catholic_images rows that share its
-- entity_name or point at it through knowledge_id.
--
-- The worker reads these columns when they exist and runs without them, so
-- this can go in before or after a worker deploy. scripts/04 and scripts/05
-- write them, so it has to go in before the next image upload.
-- Run in the Supabase SQL editor. Safe to run twice.

-- Shown under the image instead of the entity's name:
-- "Incorrupt body of St. Bernadette, Nevers, photographed 1925".
ALTER TABLE catholic_images ADD COLUMN IF NOT EXISTS caption    TEXT;

-- What the picture is. 'main' is the one that stands for the entity.
-- 'incorrupt' is a photograph of an incorrupt body: it is always shown as the
-- second image, and first when the question is about incorruptibility.
ALTER TABLE catholic_images ADD COLUMN IF NOT EXISTS image_kind TEXT NOT NULL DEFAULT 'main';

-- Order within one entity, lowest first. The lowest is the lead image.
ALTER TABLE catholic_images ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'catholic_images_image_kind_check'
  ) THEN
    ALTER TABLE catholic_images
      ADD CONSTRAINT catholic_images_image_kind_check
      CHECK (image_kind IN ('main', 'incorrupt', 'relic', 'place', 'other'));
  END IF;
END $$;
