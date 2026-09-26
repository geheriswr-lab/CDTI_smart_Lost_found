-- Minimal stand-ins for Supabase's auth/storage schemas so the migrations
-- can be tested on plain Postgres (see supabase/tests/phase3_reporting.test.sql).
-- NOT for use against a real Supabase project.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create extension if not exists pgcrypto;
create schema if not exists auth;
create schema if not exists storage;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb, encrypted_password text, email_confirmed_at timestamptz default now());
-- Mirrors Supabase: supports both the legacy GUC and PostgREST >= 10's request.jwt.claims JSON.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id), name text, owner uuid, owner_id text);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
grant usage on schema public, auth, storage to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
