-- =========================================================
-- 0018_phase3_reporting.sql
-- Phase 3 — Lost / Found Reporting
--
-- What this adds (all enforced in the DB, not just the UI):
--   1. categories.is_high_value + generic category seed (idempotent).
--      Locations are NOT seeded — real campus locations must be confirmed
--      by the institution and added by an admin.
--   2. Report guards on lost_items / found_items (BEFORE INSERT/UPDATE):
--      - restricted accounts cannot create reports
--      - new reports always start as status='reported'
--      - finder may only self-declare custody 'with_finder' or
--        'transferred_to_staff' (in_storage / released_to_owner are
--        staff-only states, set later in Phase 8)
--      - non-staff owners cannot change status / custody_status /
--        reporter_id / finder_id after creation
--      - dates cannot be in the future
--      - text length limits
--      - image columns must be object paths that the caller actually
--        uploaded into the correct bucket under their own folder
--        (<auth.uid()>/...). This stops a user from pointing
--        public_image_url at an arbitrary external URL, or at someone
--        else's private evidence file.
--      - simple anti-spam limit: max 10 reports / hour / user / table
--   3. AFTER INSERT triggers (SECURITY DEFINER) that write:
--      - audit_logs  ('lost_item.created' / 'found_item.created')
--      - custody_history initial entry for found items
--      Both tables have no client INSERT policy, so these rows cannot be
--      forged or skipped by the client. Metadata never contains private
--      or secret fields.
--
-- Image column convention (from Phase 3 on):
--   public_image_url  = object path in bucket 'item-images-public'
--   private_image_url = object path in bucket 'verification-private'
--   e.g. '6f1c…/lost/2b9e….jpg'. The app builds the public URL with
--   storage.getPublicUrl() and private images are only ever served via
--   short-lived signed URLs to the owner / staff.
--
-- Service-role / SQL-editor sessions (auth.uid() is null) bypass the
-- per-user checks so admins can still fix data manually.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Categories: high-value flag + seed
-- ---------------------------------------------------------
alter table public.categories
  add column if not exists is_high_value boolean not null default false;

comment on column public.categories.is_high_value is
  'UI hint: finders are strongly advised to hand these items to the central drop-off point. Also used by Phase 6 to pick verification_level.';

insert into public.categories (name_th, name_en, is_high_value)
select v.name_th, v.name_en, v.is_high_value
from (values
  ('โทรศัพท์มือถือ',              'Mobile phone',          true),
  ('คอมพิวเตอร์ / แท็บเล็ต',       'Laptop / Tablet',       true),
  ('อุปกรณ์อิเล็กทรอนิกส์อื่น ๆ',   'Other electronics',     true),
  ('กระเป๋าสตางค์',                'Wallet',                true),
  ('เครื่องประดับ / นาฬิกา',        'Jewelry / Watch',       true),
  ('กุญแจ',                       'Keys',                  false),
  ('บัตร (บัตรนักศึกษา / บัตรต่าง ๆ)','Cards',                false),
  ('กระเป๋า',                     'Bag',                   false),
  ('เอกสาร / หนังสือ',             'Documents / Books',     false),
  ('เสื้อผ้า / เครื่องแต่งกาย',       'Clothing',              false),
  ('ขวดน้ำ / ภาชนะ',               'Bottle / Container',    false),
  ('เครื่องเขียน',                  'Stationery',            false),
  ('อื่น ๆ',                        'Other',                 false)
) as v(name_th, name_en, is_high_value)
where not exists (
  select 1 from public.categories c where c.name_th = v.name_th
);

-- ---------------------------------------------------------
-- 2. Shared helpers
-- ---------------------------------------------------------

-- True when `path` is an object the current user uploaded into `bucket`
-- under their own folder. SECURITY DEFINER so it can read storage.objects
-- regardless of storage RLS.
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
    and split_part(path, '/', 1) = auth.uid()::text
    and position('..' in path) = 0
    and exists (
      select 1 from storage.objects o
      where o.bucket_id = bucket and o.name = path
    );
$$;

revoke all on function public.is_own_storage_object(text, text) from public;
grant execute on function public.is_own_storage_object(text, text) to authenticated;

create or replace function public.assert_max_len(val text, max_len int, field text)
returns void
language plpgsql
immutable
as $$
begin
  if val is not null and char_length(val) > max_len then
    raise exception 'REPORT_INVALID: % exceeds % characters', field, max_len
      using errcode = 'check_violation';
  end if;
end;
$$;

-- ---------------------------------------------------------
-- 3. lost_items guard
-- ---------------------------------------------------------
create or replace function public.guard_lost_item_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  is_staff boolean := public.is_staff_or_admin();
  recent_count int;
begin
  -- Trusted server context (service role / SQL editor): skip user checks.
  if uid is null then
    return new;
  end if;

  -- Field validation (insert and update).
  if char_length(btrim(coalesce(new.item_name, ''))) = 0 then
    raise exception 'REPORT_INVALID: item_name is required' using errcode = 'check_violation';
  end if;
  perform public.assert_max_len(new.item_name, 120, 'item_name');
  perform public.assert_max_len(new.brand, 80, 'brand');
  perform public.assert_max_len(new.color, 50, 'color');
  perform public.assert_max_len(new.description, 2000, 'description');
  perform public.assert_max_len(new.private_ownership_details, 2000, 'private_ownership_details');

  if new.lost_date is not null
     and new.lost_date > (now() at time zone 'Asia/Bangkok')::date then
    raise exception 'REPORT_INVALID: lost_date cannot be in the future' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if exists (select 1 from public.profiles p where p.id = uid and p.is_restricted) then
      raise exception 'REPORT_FORBIDDEN: account is restricted' using errcode = 'insufficient_privilege';
    end if;

    if not is_staff then
      new.status := 'reported';

      select count(*) into recent_count
      from public.lost_items
      where reporter_id = uid and created_at > now() - interval '1 hour';
      if recent_count >= 10 then
        raise exception 'REPORT_RATE_LIMIT: too many reports' using errcode = 'check_violation';
      end if;
    end if;
  else
    -- UPDATE by a non-staff owner: lifecycle fields are not theirs to change.
    if not is_staff then
      if new.reporter_id is distinct from old.reporter_id
         or new.status is distinct from old.status then
        raise exception 'REPORT_FORBIDDEN: cannot change reporter or status' using errcode = 'insufficient_privilege';
      end if;
    end if;
  end if;

  -- Image paths: only validate when set/changed, so staff edits of other
  -- fields don't fail on paths uploaded by the reporter.
  if new.public_image_url is not null
     and (tg_op = 'INSERT' or new.public_image_url is distinct from old.public_image_url)
     and not public.is_own_storage_object('item-images-public', new.public_image_url) then
    raise exception 'REPORT_INVALID: public_image_url must be your own upload in item-images-public'
      using errcode = 'check_violation';
  end if;

  if new.private_image_url is not null
     and (tg_op = 'INSERT' or new.private_image_url is distinct from old.private_image_url)
     and not public.is_own_storage_object('verification-private', new.private_image_url) then
    raise exception 'REPORT_INVALID: private_image_url must be your own upload in verification-private'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_lost_items_guard on public.lost_items;
create trigger trg_lost_items_guard
  before insert or update on public.lost_items
  for each row execute function public.guard_lost_item_report();

-- ---------------------------------------------------------
-- 4. found_items guard
-- ---------------------------------------------------------
create or replace function public.guard_found_item_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  is_staff boolean := public.is_staff_or_admin();
  recent_count int;
begin
  if uid is null then
    return new;
  end if;

  if char_length(btrim(coalesce(new.general_name, ''))) = 0 then
    raise exception 'REPORT_INVALID: general_name is required' using errcode = 'check_violation';
  end if;
  perform public.assert_max_len(new.general_name, 120, 'general_name');
  perform public.assert_max_len(new.color, 50, 'color');
  perform public.assert_max_len(new.description, 2000, 'description');
  perform public.assert_max_len(new.exact_location, 300, 'exact_location');
  perform public.assert_max_len(new.serial_number, 120, 'serial_number');
  perform public.assert_max_len(new.secret_details, 2000, 'secret_details');

  if new.found_date is not null
     and new.found_date > (now() at time zone 'Asia/Bangkok')::date then
    raise exception 'REPORT_INVALID: found_date cannot be in the future' using errcode = 'check_violation';
  end if;
  if new.exact_time is not null and new.exact_time > now() + interval '5 minutes' then
    raise exception 'REPORT_INVALID: exact_time cannot be in the future' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if exists (select 1 from public.profiles p where p.id = uid and p.is_restricted) then
      raise exception 'REPORT_FORBIDDEN: account is restricted' using errcode = 'insufficient_privilege';
    end if;

    if not is_staff then
      new.status := 'reported';

      -- A finder can only self-declare where the item is right now.
      -- in_storage / released_to_owner are set by staff (Phase 8).
      if new.custody_status not in ('with_finder', 'transferred_to_staff') then
        raise exception 'REPORT_INVALID: invalid initial custody_status' using errcode = 'check_violation';
      end if;

      select count(*) into recent_count
      from public.found_items
      where finder_id = uid and created_at > now() - interval '1 hour';
      if recent_count >= 10 then
        raise exception 'REPORT_RATE_LIMIT: too many reports' using errcode = 'check_violation';
      end if;
    end if;
  else
    if not is_staff then
      if new.finder_id is distinct from old.finder_id
         or new.status is distinct from old.status
         or new.custody_status is distinct from old.custody_status then
        raise exception 'REPORT_FORBIDDEN: cannot change finder, status or custody' using errcode = 'insufficient_privilege';
      end if;
    end if;
  end if;

  if new.public_image_url is not null
     and (tg_op = 'INSERT' or new.public_image_url is distinct from old.public_image_url)
     and not public.is_own_storage_object('item-images-public', new.public_image_url) then
    raise exception 'REPORT_INVALID: public_image_url must be your own upload in item-images-public'
      using errcode = 'check_violation';
  end if;

  if new.private_image_url is not null
     and (tg_op = 'INSERT' or new.private_image_url is distinct from old.private_image_url)
     and not public.is_own_storage_object('verification-private', new.private_image_url) then
    raise exception 'REPORT_INVALID: private_image_url must be your own upload in verification-private'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_found_items_guard on public.found_items;
create trigger trg_found_items_guard
  before insert or update on public.found_items
  for each row execute function public.guard_found_item_report();

-- ---------------------------------------------------------
-- 5. Audit + custody history on create (tamper-resistant)
-- ---------------------------------------------------------
create or replace function public.log_lost_item_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    'lost_item.created',
    'lost_item',
    new.id,
    -- Public-safe fields only. Never private_ownership_details / private_image_url.
    jsonb_build_object(
      'category_id', new.category_id,
      'location_id', new.location_id,
      'has_public_image', new.public_image_url is not null,
      'has_private_image', new.private_image_url is not null
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_lost_items_created_log on public.lost_items;
create trigger trg_lost_items_created_log
  after insert on public.lost_items
  for each row execute function public.log_lost_item_created();

create or replace function public.log_found_item_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.custody_history (found_item_id, from_status, to_status, handled_by, notes)
  values (
    new.id,
    null,
    new.custody_status,
    new.finder_id,
    'Initial custody status declared by finder at report time (not yet confirmed by staff)'
  );

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    'found_item.created',
    'found_item',
    new.id,
    -- Never include secret_details / serial_number / exact_location / exact_time.
    jsonb_build_object(
      'category_id', new.category_id,
      'location_id', new.location_id,
      'custody_status', new.custody_status,
      'has_public_image', new.public_image_url is not null,
      'has_private_image', new.private_image_url is not null
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_found_items_created_log on public.found_items;
create trigger trg_found_items_created_log
  after insert on public.found_items
  for each row execute function public.log_found_item_created();

-- ---------------------------------------------------------
-- 6. Storage: file size / type limits on the two buckets
--    (defense in depth — the app validates too)
-- ---------------------------------------------------------
update storage.buckets
set file_size_limit = 5 * 1024 * 1024,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'item-images-public';

update storage.buckets
set file_size_limit = 5 * 1024 * 1024,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
where id = 'verification-private';
