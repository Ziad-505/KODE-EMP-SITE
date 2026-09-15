-- The remaining three category columns move onto the taxonomy table.
--
-- Before this migration the same domain concept was modelled three different
-- ways: `EventKind` and `TicketCategory` were Postgres enums, while
-- `Article.category` and `Faq.category` were unconstrained free text with a
-- hardcoded default. None of the three was manageable at runtime, and the two
-- free-text columns additionally allowed "Club Life" and "club life" to exist
-- as separate facets with no rename path across the rows using them.
--
-- Existing values are preserved. Free-text categories are folded onto the key
-- they generate, so rows differing only in capitalisation, surrounding space or
-- punctuation converge on one term, and the label is the tidiest spelling in use.
--
-- Grouping is by the generated key rather than by `upper(trim(category))`:
-- those two are not the same partition. "IT support" and "IT  Support" have
-- different `upper(trim())` values but produce the same key, so grouping the
-- looser way put them in separate groups that then collided on insert. The
-- second was dropped by ON CONFLICT, meaning the label tiebreak below never got
-- to compare them and the arbitrary winner kept its double space. Grouping by
-- the key makes that collision unreachable by construction.
--
-- Labels are whitespace-normalised. The raw value was previously carried
-- through, so a category stored as "  Club life  " became a label rendered with
-- its padding intact, permanently, in both the CMS and the portal.

-- ---------------------------------------------------------------- news
INSERT INTO "taxonomies" ("id", "kind", "key", "label", "colour", "sortOrder", "isSystem", "updatedAt")
SELECT
  'tax_art_' || substr(md5(c.key), 1, 20),
  'ARTICLE_CATEGORY',
  c.key,
  c.label,
  '#244EA2',
  row_number() OVER (ORDER BY c.uses DESC, c.label) * 10,
  false,
  CURRENT_TIMESTAMP
FROM (
  SELECT
    g.key,
    -- Label tiebreak: prefer the spelling a person would write. Where two
    -- variants are equally common, an all-caps or all-lower form loses to
    -- sentence case, so "Workplace" wins over "WORKPLACE" and "workplace".
    (array_agg(g.label ORDER BY
      (g.label = upper(g.label)) ASC,
      (g.label = lower(g.label)) ASC,
      g.cnt DESC,
      g.label ASC
    ))[1] AS label,
    sum(g.cnt) AS uses
  FROM (
    SELECT
      regexp_replace(upper(trim("category")), '[^A-Z0-9]+', '_', 'g') AS key,
      regexp_replace(trim("category"), '\s+', ' ', 'g') AS label,
      count(*) AS cnt
    FROM "articles"
    GROUP BY 1, 2
  ) AS g
  GROUP BY g.key
) AS c
ON CONFLICT ("kind", "key") DO NOTHING;

-- A guaranteed home for anything the fold missed, and the default for new rows.
--
-- Note that on any real database the fold above has already created CLUB_LIFE,
-- because it is the column's own default, so this takes the ON CONFLICT branch
-- and the row keeps its generated `tax_art_<md5>` id. The fallback below
-- therefore resolves the row by (kind, key) rather than naming an id that
-- usually does not exist: written the other way it was not a safety net at all,
-- since a row that actually reached it would be assigned a dangling id and fail
-- the foreign key two statements later.
INSERT INTO "taxonomies" ("id", "kind", "key", "label", "colour", "sortOrder", "isSystem", "updatedAt")
VALUES ('tax_art_default', 'ARTICLE_CATEGORY', 'CLUB_LIFE', 'Club life', '#244EA2', 1, true, CURRENT_TIMESTAMP)
ON CONFLICT ("kind", "key") DO UPDATE SET "isSystem" = true;

ALTER TABLE "articles" ADD COLUMN "categoryId" TEXT;
UPDATE "articles" AS a SET "categoryId" = t."id"
FROM "taxonomies" AS t
WHERE t."kind" = 'ARTICLE_CATEGORY'
  AND t."key" = regexp_replace(upper(trim(a."category")), '[^A-Z0-9]+', '_', 'g');
UPDATE "articles" SET "categoryId" = (
  SELECT "id" FROM "taxonomies" WHERE "kind" = 'ARTICLE_CATEGORY' AND "key" = 'CLUB_LIFE'
) WHERE "categoryId" IS NULL;
ALTER TABLE "articles" ALTER COLUMN "categoryId" SET NOT NULL;
ALTER TABLE "articles" DROP COLUMN "category";
CREATE INDEX "articles_categoryId_idx" ON "articles" ("categoryId");
ALTER TABLE "articles" ADD CONSTRAINT "articles_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "taxonomies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------- faqs
INSERT INTO "taxonomies" ("id", "kind", "key", "label", "colour", "sortOrder", "isSystem", "updatedAt")
SELECT
  'tax_faq_' || substr(md5(c.key), 1, 20),
  'FAQ_CATEGORY',
  c.key,
  c.label,
  '#7F3F98',
  row_number() OVER (ORDER BY c.uses DESC, c.label) * 10,
  false,
  CURRENT_TIMESTAMP
FROM (
  SELECT
    g.key,
    -- Same tiebreak and the same key-based grouping as the news block above.
    (array_agg(g.label ORDER BY
      (g.label = upper(g.label)) ASC,
      (g.label = lower(g.label)) ASC,
      g.cnt DESC,
      g.label ASC
    ))[1] AS label,
    sum(g.cnt) AS uses
  FROM (
    SELECT
      regexp_replace(upper(trim("category")), '[^A-Z0-9]+', '_', 'g') AS key,
      regexp_replace(trim("category"), '\s+', ' ', 'g') AS label,
      count(*) AS cnt
    FROM "faqs"
    GROUP BY 1, 2
  ) AS g
  GROUP BY g.key
) AS c
ON CONFLICT ("kind", "key") DO NOTHING;

INSERT INTO "taxonomies" ("id", "kind", "key", "label", "colour", "sortOrder", "isSystem", "updatedAt")
VALUES ('tax_faq_default', 'FAQ_CATEGORY', 'WORKPLACE', 'Workplace', '#7F3F98', 1, true, CURRENT_TIMESTAMP)
ON CONFLICT ("kind", "key") DO UPDATE SET "isSystem" = true;

ALTER TABLE "faqs" ADD COLUMN "categoryId" TEXT;
UPDATE "faqs" AS f SET "categoryId" = t."id"
FROM "taxonomies" AS t
WHERE t."kind" = 'FAQ_CATEGORY'
  AND t."key" = regexp_replace(upper(trim(f."category")), '[^A-Z0-9]+', '_', 'g');
-- Resolved by key, not by the literal id, for the reason given in the news block.
UPDATE "faqs" SET "categoryId" = (
  SELECT "id" FROM "taxonomies" WHERE "kind" = 'FAQ_CATEGORY' AND "key" = 'WORKPLACE'
) WHERE "categoryId" IS NULL;
ALTER TABLE "faqs" ALTER COLUMN "categoryId" SET NOT NULL;
ALTER TABLE "faqs" DROP COLUMN "category";
CREATE INDEX "faqs_categoryId_idx" ON "faqs" ("categoryId");
ALTER TABLE "faqs" ADD CONSTRAINT "faqs_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "taxonomies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ------------------------------------------------------------- tickets
-- These were an enum, so the five values are known and all are system terms:
-- IT's downstream Odoo rules parse the category out of the notification email,
-- so none of them may be deleted out from under that integration.
INSERT INTO "taxonomies" ("id", "kind", "key", "label", "colour", "sortOrder", "isSystem", "updatedAt")
VALUES
  ('tax_tkt_hardware', 'TICKET_CATEGORY', 'HARDWARE', 'Hardware',          '#F26522', 10, true, CURRENT_TIMESTAMP),
  ('tax_tkt_software', 'TICKET_CATEGORY', 'SOFTWARE', 'Software',          '#244EA2', 20, true, CURRENT_TIMESTAMP),
  ('tax_tkt_network',  'TICKET_CATEGORY', 'NETWORK',  'Network',           '#BFD730', 30, true, CURRENT_TIMESTAMP),
  ('tax_tkt_access',   'TICKET_CATEGORY', 'ACCESS',   'Access and logins', '#7F3F98', 40, true, CURRENT_TIMESTAMP),
  ('tax_tkt_other',    'TICKET_CATEGORY', 'OTHER',    'Something else',    '#15162B', 50, true, CURRENT_TIMESTAMP)
ON CONFLICT ("kind", "key") DO NOTHING;

ALTER TABLE "support_tickets" ADD COLUMN "categoryId" TEXT;
UPDATE "support_tickets" AS s SET "categoryId" = t."id"
FROM "taxonomies" AS t
WHERE t."kind" = 'TICKET_CATEGORY' AND t."key" = s."category"::text;
-- Also resolved by key. The previous migration already shipped the taxonomy
-- screen with all four namespaces selectable, so an administrator may have
-- created TICKET_CATEGORY/OTHER by hand before this runs. The INSERT above then
-- takes its DO NOTHING branch and the literal id never exists.
UPDATE "support_tickets" SET "categoryId" = (
  SELECT "id" FROM "taxonomies" WHERE "kind" = 'TICKET_CATEGORY' AND "key" = 'OTHER'
) WHERE "categoryId" IS NULL;
ALTER TABLE "support_tickets" ALTER COLUMN "categoryId" SET NOT NULL;
ALTER TABLE "support_tickets" DROP COLUMN "category";
DROP TYPE "TicketCategory";
CREATE INDEX "support_tickets_categoryId_idx" ON "support_tickets" ("categoryId");
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "taxonomies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
