-- C1 freshness guard: commitApprovedProposals now retires stale proposals (whose transaction was
-- manually classified after the proposal was generated) by setting status = 'skipped' so they
-- don't linger as 'approved' and get retried on the next commit. The original CHECK only permitted
-- ('pending','approved','rejected','committed'); widen it to include 'skipped'.
--
-- 'skipped' is a distinct terminal state from 'rejected' (operator-rejected) — it records that the
-- system declined to overwrite existing work, not that a human said no.

alter table classification_proposals
  drop constraint if exists classification_proposals_status_check;

alter table classification_proposals
  add constraint classification_proposals_status_check
  check (status in ('pending', 'approved', 'rejected', 'committed', 'skipped'));
