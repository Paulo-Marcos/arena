# Arena de composição corporal — versão web

Aplicação React (Vite) com banco no Supabase e publicação na Vercel.
Do zero ao ar em uma sessão de mais ou menos vinte minutos.

---

## 1. Banco no Supabase

1. Crie uma conta em `supabase.com` e um projeto novo (região: São Paulo).
2. Abra **SQL Editor**, cole todo o conteúdo de `supabase/schema.sql` e execute.
3. Em **Project Settings → API**, copie a **Project URL** e a chave **anon public**.

A chave `anon` vai para o navegador e isso é intencional: quem protege os dados
não é o segredo da chave, e sim as políticas de RLS criadas pelo script. Elas
respondem a uma pergunta em cada linha lida ou gravada — *de quem é esta linha?*

---

## 2. Rodar na sua máquina

```bash
npm install
cp .env.example .env      # preencha com a URL e a chave anon
npm run dev
```

A leitura de imagem não funciona em `npm run dev` puro, porque a pasta `api/`
só existe no ambiente da Vercel. Para testá-la localmente:

```bash
npm i -g vercel
vercel dev
```

---

## 3. Publicar

```bash
git init && git add . && git commit -m "primeira versão"
# crie um repositório no GitHub e envie
```

Na Vercel: **Add New → Project**, importe o repositório, framework **Vite**.
Em **Settings → Environment Variables**, cadastre as três:

| Nome | Valor | Onde é lido |
|---|---|---|
| `VITE_SUPABASE_URL` | URL do projeto | navegador |
| `VITE_SUPABASE_ANON_KEY` | chave anon | navegador |
| `ANTHROPIC_API_KEY` | chave da Anthropic | **só no servidor** |

O prefixo `VITE_` é o que decide se a variável entra no pacote enviado ao
navegador. A chave da Anthropic **nunca** pode ter esse prefixo — ela é lida
apenas dentro de `api/extrair.js`, que roda no servidor.

Por último, no Supabase em **Authentication → URL Configuration**, coloque o
endereço publicado em **Site URL**, senão o link de acesso enviado por e-mail
volta apontando para `localhost`.

---

## Como os dados são guardados

Três tabelas. `pessoas` e `exames` são normalizadas porque crescem sem parar e
são filtradas o tempo todo. A configuração de um evento fica num campo `jsonb`,
porque ela é sempre lida inteira e nunca consultada por dentro — normalizar ali
custaria quatro tabelas para não resolver nenhum problema real.

Os indicadores de cada exame também são `jsonb`. O dicionário de métricas vive
no código, então acrescentar um indicador novo é editar uma constante, não
migrar um banco.

## Como as alterações chegam ao banco

Nenhum componente conhece o Supabase. O app continua tratando o estado como três
listas em memória, exatamente como antes. Meio segundo depois da última
alteração, `sincronizar()` compara o estado anterior com o atual e traduz a
diferença em inserções, atualizações e exclusões.

A vantagem é que a interface nunca espera o servidor: você digita, aparece na
hora, e a gravação acontece atrás. O canto superior mostra "Salvando…" e depois
"Tudo salvo".
