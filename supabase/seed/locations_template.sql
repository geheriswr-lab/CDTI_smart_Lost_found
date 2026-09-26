-- =========================================================
-- Phase 12 — Seed REAL locations (template).
-- README: production may be seeded only with categories, system config and
-- locations that the institution has CONFIRMED. Nothing below runs until you
-- replace the example rows with confirmed names and remove the comment marks.
--
-- Alternative: add them one by one in the app (admin → สถานที่ / จุดส่งมอบ),
-- which also writes the audit log with your name.
--
-- Safe to run more than once (skips names that already exist).
-- =========================================================

-- 1) Places where items are lost / found (shown in report forms and public listing)
insert into public.locations (name, description)
select v.name, v.description
from (values
  -- ('อาคาร 1 ชั้น 1', 'โถงหน้าลิฟต์'),
  -- ('โรงอาหาร', null),
  -- ('ห้องสมุด', null),
  (null::text, null::text)
) as v(name, description)
where v.name is not null
  and not exists (select 1 from public.locations l where l.name = v.name);

-- 2) Official handover points (where staff give items back; required before any handover)
insert into public.handover_locations (name, address)
select v.name, v.address
from (values
  -- ('ห้องประชาสัมพันธ์', 'อาคารอำนวยการ ชั้น 1 — เปิด จ.–ศ. 08:30–16:30'),
  (null::text, null::text)
) as v(name, address)
where v.name is not null
  and not exists (select 1 from public.handover_locations h where h.name = v.name);

select 'locations' as table_name, count(*) filter (where is_active) as active from public.locations
union all
select 'handover_locations', count(*) filter (where is_active) from public.handover_locations;
