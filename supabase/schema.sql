-- Script de creación de tablas para la Base de Datos de Supabase (Idempotente)
-- Copiá este código, pegalo en tu SQL Editor y ejecutalo (Run).

-- 1. Habilitar extensión para UUIDs
create extension if not exists "uuid-ossp";

-- 2. Crear Tabla de Perfiles de Contratistas (profiles)
create table if not exists public.profiles (
  id text primary key, -- Telegram User ID
  company_name text not null,
  phone text,
  email text,
  address text,
  logo_url text,
  default_terms text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Habilitar Row Level Security (RLS)
alter table public.profiles enable row level security;

-- Borrar políticas previas si existen (evita errores al re-ejecutar)
drop policy if exists "Permitir lectura pública de perfiles" on public.profiles;
drop policy if exists "Permitir inserción y actualización total" on public.profiles;

-- Crear políticas para perfiles
create policy "Permitir lectura pública de perfiles" on public.profiles 
  for select using (true);

create policy "Permitir inserción y actualización total" on public.profiles 
  for all using (true);


-- 3. Crear Tabla de Presupuestos (budgets)
create table if not exists public.budgets (
  id uuid default uuid_generate_v4() primary key,
  user_id text references public.profiles(id) on delete cascade not null,
  client_name text not null,
  client_phone text,
  client_email text,
  status text default 'draft'::text check (status in ('draft', 'sent', 'viewed', 'accepted', 'cancelled')),
  pdf_url text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.budgets enable row level security;

drop policy if exists "Permitir lectura pública de presupuestos" on public.budgets;
drop policy if exists "Permitir gestión total de presupuestos" on public.budgets;

create policy "Permitir lectura pública de presupuestos" on public.budgets 
  for select using (true);

create policy "Permitir gestión total de presupuestos" on public.budgets 
  for all using (true);


-- 4. Crear Tabla de Ítems del Detalle (budget_items)
create table if not exists public.budget_items (
  id uuid default uuid_generate_v4() primary key,
  budget_id uuid references public.budgets(id) on delete cascade not null,
  description text not null,
  quantity numeric default 1.0 not null,
  unit_price numeric default 0.0 not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.budget_items enable row level security;

drop policy if exists "Permitir lectura pública de ítems" on public.budget_items;
drop policy if exists "Permitir gestión total de ítems" on public.budget_items;

create policy "Permitir lectura pública de ítems" on public.budget_items 
  for select using (true);

create policy "Permitir gestión total de ítems" on public.budget_items 
  for all using (true);


-- 5. Crear Tabla de Métricas de Lectura (budget_views)
create table if not exists public.budget_views (
  id uuid default uuid_generate_v4() primary key,
  budget_id uuid references public.budgets(id) on delete cascade not null,
  viewed_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.budget_views enable row level security;

drop policy if exists "Permitir inserción pública de lecturas" on public.budget_views;
drop policy if exists "Permitir lectura pública de métricas" on public.budget_views;

create policy "Permitir inserción pública de lecturas" on public.budget_views 
  for insert with check (true);

create policy "Permitir lectura pública de métricas" on public.budget_views 
  for select using (true);
