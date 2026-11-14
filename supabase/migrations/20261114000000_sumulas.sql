-- Súmulas digitais (futsal, handebol, vôlei, basquete…): uma por jogo.
-- Só ADICIONA tabelas, funções e gatilhos; não mexe em nada existente.
--
-- Regras (garantidas aqui no banco, não só na tela):
--  • só mesário e admin LEEM e criam/editam (o público não vê nada: sem política para "anon");
--  • quem criou, quem editou por último, quem fechou e quem reabriu ficam gravados (id + e-mail), sempre
--    preenchidos pelo próprio banco a partir do login — o site não consegue falsificar;
--  • depois de FECHADA, ninguém edita; só um admin pode REABRIR (e a reabertura fica no histórico);
--  • nada de DELETE: não há política de exclusão, e a súmula não some se a modalidade/sorteio mudar
--    (por isso sport_id/match_id não têm chave estrangeira; os nomes das atléticas ficam dentro de "data").

create table if not exists sumulas (
  id uuid primary key default gen_random_uuid(),
  sport_id text not null,
  match_id text not null,
  status text not null default 'open' check (status in ('open','closed')),
  data jsonb not null default '{}',
  created_by uuid, created_by_email text, created_at timestamptz not null default now(),
  updated_by uuid, updated_by_email text, updated_at timestamptz not null default now(),
  closed_by uuid, closed_by_email text, closed_at timestamptz,
  reopened_by uuid, reopened_by_email text, reopened_at timestamptz,
  unique (sport_id, match_id)
);

-- histórico: criou / editou (outra pessoa) / fechou / reabriu. Só os gatilhos escrevem aqui.
create table if not exists sumula_log (
  id bigint generated always as identity primary key,
  sumula_id uuid not null references sumulas(id),
  action text not null check (action in ('create','edit','close','reopen')),
  user_id uuid, user_email text,
  at timestamptz not null default now()
);
create index if not exists sumula_log_sumula on sumula_log (sumula_id, at);

-- antes de gravar: carimba o autor, trava o que não pode mudar e aplica a regra aberta/fechada
create or replace function sumulas_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); mail text := nullif(auth.jwt() ->> 'email', '');
begin
  if tg_op = 'INSERT' then
    new.status := 'open';
    new.created_by := uid; new.created_by_email := mail; new.created_at := now();
    new.updated_by := uid; new.updated_by_email := mail; new.updated_at := now();
    new.closed_by := null; new.closed_by_email := null; new.closed_at := null;
    new.reopened_by := null; new.reopened_by_email := null; new.reopened_at := null;
    return new;
  end if;

  -- UPDATE: identidade e autoria originais são imutáveis
  new.id := old.id; new.sport_id := old.sport_id; new.match_id := old.match_id;
  new.created_by := old.created_by; new.created_by_email := old.created_by_email; new.created_at := old.created_at;

  if old.status = 'closed' then
    if new.status = 'open' then
      if not is_admin() then raise exception 'Só um administrador pode reabrir uma súmula fechada.'; end if;
      new.data := old.data;                                   -- reabrir não altera o conteúdo
      new.closed_by := null; new.closed_by_email := null; new.closed_at := null;
      new.reopened_by := uid; new.reopened_by_email := mail; new.reopened_at := now();
    else
      raise exception 'Súmula fechada: só um administrador pode reabrir para editar.';
    end if;
  elsif new.status = 'closed' then
    new.closed_by := uid; new.closed_by_email := mail; new.closed_at := now();
    new.reopened_by := old.reopened_by; new.reopened_by_email := old.reopened_by_email; new.reopened_at := old.reopened_at;
  else
    new.closed_by := null; new.closed_by_email := null; new.closed_at := null;
    new.reopened_by := old.reopened_by; new.reopened_by_email := old.reopened_by_email; new.reopened_at := old.reopened_at;
  end if;
  new.updated_by := uid; new.updated_by_email := mail; new.updated_at := now();
  return new;
end $$;

-- depois de gravar: registra no histórico
create or replace function sumulas_log() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into sumula_log (sumula_id, action, user_id, user_email) values (new.id, 'create', new.created_by, new.created_by_email);
  elsif old.status <> new.status then
    insert into sumula_log (sumula_id, action, user_id, user_email)
      values (new.id, case when new.status = 'closed' then 'close' else 'reopen' end, new.updated_by, new.updated_by_email);
  elsif new.data is distinct from old.data and new.updated_by is distinct from old.updated_by then
    -- só registra "editou" quando é OUTRA pessoa (o autor salvando de novo não enche o histórico)
    insert into sumula_log (sumula_id, action, user_id, user_email) values (new.id, 'edit', new.updated_by, new.updated_by_email);
  end if;
  return null;
end $$;

drop trigger if exists trg_sumulas_guard on sumulas;
create trigger trg_sumulas_guard before insert or update on sumulas for each row execute function sumulas_guard();
drop trigger if exists trg_sumulas_log on sumulas;
create trigger trg_sumulas_log after insert or update on sumulas for each row execute function sumulas_log();

alter table sumulas enable row level security;
alter table sumula_log enable row level security;

drop policy if exists "scorer read" on sumulas;
create policy "scorer read" on sumulas for select to authenticated using (is_scorer());
drop policy if exists "scorer insert" on sumulas;
create policy "scorer insert" on sumulas for insert to authenticated with check (is_scorer());
drop policy if exists "scorer update" on sumulas;
create policy "scorer update" on sumulas for update to authenticated using (is_scorer()) with check (is_scorer());

drop policy if exists "scorer read" on sumula_log;
create policy "scorer read" on sumula_log for select to authenticated using (is_scorer());

-- (de propósito NÃO entram no tempo real: o site carrega as súmulas sob demanda, para não recarregar a tela enquanto alguém preenche)
