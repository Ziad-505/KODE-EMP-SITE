-- Makes the audit trail genuinely append-only, and adds trigram indexes so the
-- portal's substring search stays fast as content grows.

-- 1. Audit immutability -------------------------------------------------------
--
-- The application layer exposes no update or delete path for audit_logs, but an
-- application-layer promise is only a promise. These triggers make UPDATE and
-- DELETE fail at the database, so a compromised API process, a stray migration
-- or a careless psql session cannot quietly rewrite history.
--
-- Retention pruning is intentionally not automated here: deleting old audit rows
-- is a deliberate act that should be performed by a DBA with the trigger
-- temporarily disabled, and recorded.

CREATE OR REPLACE FUNCTION audit_logs_reject_mutation() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is append-only; % is not permitted', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update
    BEFORE UPDATE ON "audit_logs"
    FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_mutation();

CREATE TRIGGER audit_logs_no_delete
    BEFORE DELETE ON "audit_logs"
    FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_mutation();

-- 2. Search indexes -----------------------------------------------------------
--
-- Portal search uses case-insensitive `contains`, which compiles to ILIKE
-- '%term%'. A btree index cannot serve that; a GIN trigram index can.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "articles_title_trgm_idx" ON "articles" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "articles_body_trgm_idx" ON "articles" USING GIN ("body" gin_trgm_ops);
CREATE INDEX "events_title_trgm_idx" ON "events" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "policies_title_trgm_idx" ON "policies" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "policies_body_trgm_idx" ON "policies" USING GIN ("body" gin_trgm_ops);
CREATE INDEX "faqs_question_trgm_idx" ON "faqs" USING GIN ("question" gin_trgm_ops);
CREATE INDEX "users_name_trgm_idx" ON "users" USING GIN (("firstName" || ' ' || "lastName") gin_trgm_ops);

-- 3. Partial indexes for the hot paths ----------------------------------------
--
-- Almost every portal query filters on "published and not deleted"; a partial
-- index keeps those lookups off the archived and soft-deleted rows entirely.

CREATE INDEX "articles_live_idx" ON "articles" ("publishedAt" DESC)
    WHERE "status" = 'PUBLISHED' AND "deletedAt" IS NULL;
CREATE INDEX "events_live_idx" ON "events" ("startsAt")
    WHERE "status" = 'PUBLISHED' AND "deletedAt" IS NULL;
