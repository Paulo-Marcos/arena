-- ============================================================
--  Arena de composição corporal — estrutura do banco
--  Cole tudo no SQL Editor do Supabase e execute.
--  O script é re-executável: rodar de novo não quebra nada.
-- ============================================================

-- Ids são texto porque quem os gera é o navegador (crypto.randomUUID()).
-- Isso deixa o app funcionar antes da resposta do servidor chegar.

create table if not exists pessoas (
  id         text primary key,
  dono       uuid default auth.uid() references auth.users on delete set null,
  nome       text not null,
  criado_em  timestamptz not null default now()
);

create table if not exists exames (
  id         text primary key,
  dono       uuid default auth.uid() references auth.users on delete set null,
  pessoa_id  text not null references pessoas(id) on delete cascade,
  data       date not null,
  -- Os indicadores vão em jsonb: o dicionário de métricas vive no código.
  -- Assim, incluir um indicador novo não exige migração de banco.
  d          jsonb not null default '{}'::jsonb
);

create table if not exists eventos (
  id         text primary key,
  dono       uuid default auth.uid() references auth.users on delete set null,
  nome       text not null,
  -- critérios, participantes e regras: lidos sempre inteiros, nunca filtrados.
  config     jsonb not null default '{}'::jsonb
);

create index if not exists exames_pessoa on exames(pessoa_id);

-- ------------------------------------------------------------
--  Uma medição por atleta por dia.
--
--  Duas medições no mesmo dia não são mais informação: são uma
--  ambiguidade. O ranking pega "a primeira" e "a última" de cada
--  participante, e com duas do mesmo dia o resultado passa a
--  depender da ordem em que as linhas voltaram do banco — ou seja,
--  de nada. A trava vive aqui, e não só na tela, porque a tela é
--  uma cópia entre muitas: duas pessoas gravando ao mesmo tempo
--  passariam por qualquer conferência feita em memória.
--
--  Se este comando falhar, já existem duplicatas. Encontre-as com:
--    select pessoa_id, data, count(*) from exames
--    group by 1,2 having count(*) > 1;
--  Apague as sobras pelo app (ou por SQL) e rode de novo.
-- ------------------------------------------------------------
create unique index if not exists exames_um_por_dia on exames(pessoa_id, data);

-- ------------------------------------------------------------
--  A coluna `dono` guarda quem criou a linha, e só isso.
--  Ela NÃO decide mais quem enxerga o quê (ver adiante).
--  Por isso vira anulável e deixa de arrastar os dados junto
--  quando um usuário é removido: tirar o acesso de alguém não
--  pode apagar a arena inteira.
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['pessoas','exames','eventos'] loop
    execute format('alter table %I alter column dono drop not null', t);
    execute format('alter table %I drop constraint if exists %I', t, t || '_dono_fkey');
    execute format(
      'alter table %I add constraint %I foreign key (dono) references auth.users on delete set null',
      t, t || '_dono_fkey');
  end loop;
end $$;

-- ============================================================
--  A PORTARIA
--
--  Uma única lista de e-mails decide quem entra. Ela vive no
--  banco, não no código: liberar alguém é um INSERT, não um
--  deploy. E como a checagem acontece dentro da política de
--  RLS, ela vale para toda leitura e toda gravação — inclusive
--  para quem tentar falar com a API por fora do app.
-- ============================================================

create table if not exists permitidos (
  email      text primary key,
  nota       text,
  criado_em  timestamptz not null default now()
);

-- Ninguém lê esta tabela pela API: RLS ligada e nenhuma política.
-- A lista de convidados só é visível no painel do Supabase.
alter table permitidos enable row level security;

-- O porteiro. `security definer` porque ele precisa enxergar a lista
-- mesmo estando a serviço de quem não pode lê-la.
create or replace function tem_acesso() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from permitidos
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

grant execute on function tem_acesso() to authenticated;

-- O mesmo porteiro, consultado ANTES do login.
--
-- Sem ele, o app teria de manter duas listas: os convidados aqui e os
-- usuários em Authentication → Users. Duas listas sempre divergem, e a
-- divergência aparece como "não tem acesso" para quem você acabou de
-- convidar. Com esta função, `permitidos` é a única lista que existe:
-- quem está nela recebe o link e a conta nasce sozinha na primeira
-- entrada; quem não está nem chega a receber e-mail.
--
-- Ela responde sim/não sobre UM e-mail informado, nunca devolve a lista.
create or replace function email_permitido(alvo text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from permitidos where lower(email) = lower(trim(coalesce(alvo, '')))
  );
$$;

grant execute on function email_permitido(text) to anon, authenticated;

-- ============================================================
--  Segurança em nível de linha.
--
--  Regra única: quem está na lista vê e edita TUDO; quem não
--  está não vê NADA. É uma arena compartilhada, não a caixa de
--  cada um. Trocar isso depois é trocar a expressão abaixo.
-- ============================================================

alter table pessoas enable row level security;
alter table exames  enable row level security;
alter table eventos enable row level security;

do $$
declare t text;
begin
  foreach t in array array['pessoas','exames','eventos'] loop
    execute format('drop policy if exists %I on %I', t || '_dono', t);   -- política antiga
    execute format('drop policy if exists %I on %I', t || '_arena', t);
    execute format(
      'create policy %I on %I for all to authenticated using (tem_acesso()) with check (tem_acesso())',
      t || '_arena', t);
  end loop;
end $$;

-- ============================================================
--  LIBERE OS E-MAILS AQUI
--  Troque pelos seus e rode. Repetir um e-mail não dá erro.
-- ============================================================

insert into permitidos (email, nota) values
  ('voce@email.com', 'dono da arena')
  -- , ('outro@email.com', 'treinador')
on conflict (email) do nothing;

-- Para tirar alguém:  delete from permitidos where email = 'fulano@email.com';
-- Para ver a lista:   select * from permitidos order by criado_em;
