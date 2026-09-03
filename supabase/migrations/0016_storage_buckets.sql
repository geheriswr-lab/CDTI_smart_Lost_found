-- =========================================================
-- 0016_storage_buckets.sql
-- Two storage buckets:
--   item-images-public   -> public=true  (lost/found public photos)
--   verification-private -> public=false (claim evidence, private item photos)
-- =========================================================

insert into storage.buckets (id, name, public)
values ('item-images-public', 'item-images-public', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('verification-private', 'verification-private', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------
-- item-images-public: anyone can view; only authenticated
-- users can upload, and only into a folder matching their own
-- user id (prefix convention: <auth.uid()>/filename.ext)
-- ---------------------------------------------------------
create policy storage_public_images_select
  on storage.objects for select
  using (bucket_id = 'item-images-public');

create policy storage_public_images_insert_own_folder
  on storage.objects for insert
  with check (
    bucket_id = 'item-images-public'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy storage_public_images_delete_own_or_staff
  on storage.objects for delete
  using (
    bucket_id = 'item-images-public'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff_or_admin())
  );

-- ---------------------------------------------------------
-- verification-private: NEVER publicly readable. Only the
-- uploader (own folder) and staff/admin may read; only the
-- uploader may insert into their own folder.
-- ---------------------------------------------------------
create policy storage_private_evidence_select_own_or_staff
  on storage.objects for select
  using (
    bucket_id = 'verification-private'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff_or_admin())
  );

create policy storage_private_evidence_insert_own_folder
  on storage.objects for insert
  with check (
    bucket_id = 'verification-private'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy storage_private_evidence_delete_staff
  on storage.objects for delete
  using (
    bucket_id = 'verification-private'
    and public.is_staff_or_admin()
  );
