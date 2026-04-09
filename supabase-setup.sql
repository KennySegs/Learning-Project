-- Run this in Supabase → SQL Editor after creating your project.
-- Then enable the policies so the anon key can insert from your site.

create table if not exists public.consultation_leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text,
  phone text,
  email text not null,
  support text,
  created_at timestamptz not null default now()
);

alter table public.consultation_leads enable row level security;

-- Allow anonymous inserts from your landing page (anon key)
create policy "Allow public insert for consultation leads"
  on public.consultation_leads
  for insert
  to anon
  with check (true);

-- Optional: block public reads so leads stay private (service role / dashboard only)
-- No SELECT policy for anon = anon cannot read rows.

-- ---------------------------------------------------------------------------
-- Post-ICU profiles (Clerk user id as primary key)
-- Requires: Supabase Dashboard → Authentication → Third-party auth → Clerk,
-- and Clerk Dashboard → JWT Templates → Supabase (name: "supabase").
-- JWT subject (sub) must equal profiles.id (Clerk user id).
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.user_role as enum (
    'patient',
    'doctor',
    'nurse',
    'physiotherapist'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id text primary key,
  email text,
  role public.user_role not null,
  full_name text,
  phone text,
  address_line1 text,
  city text,
  region text,
  postal_code text,
  country text default 'NG',
  latitude double precision,
  longitude double precision,
  location_consent_at timestamptz,
  service_radius_km double precision default 25,
  accepting_new_patients boolean default true,
  telehealth_ok boolean default false,
  in_person_ok boolean default true,
  languages text[] default array['English']::text[],
  specialty_tags text[] default '{}'::text[],
  profile_json jsonb not null default '{}'::jsonb,
  onboarding_completed boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_geo_idx on public.profiles (latitude, longitude)
  where latitude is not null and longitude is not null;

create or replace function public.set_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute procedure public.set_profiles_updated_at();

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (auth.jwt() ->> 'sub' = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check (auth.jwt() ->> 'sub' = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (auth.jwt() ->> 'sub' = id)
  with check (auth.jwt() ->> 'sub' = id);

-- Haversine distance (km) between two WGS84 points
create or replace function public.haversine_km(
  lat1 double precision,
  lon1 double precision,
  lat2 double precision,
  lon2 double precision
)
returns double precision
language sql
immutable
strict
as $$
  select (
    6371.0 * 2.0 * asin(
      sqrt(
        least(
          1.0,
          pow(sin(radians(lat2 - lat1) / 2.0), 2)
          + cos(radians(lat1)) * cos(radians(lat2))
            * pow(sin(radians(lon2 - lon1) / 2.0), 2)
        )
      )
    )
  )::double precision;
$$;

-- Match patients to nearest providers by role; returns only non-sensitive fields.
create or replace function public.search_providers(
  p_lat double precision,
  p_lng double precision,
  p_role text,
  p_max_km double precision default 50
)
returns table (
  id text,
  full_name text,
  role public.user_role,
  distance_km double precision,
  city text,
  region text,
  specialty_tags text[],
  languages text[],
  telehealth_ok boolean,
  in_person_ok boolean,
  service_radius_km double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.full_name,
    p.role,
    public.haversine_km(p_lat, p_lng, p.latitude, p.longitude) as distance_km,
    p.city,
    p.region,
    p.specialty_tags,
    p.languages,
    p.telehealth_ok,
    p.in_person_ok,
    p.service_radius_km
  from public.profiles p
  where p.role = p_role::public.user_role
    and p.accepting_new_patients = true
    and p.latitude is not null
    and p.longitude is not null
    and p_role in ('doctor', 'nurse', 'physiotherapist')
    and public.haversine_km(p_lat, p_lng, p.latitude, p.longitude)
      <= least(coalesce(p.service_radius_km, 25.0), coalesce(p_max_km, 50.0))
  order by distance_km asc
  limit 25;
$$;

revoke all on function public.search_providers(double precision, double precision, text, double precision) from public;
grant execute on function public.search_providers(double precision, double precision, text, double precision) to authenticated;

revoke all on function public.haversine_km(double precision, double precision, double precision, double precision) from public;
grant execute on function public.haversine_km(double precision, double precision, double precision, double precision) to authenticated;
