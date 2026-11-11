-- Placar por sets (vôlei) e horário real de início do jogo (para saber qual está há mais tempo no ar).
alter table match_results add column if not exists sets jsonb;           -- [{a,b,done}] um item por set
alter table match_results add column if not exists started_at timestamptz;
alter table sports add column if not exists scoring text not null default 'simple'
  check (scoring in ('simple','sets'));
alter table sports add column if not exists best_of int not null default 3
  check (best_of in (3,5));
update sports set scoring = 'sets' where id in ('s_volei','s_volei_f');
