-- =========================================================
-- 0011_audit_logs.sql
-- Append-only audit trail. Nobody — including admin — may UPDATE or DELETE.
-- =========================================================

create table public.audit_logs (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references public.profiles(id),  -- null allowed for system/service actions
  action       text not null,          -- e.g. 'item.created','claim.approved','handover.completed'
  entity_type  text not null,          -- e.g. 'lost_item','found_item','claim','handover_code'
  entity_id    uuid,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

alter table public.audit_logs enable row level security;

-- Staff/admin can read the audit trail.
create policy audit_logs_select_staff
  on public.audit_logs for select
  using (public.is_staff_or_admin());

-- No INSERT policy for authenticated/anon: audit rows are written exclusively
-- by server-side triggers/functions using the service role key.
-- No UPDATE or DELETE policy exists for ANY role — the table is immutable
-- by design (defense against tampering, even by a compromised admin session).
