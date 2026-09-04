-- ============================================================
--  Arena de composição corporal — estrutura do banco
--  Cole tudo no SQL Editor do Supabase e execute uma vez.
-- ============================================================

-- Ids são texto porque quem os gera é o navegador (crypto.randomUUID()).
-- Isso deixa o app funcionar antes da resposta do servidor chegar.

create table if not exists pessoas (
  id         text primary key,
  dono       uuid not null default auth.uid() references auth.users on delete cascade,
  nome       text not null,
  criado_em  timestamptz not null default now()
);

create table if not exists exames (
  id         text primary key,
  dono       uuid not null default auth.uid() references auth.users on delete cascade,
  pessoa_id  text not null references pessoas(id) on delete cascade,
  data       date not null,
  -- Os indicadores vão em jsonb: o dicionário de métricas vive no código.
  -- Assim, incluir um indicador novo não exige migração de banco.
  d          jsonb not null default '{}'::jsonb
);

create table if not exists eventos (
  id         text primary key,
  dono       uuid not null default auth.uid() references auth.users on delete cascade,
  nome       text not null,
  -- critérios, participantes e regras: lidos sempre inteiros, nunca filtrados.
  config     jsonb not null default '{}'::jsonb
);

create index if not exists exames_pessoa on exames(pessoa_id);
create index if not exists exames_dono   on exames(dono);

-- ============================================================
--  Segurança em nível de linha: cada conta enxerga só o que é seu.
--  Sem isto, a chave pública do navegador daria acesso a tudo.
-- ============================================================

alter table pessoas enable row level security;
alter table exames  enable row level security;
alter table eventos enable row level security;

do $$
declare t text;
begin
  foreach t in array array['pessoas','exames','eventos'] loop
    execute format('drop policy if exists %I on %I', t || '_dono', t);
    execute format(
      'create policy %I on %I for all to authenticated using (dono = auth.uid()) with check (dono = auth.uid())',
      t || '_dono', t);
  end loop;
end $$;
