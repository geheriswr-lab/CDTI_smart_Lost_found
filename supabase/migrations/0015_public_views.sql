-- =========================================================
-- 0015_public_views.sql
-- Public-safe views. These are the ONLY way anon/public users
-- browse listings — the base tables (lost_items/found_items)
-- have no public SELECT policy at all.
--
-- security_invoker = off (default for views) means the view runs
-- with the privileges of its owner, not the querying role — so it
-- can read the underlying table regardless of the caller's RLS
-- visibility, while only ever exposing the columns listed below.
-- =========================================================

create view public.public_lost_items
with (security_invoker = false) as
select
  li.id,
  li.category_id,
  c.name_th  as category_name_th,
  c.name_en  as category_name_en,
  li.item_name,
  li.color,
  li.lost_date,
  li.location_id,
  l.name     as location_name,
  li.description,
  li.public_image_url,
  li.status,
  li.created_at
from public.lost_items li
left join public.categories c on c.id = li.category_id
left join public.locations l on l.id = li.location_id
where li.status in ('reported', 'matched');
-- Explicitly EXCLUDED: reporter_id, private_ownership_details, private_image_url, updated_at

create view public.public_found_items
with (security_invoker = false) as
select
  fi.id,
  fi.category_id,
  c.name_th  as category_name_th,
  c.name_en  as category_name_en,
  fi.general_name,
  fi.color,
  fi.found_date,
  fi.location_id,
  l.name     as location_name,
  fi.description,
  fi.public_image_url,
  fi.status,
  fi.created_at
from public.found_items fi
left join public.categories c on c.id = fi.category_id
left join public.locations l on l.id = fi.location_id
where fi.status in ('reported', 'in_custody', 'matched');
-- Explicitly EXCLUDED: finder_id, private_image_url, exact_location, exact_time,
-- serial_number, secret_details, custody_status, updated_at

grant select on public.public_lost_items to anon, authenticated;
grant select on public.public_found_items to anon, authenticated;

comment on view public.public_lost_items is
  'Public/guest-safe listing. No reporter identity or private ownership details.';
comment on view public.public_found_items is
  'Public/guest-safe listing. No finder identity, secret_details, serial_number, or exact location/time.';
