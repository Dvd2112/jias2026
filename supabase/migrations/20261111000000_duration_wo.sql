-- Duração média de um jogo (por modalidade) e WO (a atlética que não compareceu).
alter table sports add column if not exists avg_minutes int not null default 40
  check (avg_minutes between 5 and 480);
alter table match_results add column if not exists wo text;   -- id da atlética que deu WO (null = jogo normal)
