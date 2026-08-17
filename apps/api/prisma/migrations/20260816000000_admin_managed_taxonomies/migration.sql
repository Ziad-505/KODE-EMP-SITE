-- Admin-managed taxonomies.
--
-- Replaces the `EventKind` Postgres enum with a table an administrator can add
-- to at runtime. Adding a value to a PG enum requires ALTER TYPE, which cannot
-- run inside a transaction and therefore cannot be applied by Prisma Migrate in
-- the normal way, so "add an event kind" was a deploy rather than an edit.
--
-- The backfill is written so this migration is safe on a populated database:
-- every existing event keeps the term it already had.

CREATE TYPE "TaxonomyKind" AS ENUM (
  'EVENT_KIND',
  'ARTICLE_CATEGORY',
  'FAQ_CATEGORY',
  'TICKET_CATEGORY'
);

CREATE TABLE "taxonomies" (
  "id"          TEXT NOT NULL,
  "kind"        "TaxonomyKind" NOT NULL,
  "key"         TEXT NOT NULL,
  "label"       TEXT NOT NULL,
  "description" TEXT,
  "colour"      TEXT NOT NULL DEFAULT '#244EA2',
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "isSystem"    BOOLEAN NOT NULL DEFAULT false,
  "archivedAt"  TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "taxonomies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "taxonomies_kind_key_key" ON "taxonomies" ("kind", "key");
CREATE INDEX "taxonomies_kind_archivedAt_sortOrder_idx"
  ON "taxonomies" ("kind", "archivedAt", "sortOrder");

-- Seed the four values the enum used to hold, marked as system terms so the
-- UI will archive but never delete them.
INSERT INTO "taxonomies"
  ("id", "kind", "key", "label", "colour", "sortOrder", "isSystem", "updatedAt")
VALUES
  ('tax_evt_club_moment',  'EVENT_KIND', 'CLUB_MOMENT',  'Club moment',  '#244EA2', 10, true, CURRENT_TIMESTAMP),
  ('tax_evt_learning',     'EVENT_KIND', 'LEARNING',     'Learning',     '#BFD730', 20, true, CURRENT_TIMESTAMP),
  ('tax_evt_wellbeing',    'EVENT_KIND', 'WELLBEING',    'Wellbeing',    '#7F3F98', 30, true, CURRENT_TIMESTAMP),
  ('tax_evt_announcement', 'EVENT_KIND', 'ANNOUNCEMENT', 'Announcement', '#F26522', 40, true, CURRENT_TIMESTAMP);

-- Repoint events at the table. Nullable first so the backfill has somewhere to
-- land, then made NOT NULL once every row has a value.
ALTER TABLE "events" ADD COLUMN "kindId" TEXT;

UPDATE "events" AS e
SET "kindId" = t."id"
FROM "taxonomies" AS t
WHERE t."kind" = 'EVENT_KIND'
  AND t."key" = e."kind"::text;

-- Anything the backfill missed (impossible unless the enum was extended out of
-- band) falls back to the default rather than blocking the migration.
UPDATE "events"
SET "kindId" = 'tax_evt_club_moment'
WHERE "kindId" IS NULL;

ALTER TABLE "events" ALTER COLUMN "kindId" SET NOT NULL;
ALTER TABLE "events" DROP COLUMN "kind";
DROP TYPE "EventKind";

CREATE INDEX "events_kindId_idx" ON "events" ("kindId");

ALTER TABLE "events"
  ADD CONSTRAINT "events_kindId_fkey"
  FOREIGN KEY ("kindId") REFERENCES "taxonomies" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
