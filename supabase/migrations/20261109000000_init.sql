-- JIAS 2026 — schema inicial (rodado por `supabase db push` ou colado no SQL Editor).

create table if not exists teams (
  id text primary key, name text not null, pos int not null default 0
);
create table if not exists sports (
  id text primary key, name text not null, pos int not null default 0,
  enrolled jsonb not null default '[]',
  format text not null default 'knockout' check (format in ('knockout','rr')),
  third boolean not null default true,
  "double" boolean not null default false
);
-- estrutura do chaveamento (resultado do sorteio) — só o admin grava
create table if not exists brackets (
  sport_id text primary key references sports(id) on delete cascade,
  data jsonb not null, updated_at timestamptz not null default now()
);
-- horário, local e placar de cada jogo — admin e mesário gravam
create table if not exists match_results (
  sport_id text not null references sports(id) on delete cascade,
  match_id text not null,
  date text, "time" text, place text,
  status text check (status in ('live','final')),
  sa int, sb int, pa text, pb text, tb text,
  updated_at timestamptz not null default now(),
  primary key (sport_id, match_id)
);
create table if not exists food (
  team_id text primary key references teams(id) on delete cascade,
  kg numeric not null default 0
);
create table if not exists config (
  id int primary key default 1 check (id = 1), data jsonb not null default '{}'
);
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','scorer'))
);

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_touch_mr on match_results;
create trigger trg_touch_mr before update on match_results for each row execute function touch_updated_at();

-- papéis
create or replace function is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where user_id = auth.uid() and role = 'admin') $$;
create or replace function is_scorer() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where user_id = auth.uid() and role in ('admin','scorer')) $$;

-- RLS: todo mundo lê; escrita só por papel
alter table teams enable row level security;
alter table sports enable row level security;
alter table brackets enable row level security;
alter table match_results enable row level security;
alter table food enable row level security;
alter table config enable row level security;
alter table profiles enable row level security;

do $$ declare t text; begin
  foreach t in array array['teams','sports','brackets','match_results','food','config'] loop
    execute format('drop policy if exists "read all" on %I', t);
    execute format('create policy "read all" on %I for select to anon, authenticated using (true)', t);
  end loop;
  foreach t in array array['teams','sports','brackets','config'] loop
    execute format('drop policy if exists "admin write" on %I', t);
    execute format('create policy "admin write" on %I for all to authenticated using (is_admin()) with check (is_admin())', t);
  end loop;
  foreach t in array array['match_results','food'] loop
    execute format('drop policy if exists "scorer write" on %I', t);
    execute format('create policy "scorer write" on %I for all to authenticated using (is_scorer()) with check (is_scorer())', t);
  end loop;
end $$;
drop policy if exists "own profile" on profiles;
create policy "own profile" on profiles for select to authenticated using (user_id = auth.uid());

-- tempo real
do $$ declare t text; begin
  foreach t in array array['teams','sports','brackets','match_results','food','config'] loop
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;

-- dados iniciais (opcional)
insert into config (id, data) values (1, '{}') on conflict do nothing;
insert into teams (id, name, pos) values
  ('t_marreco','Marreco',0),('t_urso','Urso',1),('t_macaco','Macaco',2),('t_indio','Índio',3),
  ('t_predadores','Predadores',4),('t_impiedosos','Impiedosos',5),('t_devora','Devora',6),('t_sanguinaria','Sanguinária',7)
  on conflict do nothing;
insert into sports (id, name, pos) values
  ('s_handebol','Handebol',0),('s_futsal','Futsal',1),('s_volei','Vôlei',2),('s_basquete','Basquete',3)
  on conflict do nothing;

-- PAPÉIS: use scripts/create-user.sh (ou crie em Authentication > Users e insira em profiles).
