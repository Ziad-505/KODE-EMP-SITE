-- Department ownership for media.
--
-- The media library had no scoping at all: its `where` clause contained only
-- `deletedAt`, a search term and a kind filter, so a Department Editor could
-- enumerate every document in the club including other teams' policy PDFs,
-- complete with the direct URLs to fetch them.
--
-- NULL means club-wide, matching every other content model. Existing rows are
-- backfilled from whoever uploaded them, which is the closest thing to the
-- truth that the data contains; anything uploaded by a user with no department
-- correctly stays club-wide.

ALTER TABLE "media" ADD COLUMN "departmentId" TEXT;

UPDATE "media" AS m
SET "departmentId" = u."departmentId"
FROM "users" AS u
WHERE u."id" = m."uploadedById"
  AND u."departmentId" IS NOT NULL;

CREATE INDEX "media_departmentId_idx" ON "media" ("departmentId");

ALTER TABLE "media"
  ADD CONSTRAINT "media_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "departments" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
