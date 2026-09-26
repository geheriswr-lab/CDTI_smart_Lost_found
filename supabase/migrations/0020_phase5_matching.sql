-- =========================================================
-- 0020_phase5_matching.sql
-- Phase 5 — Smart Matching
--
-- Matching itself runs in the app server (src/lib/matching/*) with the
-- service-role key, because Thai keyword matching needs proper word
-- segmentation (Intl.Segmenter) that Postgres doesn't provide. The DB side
-- only needs:
--   1. Notifications: users may flip is_read on their own rows and NOTHING
--      else. The Phase 1 UPDATE policy limits rows but not columns, so a
--      user could previously rewrite title/message/payload/type/user_id of
--      their own notifications via the API. Column-level privilege fixes it.
--   2. anon gets no privileges on matches / notifications.
--   3. Indexes for "matches of my lost item" and "my unread notifications".
--
-- matches / notifications / audit_logs still have NO client INSERT policy:
-- only the service-role matching job can create them.
-- =========================================================

-- Guests never need these tables at all.
revoke all on public.matches from anon;
revoke all on public.notifications from anon;

revoke update on public.notifications from anon, authenticated;
grant update (is_read) on public.notifications to authenticated;

create index if not exists idx_matches_lost_score
  on public.matches (lost_item_id, score desc);
create index if not exists idx_matches_found
  on public.matches (found_item_id);
create index if not exists idx_notifications_user_unread
  on public.notifications (user_id, is_read, created_at desc);
