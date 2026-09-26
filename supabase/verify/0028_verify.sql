-- Verify migration 0028 (Phase 13 — Social Enterprise: สินน้ำใจ, ผู้สนับสนุน, รายได้). Read-only.
-- Paste into Supabase SQL Editor → Run. Every row should say ✅ ผ่าน. Safe before 0028 (❌ instead of errors).
select check_name, case when ok then '✅ ผ่าน' else '❌ ไม่ผ่าน' end as result
from (values
  ('ตาราง SE ครบ + เปิด RLS',
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
       and c.relname in ('platform_settings','rewards','partners','partner_perks','perk_vouchers','funding_records')) = 6),
  ('ค่าตั้งต้น: ค่าดำเนินการ 2% โหมดสาธิต (ไม่มีเงินจริง)',
    case when to_regclass('public.platform_settings') is null then false
         else (xpath('/row/ok/text()', query_to_xml(
                'select (payment_mode = ''demo'')::text as ok from public.platform_settings where id = 1', false, true, '')))[1]::text = 'true' end),
  ('ฟังก์ชันสินน้ำใจ/คูปอง/รายได้ ครบ (SECURITY DEFINER)',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.proname in
       ('pledge_reward','cancel_reward_pledge','offer_reward_after_return','pay_reward_demo','set_reward_choice',
        'settle_reward','cancel_reward_admin','my_rewards','issue_perk_voucher','redeem_perk_voucher',
        'revoke_perk_voucher','my_vouchers','record_funding','void_funding','update_platform_settings','se_summary')) = 16),
  ('สินน้ำใจเกิดหลังส่งมอบสำเร็จเท่านั้น (trigger บน handovers)',
    exists (select 1 from pg_trigger where tgname = 'trg_handovers_se')),
  ('ผู้ใช้เขียนตาราง rewards / คูปอง / รายได้ ตรงไม่ได้',
    case when to_regclass('public.rewards') is null then false
         else not has_table_privilege('authenticated', 'public.rewards', 'insert')
          and not has_table_privilege('authenticated', 'public.rewards', 'update')
          and not has_table_privilege('authenticated', 'public.perk_vouchers', 'insert')
          and not has_table_privilege('authenticated', 'public.funding_records', 'insert')
          and not has_table_privilege('authenticated', 'public.platform_settings', 'update') end),
  ('guest อ่านได้เฉพาะ public_partners / public_impact / platform_settings',
    case when to_regclass('public.rewards') is null then false
         else not has_table_privilege('anon', 'public.rewards', 'select')
          and not has_table_privilege('anon', 'public.partners', 'select')
          and not has_table_privilege('anon', 'public.perk_vouchers', 'select')
          and not has_table_privilege('anon', 'public.funding_records', 'select')
          and has_table_privilege('anon', 'public.public_partners', 'select')
          and has_table_privilege('anon', 'public.public_impact', 'select') end),
  ('ประกาศสาธารณะไม่มีข้อมูลสินน้ำใจ',
    not exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name in ('public_lost_items','public_found_items') and column_name ~ 'reward')),
  ('guest เรียกฟังก์ชันได้เฉพาะ is_admin / is_staff_or_admin (รวมฟังก์ชันใหม่)',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
                  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
                  and p.proname not in ('is_admin', 'is_staff_or_admin')
                  and has_function_privilege('anon', p.oid, 'execute')))
) as t(check_name, ok);
