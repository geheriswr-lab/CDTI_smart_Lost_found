-- =========================================================
-- 0010_risk_events.sql
-- =========================================================

create table public.risk_events (
  id                uuid primary key default gen_random_uuid(),
  event_type        text not null,   -- e.g. 'frequent_claims','repeated_rejections','duplicate_claim_target','answer_changed','new_account_high_value'
  risk_level        public.risk_level_enum not null default 'low',
  related_user_id   uuid references public.profiles(id),
  related_item_id   uuid,            -- may point to lost_items.id or found_items.id (app-level union, no FK to keep it generic)
  related_claim_id  uuid references public.claims(id),
  resolution        text,            -- neutral wording only, e.g. 'needs_review' — never "thief"/"scammer"
  resolved_by       uuid references public.profiles(id),
  resolved_at       timestamptz,
  created_at        timestamptz not null default now()
);

alter table public.risk_events enable row level security;

-- Staff/admin only, full stop. Risk signals are never exposed to end users.
create policy risk_events_select_staff
  on public.risk_events for select
  using (public.is_staff_or_admin());

create policy risk_events_update_staff
  on public.risk_events for update
  using (public.is_staff_or_admin())
  with check (public.is_staff_or_admin());

-- No INSERT policy for authenticated/anon: risk events are raised by
-- server-side risk-detection logic (service role) only.
