-- =========================================================
-- 0019_phase4_public_listing.sql
-- Phase 4 — Public Listing + Search
--
-- 1. Anonymous public image paths.
--    Until now public images were stored as '<auth.uid()>/<kind>/<file>'.
--    That path is part of the public URL, so every listing photo leaked the
--    reporter's / finder's user id (and let anyone link all items reported
--    by the same person). New public uploads go to '<kind>/<random>.<ext>'
--    (kind = lost|found) and ownership is tracked by storage.objects.owner_id
--    (set by the Storage API from the uploader's JWT), not by the path.
--    The private bucket keeps the '<uid>/...' convention — its paths are
--    never shown publicly.
--
-- 2. is_own_storage_object() now accepts either owner_id = caller or the
--    legacy '<uid>/' folder, so Phase 3 rows stay valid.
--
-- 3. Search indexes for the public listing filters.
--
-- 4. Explicit grants: anon/authenticated may read the public views, and
--    anon gets NO privileges on the base report tables at all (RLS already
--    returns zero rows; this removes the table from anon's reach entirely).
-- =========================================================

-- ---------------------------------------------------------
-- 1. Public bucket policies
-- ---------------------------------------------------------
drop policy if exists storage_public_images_insert_own_folder on storage.objects;
drop policy if exists storage_public_images_insert_anonymous_path on storage.objects;
create policy storage_public_images_insert_anonymous_path
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'item-images-public'
    and (storage.foldername(name))[1] in ('lost', 'found')
    and array_length(storage.foldername(name), 1) = 1
  );

drop policy if exists storage_public_images_delete_own_or_staff on storage.objects;
create policy storage_public_images_delete_own_or_staff
  on storage.objects for delete
  using (
    bucket_id = 'item-images-public'
    and (
      owner_id = auth.uid()::text
      or (storage.foldername(name))[1] = auth.uid()::text   -- legacy Phase 3 paths
      or public.is_staff_or_admin()
    )
  );

-- ---------------------------------------------------------
-- 2. Ownership check used by the report guards (0018)
-- ---------------------------------------------------------
create or replace function public.is_own_storage_object(bucket text, path text)
returns boolean
language sql
security definer
stable
set search_path = public, storage
as $$
  select
    path is not null
    and auth.uid() is not null
    and position('..' in path) = 0
    and exists (
      select 1 from storage.objects o
      where o.bucket_id = bucket
        and o.name = path
        and (
          o.owner_id = auth.uid()::text
          or split_part(path, '/', 1) = auth.uid()::text
        )
    );
$$;

revoke all on function public.is_own_storage_object(text, text) from public;
grant execute on function public.is_own_storage_object(text, text) to authenticated;

-- ---------------------------------------------------------
-- 3. Indexes for listing / search
-- ---------------------------------------------------------
create index if not exists idx_lost_items_public_listing
  on public.lost_items (status, created_at desc);
create index if not exists idx_lost_items_category on public.lost_items (category_id);
create index if not exists idx_lost_items_location on public.lost_items (location_id);
create index if not exists idx_lost_items_lost_date on public.lost_items (lost_date);

create index if not exists idx_found_items_public_listing
  on public.found_items (status, created_at desc);
create index if not exists idx_found_items_category on public.found_items (category_id);
create index if not exists idx_found_items_location on public.found_items (location_id);
create index if not exists idx_found_items_found_date on public.found_items (found_date);

-- ---------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------
revoke all on public.lost_items from anon;
revoke all on public.found_items from anon;

grant select on public.public_lost_items to anon, authenticated;
grant select on public.public_found_items to anon, authenticated;
