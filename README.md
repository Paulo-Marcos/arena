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
respondem a uma pergunta em cada linha lida ou gravada — *este e-mail está na
lista de convidados?*

---

## 2. Rodar na sua máquina

```bash
npm install
cp .env.example .env      # preencha com a URL e a chave anon
npm run dev
```

Tudo funciona localmente, inclusive a leitura de imagem: o reconhecimento roda
no navegador, sem servidor e sem chave de API.

---

## 3. Publicar

```bash
git init && git add . && git commit -m "primeira versão"
# crie um repositório no GitHub e envie
```

Na Vercel: **Add New → Project**, importe o repositório, framework **Vite**.
Em **Settings → Environment Variables**, cadastre as três:

| Nome | Valor |
|---|---|
| `VITE_SUPABASE_URL` | URL do projeto |
| `VITE_SUPABASE_ANON_KEY` | chave anon |

Não há nenhuma chave de API paga no projeto. As duas variáveis acima são
públicas por natureza; quem protege os dados é o RLS.

Por último, no Supabase em **Authentication → URL Configuration**, coloque o
endereço publicado em **Site URL**, senão o link de acesso enviado por e-mail
volta apontando para `localhost`.

---

## 4. Quem pode entrar

O acesso tem **duas trancas**, e elas respondem a perguntas diferentes.

**Tranca 1 — você foi convidado?** Antes de qualquer e-mail sair, o app pergunta
ao banco se aquele endereço está na tabela `permitidos`. Quem não está recebe a
recusa na hora e nem consome um envio. A conta em `Authentication → Users` nasce
sozinha na primeira entrada de quem está — **`permitidos` é a única lista que
você mantém**.

**Tranca 2 — quem é você?** O login é por *link mágico*: o Supabase manda um
link e clicar nele prova a posse daquela caixa de entrada. Não há senha para
vazar nem para esquecer. Estar na lista não basta: é preciso abrir o e-mail.

Para liberar alguém:

```sql
insert into permitidos (email, nota) values ('fulano@email.com', 'treinador');
```

Para tirar:

```sql
delete from permitidos where email = 'fulano@email.com';
```

A checagem acontece **dentro das políticas de RLS**, não na tela. Isso importa:
mesmo quem chame a API do Supabase por fora do app, com a chave pública na mão,
não lê nem grava uma linha se não estiver na lista. A tela apenas repete a
pergunta antes, para poder dizer "sem acesso" em português.

> **Atenção ao painel:** em **Authentication → Sign In / Providers → Email**, a
> opção **Allow new users to sign up** precisa ficar **ligada**. Ela não é a sua
> tranca — quem barra é a `permitidos`, consultada antes. Desligá-la impediria a
> conta de nascer na primeira entrada de quem você acabou de convidar.

Uma troca consciente: a função que confere a lista é chamada antes do login, ou
seja, sem estar logado. Ela responde apenas *sim/não* sobre um e-mail informado
e nunca devolve a lista, mas quem tentar um endereço por vez descobre se ele
está convidado. Para uma arena entre conhecidos, isso não vale o preço de manter
duas listas desencontradas.

### Todos veem tudo

A política de RLS é uma frase só: *quem está na lista enxerga e edita tudo*.
Não há sessão separada por pessoa — é uma arena compartilhada, como um quadro
branco na parede da academia. A coluna `dono` continua registrando quem criou
cada linha, mas não decide mais nada.

Uma consequência prática: as telas não se atualizam sozinhas entre navegadores.
Se duas pessoas mexem ao mesmo tempo, cada uma só vê o trabalho da outra depois
de recarregar a página, e uma edição simultânea no mesmo registro fica com a
última gravação. Para uma prévia, isso é aceitável; se virar rotina, o caminho é
ligar o *realtime* do Supabase.

## 5. Atualizações

Depois do primeiro deploy, publicar é só isto:

```bash
git add . && git commit -m "o que mudou" && git push
```

A Vercel observa o repositório, roda o build e publica sozinha. Um push em
outro branch gera uma URL de prévia, sem tocar na versão que está no ar.

Uma exceção: mudar variáveis de ambiente **não** dispara publicação. Depois de
alterá-las, use **Deployments → ⋯ → Redeploy**.

---

## Como as medições entram

Três caminhos, do mais confiável ao mais automático:

1. **Digitar** no formulário.
2. **Importar JSON** — mande as fotos do relatório para o Claude com o texto que
   o botão "Copiar texto para o Claude" gera, e cole a resposta. Aceita várias
   medições de pessoas diferentes de uma vez, e cria quem ainda não existe.
3. **Ler a imagem no navegador** (OCR) — preenche o formulário para conferência.

O terceiro é o mais rápido e o menos exato: nos testes com relatórios da
Relaxmedic ele acertou 16 dos 17 indicadores, errando a pontuação corporal, que
é impressa numa fonte grande e clara que o OCR não enxerga.

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
