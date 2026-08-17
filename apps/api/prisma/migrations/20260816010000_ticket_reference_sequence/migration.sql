-- Support ticket references from a sequence rather than a row count.
--
-- `count() + 1` is not collision-proof at READ COMMITTED, and is not monotonic:
-- `SupportTicket.requesterId` cascades on delete, so removing a departed
-- employee lowered the count and the next submissions collided with references
-- that already existed.
--
-- The sequence starts above the highest reference already issued, so existing
-- tickets keep their numbers and no new ticket can reuse one.

CREATE SEQUENCE IF NOT EXISTS support_ticket_reference_seq AS BIGINT START WITH 1 INCREMENT BY 1;

SELECT setval(
  'support_ticket_reference_seq',
  GREATEST(
    (
      SELECT COALESCE(MAX(NULLIF(regexp_replace("reference", '\D', '', 'g'), ''))::BIGINT, 0)
      FROM "support_tickets"
    ),
    1
  ),
  true
);
