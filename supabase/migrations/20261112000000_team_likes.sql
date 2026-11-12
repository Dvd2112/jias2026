-- Curtidas da torcida: um contador por atlética, visível para todos.
-- Só ADICIONA uma tabela e uma função; não mexe em nenhuma tabela existente.
-- Ninguém grava direto na tabela: o site chama add_like(), que soma exatamente 1 por chamada.
-- (o site só deixa cada aparelho curtir uma vez por atlética; sem login, isso não dá para impor no banco)

create table if not exists team_likes (
  team_id text primary key references teams(id) on delete cascade,
  likes bigint not null default 0
);

alter table team_likes enable row level security;
drop policy if exists "read all" on team_likes;
create policy "read all" on team_likes for select to anon, authenticated using (true);

-- versão anterior (somava em lote): se você já tinha rodado a migration antiga, remove
drop function if exists add_likes(text, int);

create or replace function add_like(p_team text) returns bigint
language plpgsql security definer set search_path = public as $$
declare total bigint;
begin
  if not exists (select 1 from teams where id = p_team) then raise exception 'atletica inexistente'; end if;
  insert into team_likes (team_id, likes) values (p_team, 1)
    on conflict (team_id) do update set likes = team_likes.likes + 1
    returning likes into total;
  return total;
end $$;

revoke all on function add_like(text) from public;
grant execute on function add_like(text) to anon, authenticated;
-- (de propósito NÃO entra no realtime: o site consulta o contador a cada ~12 s, para 1 curtida não recarregar o site de todo mundo)
