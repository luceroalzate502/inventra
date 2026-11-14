-- ============================================================
-- INVENTRA · Esquema de sincronización multidispositivo
-- Ejecute este script completo en Supabase:
--   Dashboard → SQL Editor → New query → Run
-- ------------------------------------------------------------
-- La app guarda cada registro como una fila JSON. Las tablas
-- locales de IndexedDB conservan su estructura; aquí solo se
-- almacena la copia central que viaja entre dispositivos.
-- ============================================================

create table if not exists public.inventra_records (
  table_name        text        not null,
  record_id         text        not null,
  data              jsonb,
  deleted           boolean     not null default false,
  device_id         text,
  client_updated_at timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (table_name, record_id)
);

comment on table public.inventra_records is
  'Copia central de los registros de INVENTRA para sincronización offline-first.';

create index if not exists inventra_records_updated_at_idx
  on public.inventra_records (updated_at);

create index if not exists inventra_records_table_idx
  on public.inventra_records (table_name);

-- updated_at siempre lo asigna el servidor para que el cursor de
-- sincronización no dependa del reloj de los dispositivos.
-- Además, si un equipo envía una edición más antigua que la que ya está
-- guardada, la escritura se descarta (última escritura gana).
create or replace function public.inventra_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and (new.client_updated_at, coalesce(new.device_id, '')) <
         (old.client_updated_at, coalesce(old.device_id, '')) then
    return null;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists inventra_records_touch on public.inventra_records;
create trigger inventra_records_touch
before insert or update on public.inventra_records
for each row execute function public.inventra_touch_updated_at();

-- Seguridad: solo usuarios autenticados del proyecto pueden leer o escribir.
-- La app crea/inicia sesión con la cuenta de nube configurada en cada equipo.
alter table public.inventra_records enable row level security;

drop policy if exists "inventra_records_authenticated" on public.inventra_records;
create policy "inventra_records_authenticated"
  on public.inventra_records
  for all
  to authenticated
  using (true)
  with check (true);

-- Opcional: si desea habilitar Realtime más adelante.
-- alter publication supabase_realtime add table public.inventra_records;
