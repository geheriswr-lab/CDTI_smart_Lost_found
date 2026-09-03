-- =========================================================
-- 0001_enums.sql
-- CDTI Smart Lost & Found — Phase 1: Enum types
-- =========================================================

create type public.user_type_enum as enum (
  'vocational_student',
  'university_student',
  'teacher_staff',
  'royal_household_staff',
  'external_visitor'
);

create type public.system_role_enum as enum (
  'user',
  'staff',
  'admin'
);

create type public.lost_item_status_enum as enum (
  'reported',
  'matched',
  'claim_pending',
  'returned',
  'closed',
  'cancelled'
);

create type public.found_item_status_enum as enum (
  'reported',
  'in_custody',
  'matched',
  'claim_pending',
  'verified',
  'returned',
  'closed'
);

create type public.custody_status_enum as enum (
  'with_finder',
  'transferred_to_staff',
  'in_storage',
  'released_to_owner'
);

create type public.claim_status_enum as enum (
  'pending',
  'insufficient',
  'needs_review',
  'likely_owner',
  'verified',
  'approved',
  'rejected',
  'disputed',
  'cancelled'
);

create type public.verification_level_enum as enum (
  'standard',
  'enhanced'
);

create type public.risk_level_enum as enum (
  'low',
  'medium',
  'high'
);
