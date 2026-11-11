-- Cada modalidade passa a ter categorias (masculino / feminino), cada uma com seu próprio
-- chaveamento. Uma "chave" = uma linha em sports (nome + categoria). Inscrições, sorteio,
-- jogos e placares já são por linha, então ficam independentes sem mudar mais nada.
alter table sports add column if not exists category text not null default 'masculino'
  check (category in ('masculino','feminino'));

-- as modalidades que já existiam viram "masculino"; cria o par feminino (vazio) de cada uma
insert into sports (id, name, pos, category) values
  ('s_handebol_f','Handebol',4,'feminino'), ('s_futsal_f','Futsal',5,'feminino'),
  ('s_volei_f','Vôlei',6,'feminino'),      ('s_basquete_f','Basquete',7,'feminino')
on conflict do nothing;
