import { createClient } from "@supabase/supabase-js";

export const sb = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

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
