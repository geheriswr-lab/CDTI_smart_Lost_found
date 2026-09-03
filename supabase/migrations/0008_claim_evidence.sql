-- =========================================================
-- 0008_claim_evidence.sql
-- =========================================================

create table public.claim_evidence (
  id           uuid primary key default gen_random_uuid(),
  claim_id     uuid not null references public.claims(id) on delete cascade,
  evidence_url text not null,   -- points into the PRIVATE storage bucket
  description  text,
  created_at   timestamptz not null default now()
);

alter table public.claim_evidence enable row level security;

-- Visible only to: the claimant who owns the parent claim, and staff/admin.
-- Never to the finder, never to the public.
create policy claim_evidence_select_owner_or_staff
  on public.claim_evidence for select
  using (
    public.is_staff_or_admin()
    or exists (select 1 from public.claims c where c.id = claim_id and c.claimant_id = auth.uid())
  );

create policy claim_evidence_insert_owner
  on public.claim_evidence for insert
  with check (
    exists (select 1 from public.claims c where c.id = claim_id and c.claimant_id = auth.uid())
  );

-- Evidence is immutable once submitted: no UPDATE policy.
-- Only staff/admin may delete (e.g. moderation of inappropriate upload).
create policy claim_evidence_delete_staff
  on public.claim_evidence for delete
  using (public.is_staff_or_admin());
