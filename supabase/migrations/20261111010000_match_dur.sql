-- Duração própria de um jogo (minutos), ajustada arrastando o cartão na grade de Horários.
-- Se vazio, vale a duração média da modalidade.
alter table match_results add column if not exists dur int check (dur is null or dur between 5 and 480);
