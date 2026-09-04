import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL;
const CHAVE = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Sem as variáveis, o createClient explode e a tela fica branca, sem pista
// nenhuma. Um erro com nome é mais barato que meia hora de depuração.
if (!URL || !CHAVE) {
  throw new Error(
    "Faltam VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY. " +
    "Local: copie .env.example para .env e preencha. " +
    "Na Vercel: Settings → Environment Variables, e depois Redeploy."
  );
}

export const sb = createClient(URL, CHAVE);

/* ------------------------------------------------------------------ *
 *  A portaria, vista do lado do navegador.
 *
 *  Quem realmente barra é a política de RLS no banco. Esta função só
 *  pergunta a mesma coisa antes da tela abrir, para que a recusa venha
 *  escrita em português em vez de uma arena vazia e inexplicável.
 * ------------------------------------------------------------------ */
export async function temAcesso() {
  const { data, error } = await sb.rpc("tem_acesso");
  if (error) throw error;
  return data === true;
}

/* ------------------------------------------------------------------ *
 *  Carga: o banco fala snake_case, o app fala camelCase.
 *  A tradução acontece aqui e em nenhum outro lugar.
 * ------------------------------------------------------------------ */
export async function carregarTudo() {
  const [p, e, ev] = await Promise.all([
    sb.from("pessoas").select("*").order("criado_em"),
    sb.from("exames").select("*").order("data"),
    sb.from("eventos").select("*"),
  ]);
  const erro = p.error || e.error || ev.error;
  if (erro) throw erro;

  return {
    pessoas: (p.data ?? []).map((x) => ({ id: x.id, nome: x.nome })),
    exames: (e.data ?? []).map((x) => ({ id: x.id, pessoaId: x.pessoa_id, data: x.data, d: x.d ?? {} })),
    eventos: (ev.data ?? []).map((x) => ({
      id: x.id,
      nome: x.nome,
      criterios: x.config?.criterios ?? [],
      premiados: x.config?.premiados ?? 1,
      permitirRepetir: x.config?.permitirRepetir ?? false,
      normalizarTempo: x.config?.normalizarTempo ?? false,
      participantes: x.config?.participantes ?? [],
    })),
  };
}

/* ------------------------------------------------------------------ *
 *  Sincronização por diferença.
 *
 *  O app inteiro continua tratando o estado como três listas em
 *  memória. Esta função compara o antes e o depois, e traduz a
 *  diferença em inserções, atualizações e exclusões. Nenhum
 *  componente precisa saber que existe um banco do outro lado.
 * ------------------------------------------------------------------ */
const paraLinha = {
  pessoas: (p) => ({ id: p.id, nome: p.nome }),
  exames: (e) => ({ id: e.id, pessoa_id: e.pessoaId, data: e.data, d: e.d }),
  eventos: (ev) => ({
    id: ev.id,
    nome: ev.nome,
    config: {
      criterios: ev.criterios,
      premiados: ev.premiados,
      permitirRepetir: ev.permitirRepetir,
      normalizarTempo: ev.normalizarTempo,
      participantes: ev.participantes,
    },
  }),
};

async function diferenca(tabela, antes, depois) {
  const mapa = (lista) => new Map(lista.map((x) => [x.id, x]));
  const a = mapa(antes), b = mapa(depois);

  const gravar = depois.filter((x) => {
    const velho = a.get(x.id);
    return !velho || JSON.stringify(velho) !== JSON.stringify(x);
  });
  const apagar = antes.filter((x) => !b.has(x.id)).map((x) => x.id);

  if (gravar.length) {
    const { error } = await sb.from(tabela).upsert(gravar.map(paraLinha[tabela]));
    if (error) throw error;
  }
  if (apagar.length) {
    const { error } = await sb.from(tabela).delete().in("id", apagar);
    if (error) throw error;
  }
}

export async function sincronizar(antes, depois) {
  // Ordem importa: exames apontam para pessoas. Gravamos pessoas
  // primeiro para nunca inserir um exame órfão.
  await diferenca("pessoas", antes.pessoas, depois.pessoas);
  await diferenca("exames", antes.exames, depois.exames);
  await diferenca("eventos", antes.eventos, depois.eventos);
}
