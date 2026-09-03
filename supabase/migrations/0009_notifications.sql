-- =========================================================
-- 0009_notifications.sql
-- =========================================================

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        text not null,          -- e.g. 'potential_match','claim_received','claim_approved', ...
  title       text not null,
  message     text not null,
  payload     jsonb not null default '{}'::jsonb,  -- MUST NOT contain secret_details, see app-layer rule
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table public.notifications enable row level security;

-- Users only ever see their own notifications.
create policy notifications_select_own
  on public.notifications for select
  using (user_id = auth.uid());

-- Users can mark their own notifications as read, nothing else.
create policy notifications_update_own_mark_read
  on public.notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Staff/admin can read all notifications for support/debugging.
create policy notifications_select_staff
  on public.notifications for select
  using (public.is_staff_or_admin());

-- No INSERT policy for authenticated/anon: notifications are created
-- server-side (service role / triggers) only, so app logic controls
-- exactly what payload is exposed and secret_details can never leak this way.
