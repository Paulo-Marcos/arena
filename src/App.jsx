import React, { useState, useEffect, useRef, useMemo } from "react";
import { carregarTudo, sincronizar, sb } from "./dados";

/* ------------------------------------------------------------------ *
 *  DICIONÁRIO DE MÉTRICAS
 *  É aqui que os números ganham juízo: o que é "melhor", qual modo de
 *  comparação é o mais justo, e o porquê (mostrado na interface).
 * ------------------------------------------------------------------ */
const METRICAS = {
  pontuacao:   { label: "Pontuação corporal", un: "pts",   melhor: "maior", rec: "abs",
    porque: "Escala fechada de 0 a 100. Um ponto vale um ponto para todo mundo. Em percentual, sair de 60 para 66 (+10%) venceria sair de 90 para 95 (+5,6%), o que premia quem começou pior." },
  peso:        { label: "Peso", un: "kg", melhor: "menor", rec: "pct",
    porque: "Perder 3 kg com 110 kg não é o mesmo esforço que perder 3 kg com 60 kg. O percentual iguala o tamanho do desafio." },
  gorduraKg:   { label: "Massa gorda", un: "kg", melhor: "menor", rec: "pct",
    porque: "Quem tem 22 kg de gordura tem muito mais de onde tirar do que quem tem 10 kg. O percentual mede quanto do próprio estoque a pessoa queimou." },
  gorduraPct:  { label: "Taxa de gordura corporal", un: "%", melhor: "menor", rec: "abs",
    porque: "O valor já é um percentual do corpo. Comparar a variação percentual de um percentual dobra a distorção; o ponto percentual é a unidade natural aqui." },
  musculo:     { label: "Massa muscular", un: "kg", melhor: "maior", rec: "pct",
    porque: "Ganhar 1 kg de músculo sobre 40 kg é uma obra bem maior do que sobre 56 kg. O percentual respeita a base de cada um." },
  musculoEsq:  { label: "Músculo esquelético", un: "kg", melhor: "maior", rec: "pct",
    porque: "Mesma lógica da massa muscular: o ganho precisa ser lido contra a base de quem ganhou." },
  imc:         { label: "IMC", un: "kg/m²", melhor: "menor", rec: "pct",
    porque: "Anda colado no peso e a altura é fixa no período, então o percentual reproduz a justiça do peso." },
  agua:        { label: "Água corporal", un: "kg", melhor: "maior", rec: "pct",
    porque: "Acompanha a massa magra e varia muito com hidratação do dia. Use com cautela em disputas curtas." },
  proteina:    { label: "Proteína", un: "kg", melhor: "maior", rec: "pct",
    porque: "Valores pequenos e derivados da massa magra: o percentual evita que décimos decidam a disputa." },
  visceral:    { label: "Gordura visceral", un: "grau", melhor: "menor", rec: "abs",
    porque: "Escala inteira e curta (normalmente 1 a 30). O degrau já é a unidade de mérito; descer de 9 para 8 é um degrau para qualquer um." },
  tmb:         { label: "Taxa metabólica basal", un: "kcal", melhor: "maior", rec: "pct",
    porque: "É calculada a partir da massa magra, então herda a mesma lógica de base." },
  pesoLivreGordura: { label: "Peso livre de gordura", un: "kg", melhor: "maior", rec: "pct",
    porque: "Base individual muito diferente entre participantes; o percentual nivela." },
  gorduraSubcutanea: { label: "Gordura subcutânea", un: "%", melhor: "menor", rec: "abs",
    porque: "Já é percentual do corpo. O ponto percentual é a leitura honesta." },
  smi:         { label: "SMI (índice de massa magra)", un: "kg/m²", melhor: "maior", rec: "pct",
    porque: "Índice derivado do músculo dividido pela altura; a base de partida importa." },
  idadeCorpo:  { label: "Idade corporal", un: "anos", melhor: "menor", rec: "abs",
    porque: "Anos são anos. Rejuvenescer 2 anos vale o mesmo partindo de 34 ou de 45." },
  whr:         { label: "Relação cintura-quadril (WHR)", un: "", melhor: "menor", rec: "abs",
    porque: "Já é uma razão entre duas medidas e varia em faixa estreitíssima; o valor absoluto é mais legível." },
  salInorganico: { label: "Sal inorgânico", un: "kg", melhor: "maior", rec: "abs",
    porque: "Praticamente estável no curto prazo. Serve mais como conferência do que como disputa." },
};

const CAMPOS_PRINCIPAIS = ["pontuacao", "peso", "gorduraKg", "gorduraPct", "musculo", "musculoEsq", "imc"];
const CAMPOS_EXTRAS = ["agua", "proteina", "salInorganico", "visceral", "tmb", "pesoLivreGordura", "gorduraSubcutanea", "smi", "idadeCorpo", "whr"];
const TODOS_CAMPOS = [...CAMPOS_PRINCIPAIS, ...CAMPOS_EXTRAS];

/* ------------------------------------------------------------------ *
 *  ESTADO INICIAL — vazio: a verdade agora mora no banco.
 * ------------------------------------------------------------------ */
const VAZIO = { pessoas: [], exames: [], eventos: [] };

/* ------------------------------------------------------------------ *
 *  MOTOR DE CÁLCULO
 * ------------------------------------------------------------------ */
const nid = () => crypto.randomUUID();
const dias = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / 86400000));
const fmt = (v, casas = 2) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : Number(v).toFixed(casas).replace(".", ",");

/**
 * Mérito de um participante num indicador. Devolve `null` quando falta
 * o dado — quem não mediu não compete naquele indicador.
 *
 * O sinal já sai corrigido: `score` maior é sempre melhor, tanto para
 * "perder gordura" quanto para "ganhar músculo". Quem chama não precisa
 * lembrar de qual lado da régua o indicador está.
 */
function pontuar(campo, modo, ini, fim, evento) {
  const vi = ini.d[campo], vf = fim.d[campo];
  if (vi === undefined || vf === undefined || vi === null || vf === null) return null;

  const abs = vf - vi;
  const pct = vi === 0 ? 0 : (abs / Math.abs(vi)) * 100;
  const d = dias(ini.data, fim.data);
  let score = (modo === "pct" ? pct : abs) * (METRICAS[campo].melhor === "maior" ? 1 : -1);
  if (evento.normalizarTempo) score = (score * 30) / d;

  return { vi, vf, abs, pct, d, score };
}

// Dois números de ponto flutuante quase nunca são iguais por acidente,
// mas -2.0 kg e -2.0 kg são o mesmo mérito e precisam empatar de fato.
const IGUAIS = (a, b) => Math.abs(a - b) < 1e-9;

function calcularRanking(evento, criterio, exames, pessoas) {
  // Desempate no mesmo indicador da disputa não desempata nada: os
  // valores são os mesmos que acabaram de empatar. Some da fila.
  const desempates = (evento.desempate ?? []).filter((c) => c !== criterio.campo && METRICAS[c]);

  const linhas = evento.participantes
    .map((p) => {
      const ini = exames.find((e) => e.id === p.iniId);
      const fim = exames.find((e) => e.id === p.fimId);
      const nome = pessoas.find((x) => x.id === p.pessoaId)?.nome ?? "?";
      if (!ini || !fim) return null;

      const principal = pontuar(criterio.campo, criterio.modo, ini, fim, evento);
      if (!principal) return null;

      return {
        pessoaId: p.pessoaId,
        nome,
        ...principal,
        // Cada desempate usa o modo recomendado do próprio indicador:
        // o organizador escolheu a ordem da fila, não a régua de cada um.
        extras: desempates.map((c) => pontuar(c, METRICAS[c].rec, ini, fim, evento)?.score ?? null),
      };
    })
    .filter(Boolean);

  linhas.sort((a, b) => {
    if (!IGUAIS(a.score, b.score)) return b.score - a.score;
    for (let i = 0; i < desempates.length; i += 1) {
      const x = a.extras[i], y = b.extras[i];
      if (x === null && y === null) continue;
      if (x === null) return 1;   // quem não tem o dado desce
      if (y === null) return -1;
      if (!IGUAIS(x, y)) return y - x;
    }
    return 0;
  });

  // Marca quem venceu no desempate, para a cerimônia poder dizer por quê.
  // Sem isso, dois números idênticos na tela em ordens diferentes parecem
  // um erro do sistema — e a plateia é quem cobra a explicação.
  linhas.forEach((l, i) => {
    const ant = linhas[i - 1];
    if (!ant || !IGUAIS(ant.score, l.score)) return;
    const passo = l.extras.findIndex((v, k) => v !== null && ant.extras[k] !== null && !IGUAIS(v, ant.extras[k]));
    if (passo >= 0) { l.desempatadoPor = desempates[passo]; ant.desempatadoPor = ant.desempatadoPor ?? desempates[passo]; }
  });

  return linhas;
}

/** Distribui os prêmios respeitando (ou não) a regra de campeão único. */
function aplicarPremiacao(ranking, jaPremiados, evento) {
  let vaga = 1;
  return ranking.map((l) => {
    const bloqueado = !evento.permitirRepetir && jaPremiados.has(l.pessoaId);
    let premio = null;
    if (!bloqueado && vaga <= evento.premiados) {
      premio = vaga;
      vaga += 1;
    }
    return { ...l, premio, bloqueado };
  });
}

/* ------------------------------------------------------------------ *
 *  ESTILO
 * ------------------------------------------------------------------ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');

.bc { --tinta:#132B36; --papel:#EDF1EE; --linha:#C9D4CE; --calmo:#5C6F69;
      --acao:#1B6F5C; --ouro:#D9A227; --prata:#9FB0B6; --bronze:#B4703C;
      --alerta:#B4483C; --palco:#0C1D26;
      font-family:'Inter',system-ui,sans-serif; color:var(--tinta); background:var(--papel);
      min-height:100vh; }
.bc *,.bc *::before,.bc *::after{box-sizing:border-box}
.bc h1,.bc h2,.bc h3,.bc .num{font-family:'Barlow Condensed',sans-serif;letter-spacing:.01em}
.bc h1{font-size:34px;font-weight:700;margin:0;line-height:1}
.bc h2{font-size:22px;font-weight:600;margin:0 0 10px;line-height:1.1}
.bc h3{font-size:16px;font-weight:600;margin:0 0 6px}
.bc p{margin:0 0 8px;line-height:1.55;font-size:14px}
.bc small{font-size:12px;color:var(--calmo);line-height:1.5}
.wrap{max-width:1040px;margin:0 auto;padding:22px 18px 80px}
.topo{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;border-bottom:2px solid var(--tinta);padding-bottom:12px;margin-bottom:18px}
.abas{display:flex;gap:2px;margin-bottom:20px;flex-wrap:wrap}
.aba{font-family:'Barlow Condensed',sans-serif;font-size:17px;font-weight:600;padding:7px 16px;border:1px solid var(--linha);
     background:transparent;cursor:pointer;color:var(--calmo);border-radius:2px}
.aba[data-on="1"]{background:var(--tinta);color:var(--papel);border-color:var(--tinta)}
.aba:focus-visible,.b:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--acao);outline-offset:2px}
.cartao{background:#fff;border:1px solid var(--linha);border-radius:3px;padding:16px;margin-bottom:14px}
.b{font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:600;padding:7px 14px;border-radius:2px;cursor:pointer;
   border:1px solid var(--tinta);background:var(--tinta);color:#fff}
.b.ghost{background:transparent;color:var(--tinta)}
.b.perigo{background:transparent;color:var(--alerta);border-color:var(--alerta)}
.b.grande{font-size:20px;padding:12px 26px}
.b:disabled{opacity:.35;cursor:not-allowed}
.bc input,.bc select{font-family:inherit;font-size:14px;padding:7px 9px;border:1px solid var(--linha);border-radius:2px;background:#fff;color:inherit;width:100%}
.linha{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}
.campo{display:flex;flex-direction:column;gap:3px;min-width:110px;flex:1}
.campo label{font-size:11px;color:var(--calmo);font-weight:500}
.grade{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:9px}
.item{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--linha)}
.item:last-child{border-bottom:none}
.tag{font-size:11px;padding:2px 7px;border:1px solid var(--linha);border-radius:2px;color:var(--calmo);white-space:nowrap}
.crit{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px;border:1px solid var(--linha);margin-bottom:7px;border-radius:2px}
.crit[data-on="1"]{border-color:var(--acao);border-left:4px solid var(--acao);background:#F4F9F7}
.modo{display:flex;gap:0}
.modo button{font-size:12px;padding:5px 11px;border:1px solid var(--linha);background:#fff;cursor:pointer;color:var(--calmo)}
.modo button[data-on="1"]{background:var(--acao);color:#fff;border-color:var(--acao)}
.num{font-variant-numeric:tabular-nums;font-weight:600}
.mais{color:var(--acao)} .menos{color:var(--alerta)}

/* ---- palco da cerimônia ---- */
.palco{position:fixed;inset:0;background:var(--palco);color:#F2F6F4;z-index:50;display:flex;flex-direction:column;
       align-items:center;justify-content:center;padding:24px;overflow:hidden}
.palco h1{font-size:clamp(30px,7vw,64px);color:#fff;text-align:center}
.roleta{font-family:'Barlow Condensed',sans-serif;font-size:clamp(28px,6vw,54px);font-weight:700;color:var(--ouro);
        text-align:center;min-height:1.2em}
.pos{display:flex;align-items:center;gap:14px;width:min(600px,94vw);padding:13px 16px;margin-bottom:8px;
     border:1px solid rgba(255,255,255,.16);border-radius:3px;background:rgba(255,255,255,.05);
     animation:sobe .45s cubic-bezier(.2,.9,.3,1) both}
.pos .lugar{font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:700;width:46px;color:#7E979F}
.pos .quem{flex:1;font-size:17px;font-weight:600}
.pos .val{font-family:'Barlow Condensed',sans-serif;font-size:24px;font-weight:700;font-variant-numeric:tabular-nums}
.pos[data-premio="1"]{border-color:var(--ouro);background:rgba(217,162,39,.14)}
.pos[data-premio="1"] .lugar,.pos[data-premio="1"] .val{color:var(--ouro)}
.pos[data-premio="2"]{border-color:var(--prata)} .pos[data-premio="2"] .lugar{color:var(--prata)}
.pos[data-premio="3"]{border-color:var(--bronze)} .pos[data-premio="3"] .lugar{color:var(--bronze)}
.pos[data-bloq="1"]{opacity:.45}
@keyframes sobe{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:none}}
@keyframes pulsa{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
.campeao{animation:pulsa 1.6s ease-in-out 3}
.conf{position:absolute;top:-12px;width:9px;height:15px;animation:cai linear forwards;pointer-events:none}
@keyframes cai{to{transform:translateY(105vh) rotate(760deg);opacity:0}}
@media (prefers-reduced-motion:reduce){.pos,.campeao,.conf{animation:none!important}}
.dica{color:#7E979F;font-size:13px;margin-top:16px;letter-spacing:.03em}
.dica kbd{border:1px solid #33474F;border-radius:3px;padding:1px 6px;font-family:inherit}

/* ---- ficha do atleta e gráfico ---- */
.fileira{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 12px;border:1px solid var(--linha);
         border-radius:2px;margin-bottom:6px;background:#fff;cursor:pointer;width:100%;text-align:left;font:inherit;color:inherit}
.fileira:hover{border-color:var(--acao)}
.fileira[data-on="1"]{border-left:4px solid var(--acao)}
.chip{display:inline-flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.chip button{font-size:12px;padding:4px 10px;border:1px solid var(--linha);background:#fff;cursor:pointer;color:var(--calmo);border-radius:2px}
.chip button[data-on="1"]{background:var(--tinta);color:#fff;border-color:var(--tinta)}
.graf{width:100%;height:auto;display:block}
.graf text{font-family:'Barlow Condensed',sans-serif;font-size:13px;fill:var(--calmo)}
.graf .valor{fill:var(--tinta);font-weight:600}
.legenda{display:flex;flex-direction:column;gap:5px;margin-top:8px}
.legenda span{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.legenda i{width:11px;height:11px;border-radius:2px;flex:none;transform:translateY(1px)}
.legenda strong{font-size:14px}
.carregando{display:inline-block;width:13px;height:13px;border:2px solid var(--linha);border-top-color:var(--acao);
            border-radius:50%;animation:gira .8s linear infinite;vertical-align:-2px}
@keyframes gira{to{transform:rotate(360deg)}}
.solta{border:1px dashed var(--linha);border-radius:3px;padding:18px;text-align:center;background:#F7FAF8}

/* ---- passo a passo numerado ---- */
.passos{counter-reset:passo;list-style:none;padding:0;margin:0 0 14px}
.passos li{counter-increment:passo;position:relative;padding:0 0 10px 34px;font-size:13.5px;line-height:1.5}
.passos li::before{content:counter(passo);position:absolute;left:0;top:-1px;width:23px;height:23px;border-radius:50%;
  background:var(--acao);color:#fff;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:14px;
  display:flex;align-items:center;justify-content:center}

/* ================= CELULAR =================
   O palco da cerimônia precisa poder ROLAR: com oito atletas numa tela
   de 667px de altura, "overflow:hidden" e centralização vertical
   escondem o pódio e não há gesto que traga de volta. */
@media (max-width:760px){
  .wrap{padding:14px 12px 90px}
  .bc h1{font-size:25px}
  .bc h2{font-size:19px}
  .topo{gap:8px;padding-bottom:10px}
  .topo small{flex-basis:100%;order:3}
  .abas{gap:4px;overflow-x:auto;padding-bottom:2px;-webkit-overflow-scrolling:touch}
  .aba{flex:1;min-width:max-content;padding:10px 14px}
  .cartao{padding:13px}
  /* Alvo de toque: 44px é o mínimo confortável para o polegar. */
  .b{padding:11px 15px;min-height:44px}
  .b.grande{font-size:18px;padding:14px 22px}
  .palco .b.grande{width:min(100%,320px)}
  .bc input,.bc select{padding:11px 10px;font-size:16px}  /* 16px evita o zoom automático do iOS */
  .campo{min-width:0;flex-basis:100%}
  .linha>.campo[style]{max-width:none!important}
  .grade{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}
  /* Item e fileira empilham: o botão de excluir deixa de espremer o texto. */
  /* O item empilha porque o botão de excluir espremeria o texto.
     A fileira do atleta continua em linha: nome + selo cabem lado a lado,
     e empilhá-la só esticaria o selo pela largura toda. */
  .item{flex-direction:column;align-items:stretch;gap:8px}
  .item>span:last-child{display:flex;gap:8px;flex-wrap:wrap}
  .item>span:last-child>.b{flex:1}
  .fileira{align-items:center}
  .crit{flex-direction:column;align-items:stretch}
  .modo{width:100%}
  .modo button{flex:1;padding:10px 8px}
  /* overflow-x fica explícito: com overflow-y:auto o eixo 'visible' vira 'auto' sozinho, e o confete criaria rolagem lateral. */
  .palco{justify-content:flex-start;overflow-y:auto;overflow-x:hidden;padding:64px 14px 28px}
  .palco h1{font-size:clamp(24px,8vw,38px)}
  .pos{width:100%;gap:9px;padding:10px 11px}
  .pos .lugar{font-size:20px;width:34px}
  .pos .quem{font-size:15px}
  .pos .val{font-size:19px}
  .dica{text-align:center}
}
`;

/* ------------------------------------------------------------------ *
 *  APP
 * ------------------------------------------------------------------ */
export default function App() {
  const [db, setDb] = useState(VAZIO);
  const [carregou, setCarregou] = useState(false);
  const [aba, setAba] = useState("atletas");
  const [cerimonia, setCerimonia] = useState(null);
  // Atleta escolhido na aba Atletas para receber uma medição. É o que
  // permite "adicionar medição" começar de onde o clique aconteceu, em
  // vez de jogar a pessoa num formulário em branco.
  const [alvoMedicao, setAlvoMedicao] = useState(null);
  const [sincronia, setSincronia] = useState("ok"); // ok | salvando | erro
  const salvo = useRef(VAZIO);

  // Carga inicial: uma viagem ao banco e o app segue trabalhando em memória.
  useEffect(() => {
    carregarTudo()
      .then((d) => { setDb(d); salvo.current = d; })
      .catch(() => setSincronia("erro"))
      .finally(() => setCarregou(true));
  }, []);

  // Gravação: espera meio segundo de silêncio e manda só o que mudou.
  useEffect(() => {
    if (!carregou || db === salvo.current) return;
    setSincronia("salvando");
    const t = setTimeout(async () => {
      const antes = salvo.current;
      try {
        await sincronizar(antes, db);
        salvo.current = db;
        setSincronia("ok");
      } catch (e) {
        console.error(e);
        setSincronia("erro");
      }
    }, 500);
    return () => clearTimeout(t);
  }, [db, carregou]);

  const up = (patch) => setDb((s) => ({ ...s, ...patch }));

  return (
    <div className="bc">
      <style>{CSS}</style>
      <div className="wrap">
        <div className="topo">
          <h1>Arena de composição corporal</h1>
          <small style={{ flex: 1 }}>
            {!carregou ? "Carregando…"
              : sincronia === "salvando" ? "Salvando…"
              : sincronia === "erro" ? "Não foi possível salvar. Verifique a conexão."
              : "Tudo salvo"}
          </small>
          <button className="b ghost" onClick={() => sb.auth.signOut()}>Sair da conta</button>
        </div>

        <div className="abas">
          {[["atletas", "Atletas"], ["medicoes", "Medições"], ["eventos", "Eventos"]].map(([k, l]) => (
            <button key={k} className="aba" data-on={aba === k ? "1" : "0"} onClick={() => setAba(k)}>{l}</button>
          ))}
        </div>

        {aba === "atletas" && (
          <Atletas db={db} up={up}
            medir={(pessoaId) => { setAlvoMedicao(pessoaId); setAba("medicoes"); }} />
        )}
        {aba === "medicoes" && (
          <Medicoes db={db} up={up} alvo={alvoMedicao} limparAlvo={() => setAlvoMedicao(null)} />
        )}
        {aba === "eventos" && <Eventos db={db} up={up} abrir={setCerimonia} />}
      </div>

      {cerimonia && (
        <Cerimonia evento={db.eventos.find((e) => e.id === cerimonia)} db={db} fechar={() => setCerimonia(null)} />
      )}
    </div>
  );
}

/* ---------------------- GRÁFICO DE EVOLUÇÃO ---------------------- *
 *  Uma ou várias séries no mesmo eixo. O eixo horizontal é o tempo
 *  real (não a ordem das medições), senão duas pessoas que mediram em
 *  datas diferentes apareceriam lado a lado sem terem sido lado a lado.
 * ------------------------------------------------------------------ */
const CORES = ["#1B6F5C", "#B4483C", "#2F6690", "#D9A227"];
const dia = (s) => Date.parse(`${s}T12:00:00`);

function GraficoLinhas({ series, un, melhor, modo = "real" }) {
  const vivas = series.filter((s) => s.pontos.length >= 2);
  if (!vivas.length) return <small>São necessárias pelo menos duas medições para desenhar uma evolução.</small>;

  const conv = vivas.map((s) => {
    const v0 = s.pontos[0].v;
    return {
      ...s,
      pontos: s.pontos.map((p) => ({
        ...p,
        y: modo === "indice" ? (v0 ? (p.v / v0) * 100 : 100) : modo === "delta" ? p.v - v0 : p.v,
      })),
    };
  });

  const W = 640, H = 210, ml = 12, mr = 12, mt = 26, mb = 30;
  const ts = conv.flatMap((s) => s.pontos.map((p) => dia(p.data)));
  const tmin = Math.min(...ts), tmax = Math.max(...ts);
  const ys = conv.flatMap((s) => s.pontos.map((p) => p.y));
  const base = modo === "indice" ? 100 : modo === "delta" ? 0 : null;
  let min = Math.min(...ys, base ?? Infinity), max = Math.max(...ys, base ?? -Infinity);
  if (min === max) { min -= 1; max += 1; }
  const folga = (max - min) * 0.18;
  min -= folga; max += folga;

  const x = (t) => (tmax === tmin ? W / 2 : ml + ((dia(t) - tmin) / (tmax - tmin)) * (W - ml - mr));
  const y = (v) => mt + (H - mt - mb) * (1 - (v - min) / (max - min));
  const dt = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  const sufixo = modo === "indice" ? "" : ` ${un}`;
  const uma = conv.length === 1;

  return (
    <>
      <svg className="graf" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Evolução do indicador ao longo do tempo">
        {base !== null && (
          <>
            <line x1={ml} x2={W - mr} y1={y(base)} y2={y(base)} stroke="#C9D4CE" strokeDasharray="4 4" />
            <text x={W - mr} y={y(base) - 6} textAnchor="end">{modo === "indice" ? "ponto de partida = 100" : "ponto de partida"}</text>
          </>
        )}
        {conv.map((s, si) => {
          const cor = s.cor ?? (uma ? ((melhor === "maior") === (s.pontos[s.pontos.length - 1].y - s.pontos[0].y > 0) ? "#1B6F5C" : "#B4483C") : CORES[si % 4]);
          const d = s.pontos.map((p, i) => `${i ? "L" : "M"}${x(p.data).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
          return (
            <g key={s.id ?? si}>
              {uma && <path d={`${d} L${x(s.pontos[s.pontos.length - 1].data)},${H - mb} L${x(s.pontos[0].data)},${H - mb} Z`} fill={cor} opacity="0.07" />}
              <path d={d} fill="none" stroke={cor} strokeWidth="2.5" strokeLinejoin="round" />
              {s.pontos.map((p, i) => (
                <g key={i}>
                  <circle cx={x(p.data)} cy={y(p.y)} r="4.5" fill="#fff" stroke={cor} strokeWidth="2.5" />
                  {uma && (
                    <text className="valor" x={x(p.data)} y={y(p.y) - 12}
                      textAnchor={i === 0 ? "start" : i === s.pontos.length - 1 ? "end" : "middle"}>
                      {fmt(p.y, 1)}
                    </text>
                  )}
                </g>
              ))}
            </g>
          );
        })}
        {uma
          ? conv[0].pontos.map((p, i) => (
              <text key={i} x={x(p.data)} y={H - 10}
                textAnchor={i === 0 ? "start" : i === conv[0].pontos.length - 1 ? "end" : "middle"}>{dt(p.data)}</text>
            ))
          : (<>
              <text x={ml} y={H - 10} textAnchor="start">{dt(new Date(tmin).toISOString().slice(0, 10))}</text>
              <text x={W - mr} y={H - 10} textAnchor="end">{dt(new Date(tmax).toISOString().slice(0, 10))}</text>
            </>)}
      </svg>

      <div className="legenda">
        {conv.map((s, si) => {
          const p = s.pontos, total = p[p.length - 1].v - p[0].v;
          const pct = p[0].v ? (total / Math.abs(p[0].v)) * 100 : 0;
          const bom = melhor === "maior" ? total > 0 : total < 0;
          const cor = s.cor ?? (uma ? (bom ? "#1B6F5C" : "#B4483C") : CORES[si % 4]);
          return (
            <span key={s.id ?? si}>
              <i style={{ background: cor }} />
              <strong>{s.nome}</strong>
              <small>
                {fmt(p[0].v, 1)} → {fmt(p[p.length - 1].v, 1)}{sufixo} ·{" "}
                <span className={bom ? "mais" : "menos"}>{total > 0 ? "+" : ""}{fmt(total, 2)}{sufixo} ({total > 0 ? "+" : ""}{fmt(pct, 1)}%)</span>
                {" "}em {dias(p[0].data, p[p.length - 1].data)} dias
              </small>
            </span>
          );
        })}
      </div>
    </>
  );
}

/* ------------------------ COMPARAR ATLETAS ----------------------- */
const MODOS = {
  real: { label: "Valores reais", nota: "Cada linha na sua unidade original. Honesto para quem parte de patamares parecidos; entre 60 kg e 96 kg as linhas ficam tão distantes que a forma da trajetória some." },
  delta: { label: "Diferença desde o início", nota: "Todos partem do zero e o gráfico mostra quanto ganharam ou perderam. É a leitura absoluta: −2 kg vale −2 kg para todo mundo." },
  indice: { label: "Trajetória (base 100)", nota: "Todos partem de 100 e a linha mostra a variação em relação à própria base. É a leitura percentual: quem tinha menos de onde tirar aparece com o mérito que teve." },
};

function Comparador({ db }) {
  const [sel, setSel] = useState(db.pessoas.slice(0, 2).map((p) => p.id));
  const [metrica, setMetrica] = useState("gorduraKg");
  const [modo, setModo] = useState("indice");

  const alternar = (id) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : sel.length < 4 ? [...sel, id] : sel);

  const disponiveis = TODOS_CAMPOS.filter((c) =>
    sel.some((id) => db.exames.filter((e) => e.pessoaId === id && e.d[c] !== undefined).length >= 2));
  const alvo = disponiveis.includes(metrica) ? metrica : disponiveis[0];

  const series = alvo
    ? sel.map((id) => ({
        id,
        nome: db.pessoas.find((p) => p.id === id)?.nome ?? "?",
        pontos: db.exames.filter((e) => e.pessoaId === id && e.d[alvo] !== undefined)
          .sort((a, b) => (a.data < b.data ? -1 : 1)).map((e) => ({ data: e.data, v: e.d[alvo] })),
      }))
    : [];

  return (
    <div className="cartao">
      <h2>Comparar atletas</h2>
      <p><small>Escolha até quatro pessoas e um indicador para ver as trajetórias no mesmo eixo, fora do contexto de qualquer evento.</small></p>

      <div className="chip">
        {db.pessoas.map((p) => {
          const on = sel.includes(p.id);
          const i = sel.indexOf(p.id);
          return (
            <button key={p.id} data-on={on ? "1" : "0"} onClick={() => alternar(p.id)}
              style={on ? { background: CORES[i % 4], borderColor: CORES[i % 4], color: "#fff" } : undefined}>
              {p.nome}
            </button>
          );
        })}
      </div>

      {sel.length === 0 && <small>Selecione pelo menos um atleta.</small>}

      {sel.length > 0 && disponiveis.length === 0 && (
        <small>Ninguém selecionado tem duas medições do mesmo indicador. Cadastre mais uma medição para desenhar a linha.</small>
      )}

      {alvo && (
        <>
          <div className="chip" style={{ marginTop: 12 }}>
            {disponiveis.map((c) => (
              <button key={c} data-on={c === alvo ? "1" : "0"} onClick={() => setMetrica(c)}>{METRICAS[c].label}</button>
            ))}
          </div>
          <div className="modo" style={{ marginBottom: 12 }}>
            {Object.entries(MODOS).map(([k, m]) => (
              <button key={k} data-on={modo === k ? "1" : "0"} onClick={() => setModo(k)}>{m.label}</button>
            ))}
          </div>
          <p><small>{MODOS[modo].nota}</small></p>
          <GraficoLinhas series={series} un={METRICAS[alvo].un} melhor={METRICAS[alvo].melhor} modo={modo} />
        </>
      )}
    </div>
  );
}

/* ---------------------------- ATLETAS ---------------------------- */
function Atletas({ db, up, medir }) {
  const [nome, setNome] = useState("");
  const [aberto, setAberto] = useState(null);
  const [metrica, setMetrica] = useState("peso");
  const [comparando, setComparando] = useState(false);

  const add = () => {
    if (!nome.trim()) return;
    up({ pessoas: [...db.pessoas, { id: nid(), nome: nome.trim() }] });
    setNome("");
  };
  const remover = (id) => {
    setAberto(null);
    up({
      pessoas: db.pessoas.filter((p) => p.id !== id),
      exames: db.exames.filter((e) => e.pessoaId !== id),
      eventos: db.eventos.map((ev) => ({ ...ev, participantes: ev.participantes.filter((p) => p.pessoaId !== id) })),
    });
  };

  const meus = aberto ? db.exames.filter((e) => e.pessoaId === aberto).sort((a, b) => (a.data < b.data ? -1 : 1)) : [];
  const disponiveis = TODOS_CAMPOS.filter((c) => meus.filter((e) => e.d[c] !== undefined).length >= 1);
  const alvo = disponiveis.includes(metrica) ? metrica : disponiveis[0];
  const pontos = meus.filter((e) => e.d[alvo] !== undefined).map((e) => ({ data: e.data, v: e.d[alvo] }));
  const pessoa = db.pessoas.find((p) => p.id === aberto);

  // Comparar é outra tarefa, com outra pergunta na cabeça de quem usa.
  // Dividindo a tela, cada página responde a uma coisa só.
  if (comparando) {
    return (
      <>
        <div className="linha" style={{ marginBottom: 14 }}>
          <button className="b ghost" onClick={() => setComparando(false)}>← Voltar aos atletas</button>
        </div>
        <Comparador db={db} />
      </>
    );
  }

  return (
    <>
      <div className="cartao">
        <h2>Atletas</h2>
        <div className="linha" style={{ marginBottom: 16 }}>
          <div className="campo" style={{ maxWidth: 320 }}>
            <label>Nome</label>
            <input value={nome} onChange={(e) => setNome(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Ex.: Paulo" />
          </div>
          <button className="b" onClick={add}>Adicionar atleta</button>
        </div>
        {db.pessoas.length === 0 && <small>Nenhum atleta ainda. Comece pelo nome — o resto vem depois.</small>}
        {db.pessoas.map((p) => {
          const n = db.exames.filter((e) => e.pessoaId === p.id).length;
          return (
            <button className="fileira" key={p.id} data-on={aberto === p.id ? "1" : "0"}
              onClick={() => setAberto(aberto === p.id ? null : p.id)}>
              <strong>{p.nome}</strong>
              <span className="tag">{n} {n === 1 ? "medição" : "medições"}</span>
            </button>
          );
        })}

        {db.pessoas.length >= 2 && (
          <div style={{ marginTop: 16 }}>
            <button className="b ghost" onClick={() => setComparando(true)}>Comparar atletas</button>
            <p style={{ margin: "6px 0 0" }}><small>Trajetórias de até quatro pessoas no mesmo eixo, fora de qualquer evento.</small></p>
          </div>
        )}
      </div>

      {pessoa && (
        <div className="cartao">
          <div className="linha" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>{pessoa.nome}</h2>
            <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="b" style={{ background: "var(--acao)", borderColor: "var(--acao)" }}
                onClick={() => medir(pessoa.id)}>+ Nova medição</button>
              <button className="b perigo" onClick={() => remover(pessoa.id)}>Excluir atleta</button>
            </span>
          </div>

          {meus.length === 0 && <small>Sem medições ainda. Use “+ Nova medição” para cadastrar a primeira.</small>}

          {meus.length > 0 && (
            <>
              <div className="chip">
                {disponiveis.map((c) => (
                  <button key={c} data-on={c === alvo ? "1" : "0"} onClick={() => setMetrica(c)}>{METRICAS[c].label}</button>
                ))}
              </div>
              <GraficoLinhas series={[{ id: pessoa.id, nome: pessoa.nome, pontos }]} un={METRICAS[alvo].un} melhor={METRICAS[alvo].melhor} />

              <h3 style={{ marginTop: 20 }}>Medições</h3>
              {[...meus].reverse().map((e) => (
                <div className="item" key={e.id}>
                  <span>
                    <strong>{e.data.split("-").reverse().join("/")}</strong><br />
                    <small>
                      {CAMPOS_PRINCIPAIS.filter((c) => e.d[c] !== undefined)
                        .map((c) => `${METRICAS[c].label}: ${fmt(e.d[c], 1)}${METRICAS[c].un}`).join("   ·   ")}
                    </small>
                  </span>
                  <button className="b perigo" onClick={() => up({ exames: db.exames.filter((x) => x.id !== e.id) })}>Excluir</button>
                </div>
              ))}
            </>
          )}
        </div>
      )}

    </>
  );
}

/* ------------------ IMPORTAÇÃO E LEITURA DE RELATÓRIO -------------- */

/** O texto que você cola no chat de IA junto com as fotos do relatório. */
function montarPrompt() {
  const chaves = TODOS_CAMPOS
    .map((c) => `  "${c}"  — ${METRICAS[c].label}${METRICAS[c].un ? ` (${METRICAS[c].un})` : ""}`)
    .join("\n");
  return `Leia as imagens de relatório de bioimpedância em anexo e devolva APENAS um JSON, sem texto antes ou depois e sem cercas de código.

Formato — uma entrada por medição (páginas diferentes do mesmo exame são uma entrada só):

[
  { "nome": "Fulano", "data": "AAAA-MM-DD", "valores": { "peso": 81.95, "gorduraKg": 22.0 } }
]

"nome" vem do ID do relatório e "data" do horário da medição.
Use apenas as chaves abaixo, e inclua só as que aparecerem de fato na imagem.
Números com ponto decimal, sem unidade e sem aspas.

${chaves}`;
}

/** Aceita um objeto, uma lista, ou uma lista embrulhada em { medicoes: [...] }. */
function lerJSON(texto) {
  const bruto = JSON.parse(texto);
  const lista = Array.isArray(bruto) ? bruto : bruto.medicoes ?? bruto.entradas ?? [bruto];
  const entradas = [];
  const avisos = [];

  lista.forEach((item, i) => {
    const rot = `entrada ${i + 1}`;
    const nome = String(item?.nome ?? "").trim();
    const data = String(item?.data ?? "").trim();
    if (!nome) return avisos.push(`${rot}: sem nome.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return avisos.push(`${rot} (${nome}): data fora do formato AAAA-MM-DD.`);

    const valores = {};
    const ignoradas = [];
    Object.entries(item?.valores ?? {}).forEach(([k, v]) => {
      const n = Number(String(v).replace(",", "."));
      if (!METRICAS[k]) ignoradas.push(k);
      else if (!Number.isNaN(n)) valores[k] = n;
    });
    if (ignoradas.length) avisos.push(`${rot} (${nome}): chaves desconhecidas ignoradas — ${ignoradas.join(", ")}.`);
    if (!Object.keys(valores).length) return avisos.push(`${rot} (${nome}): nenhum indicador reconhecido.`);

    entradas.push({ nome, data, valores });
  });

  return { entradas, avisos };
}

function ImportarJSON({ db, up }) {
  const [texto, setTexto] = useState("");
  const [previa, setPrevia] = useState(null);
  const [msg, setMsg] = useState("");

  const analisar = (conteudo) => {
    setMsg("");
    try {
      const { entradas, avisos } = lerJSON(conteudo);
      if (!entradas.length) {
        setPrevia(null);
        setMsg(avisos.join(" ") || "Nenhuma medição válida encontrada.");
        return;
      }
      const marcadas = entradas.map((e) => {
        const pessoa = db.pessoas.find((p) => p.nome.trim().toLowerCase() === e.nome.toLowerCase());
        const repetida = pessoa && db.exames.some((x) => x.pessoaId === pessoa.id && x.data === e.data);
        return { ...e, novaPessoa: !pessoa, repetida };
      });
      setPrevia({ entradas: marcadas, avisos });
    } catch (err) {
      setPrevia(null);
      setMsg("O conteúdo não é um JSON válido. Verifique se copiou o bloco inteiro, das chaves de abertura às de fechamento.");
    }
  };

  const importar = () => {
    const pessoas = [...db.pessoas];
    const exames = [...db.exames];
    let novos = 0;

    previa.entradas.filter((e) => !e.repetida).forEach((e) => {
      let pessoa = pessoas.find((p) => p.nome.trim().toLowerCase() === e.nome.toLowerCase());
      if (!pessoa) { pessoa = { id: nid(), nome: e.nome }; pessoas.push(pessoa); }
      exames.push({ id: nid(), pessoaId: pessoa.id, data: e.data, d: e.valores });
      novos += 1;
    });

    up({ pessoas, exames });
    setPrevia(null);
    setTexto("");
    setMsg(`${novos} ${novos === 1 ? "medição importada" : "medições importadas"}.`);
  };

  const arquivo = (f) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { setTexto(String(r.result)); analisar(String(r.result)); };
    r.readAsText(f);
  };

  return (
    <div className="cartao">
      <h2>Importar por chat de IA</h2>
      <p><small>
        O caminho mais preciso quando você tem a foto do relatório: quem lê a imagem é um chat de IA
        (ChatGPT, Gemini, Claude, Copilot — qualquer um que aceite imagem), e o app só recebe o resultado já em texto.
      </small></p>

      <ol className="passos">
        <li><strong>Copie as instruções</strong> no botão abaixo. É um texto que ensina a IA a devolver exatamente o formato que este app entende.</li>
        <li><strong>Abra o chat de IA</strong> da sua preferência e <strong>cole o texto junto com as fotos</strong> do relatório de bioimpedância, na mesma mensagem.</li>
        <li><strong>Copie a resposta</strong> — ela vem como um bloco de dados começando com <code>[</code> e terminando com <code>]</code>.</li>
        <li><strong>Cole aqui embaixo</strong> e clique em <strong>Conferir</strong>. Nada é gravado antes de você ver a prévia.</li>
      </ol>

      <p><small>
        Vale mandar várias medições de uma vez, inclusive de pessoas diferentes — quem ainda não estiver
        cadastrado é criado na hora. Medições em uma data que o atleta já tem são marcadas e ficam de fora.
      </small></p>

      <div className="linha" style={{ marginBottom: 12 }}>
        <button className="b" style={{ background: "var(--acao)", borderColor: "var(--acao)" }} onClick={() => {
          navigator.clipboard?.writeText(montarPrompt())
            .then(() => setMsg("Instruções copiadas. Cole no chat de IA junto com as fotos do relatório."))
            .catch(() => setMsg("Não consegui copiar sozinho. O texto está no campo abaixo — selecione e copie."));
          setTexto(montarPrompt());
        }}>
          1. Copiar instruções para a IA
        </button>
        <label className="b ghost" style={{ display: "inline-block" }}>
          Abrir arquivo .json
          <input type="file" accept=".json,application/json" style={{ display: "none" }}
            onChange={(e) => { arquivo(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
      </div>

      <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={7}
        placeholder='Cole aqui a resposta da IA — algo como [{ "nome": "Paulo", "data": "2026-09-03", "valores": { "peso": 81.95 } }]'
        style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 12.5, padding: 10,
                 border: "1px solid var(--linha)", borderRadius: 2, resize: "vertical" }} />

      <div className="linha" style={{ marginTop: 10 }}>
        <button className="b" disabled={!texto.trim()} onClick={() => analisar(texto)}>4. Conferir</button>
        {previa && <button className="b" onClick={importar}
          disabled={!previa.entradas.some((e) => !e.repetida)}
          style={{ background: "var(--acao)", borderColor: "var(--acao)" }}>
          Importar {previa.entradas.filter((e) => !e.repetida).length}
        </button>}
      </div>

      {msg && <p style={{ marginTop: 10 }}><small>{msg}</small></p>}

      {previa && (
        <div style={{ marginTop: 14 }}>
          <h3>Confira antes de importar</h3>
          {previa.entradas.map((e, i) => (
            <div className="item" key={i}>
              <span>
                <strong>{e.nome}</strong>
                {e.novaPessoa && <span className="tag" style={{ marginLeft: 8 }}>atleta novo</span>}
                {e.repetida && <span className="tag" style={{ marginLeft: 8, color: "var(--alerta)", borderColor: "var(--alerta)" }}>já existe nesta data</span>}
                <br />
                <small>{e.data.split("-").reverse().join("/")} · {Object.keys(e.valores).length} indicadores · {
                  CAMPOS_PRINCIPAIS.filter((c) => e.valores[c] !== undefined)
                    .map((c) => `${METRICAS[c].label}: ${fmt(e.valores[c], 1)}${METRICAS[c].un}`).join("   ·   ")
                }</small>
              </span>
            </div>
          ))}
          {previa.avisos.map((a, i) => (
            <p key={i} style={{ margin: "6px 0 0" }}><small style={{ color: "var(--alerta)" }}>{a}</small></p>
          ))}
        </div>
      )}
    </div>
  );
}

/** Leitura por OCR, dentro do próprio navegador. Sem chave, sem servidor. */
function LeitorRelatorio({ aplicar }) {
  const [estado, setEstado] = useState("parado");
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState("");

  const processar = async (files) => {
    if (!files?.length) return;
    setEstado("lendo"); setMsg(""); setPct(0);
    try {
      const { lerTexto, interpretar } = await import("./ocr");
      const texto = await lerTexto(Array.from(files).slice(0, 4), (p) => setPct(Math.round(p * 100)));
      const { nome, data, valores } = interpretar(texto);
      const n = Object.keys(valores).length;
      if (!n) throw new Error("nada reconhecido");
      aplicar({ data, nome, valores });
      setEstado("parado");
      setMsg(`${n} indicadores preenchidos. Confira cada um antes de salvar.`);
    } catch (e) {
      setEstado("erro");
      setMsg("A leitura não deu certo. Prefira o print do relatório à foto da tela, ou use a importação por JSON acima.");
    }
  };

  return (
    <div className="solta" style={{ marginBottom: 16 }}>
      <p style={{ margin: "0 0 10px" }}><strong style={{ fontSize: 14 }}>Ou tente ler a imagem aqui mesmo</strong></p>
      <p><small>O reconhecimento roda no seu navegador. Funciona bem com prints nítidos e erra mais com fotos de tela.</small></p>
      <input type="file" accept="image/*" multiple style={{ maxWidth: 320, margin: "0 auto" }}
        disabled={estado === "lendo"} onChange={(e) => { processar(e.target.files); e.target.value = ""; }} />
      {estado === "lendo" && <p style={{ marginTop: 10 }}><span className="carregando" /> <small> Reconhecendo… {pct}%</small></p>}
      {msg && <p style={{ marginTop: 10 }}><small style={{ color: estado === "erro" ? "var(--alerta)" : "var(--acao)" }}>{msg}</small></p>}
    </div>
  );
}

/* --------------------------- MEDIÇÕES ---------------------------- */
function Medicoes({ db, up, alvo, limparAlvo }) {
  const [pessoaId, setPessoaId] = useState(alvo ?? "");
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [vals, setVals] = useState({});
  const [verExtras, setVerExtras] = useState(false);

  // Quem chegou pelo botão "+ Nova medição" da ficha do atleta já vem
  // com a pergunta respondida. O alvo é consumido uma vez e devolvido,
  // senão ele prenderia a seleção nas visitas seguintes à aba.
  useEffect(() => {
    if (!alvo) return;
    setPessoaId(alvo);
    limparAlvo();
  }, [alvo]);

  const pessoa = db.pessoas.find((p) => p.id === pessoaId);
  const meus = db.exames.filter((e) => e.pessoaId === pessoaId).sort((a, b) => (a.data < b.data ? 1 : -1));
  const conflito = meus.find((e) => e.data === data);

  const aplicarLeitura = ({ data: dt, nome, valores }) => {
    if (dt && /^\d{4}-\d{2}-\d{2}$/.test(dt)) setData(dt);
    const achado = nome && db.pessoas.find((p) => p.nome.trim().toLowerCase() === String(nome).trim().toLowerCase());
    if (achado) setPessoaId(achado.id);
    setVals(Object.fromEntries(Object.entries(valores).map(([k, v]) => [k, String(v)])));
    setVerExtras(true);
  };

  const salvar = () => {
    if (!pessoaId || !data || conflito) return;
    const d = {};
    Object.entries(vals).forEach(([k, v]) => { if (v !== "" && v !== undefined) d[k] = Number(String(v).replace(",", ".")); });
    if (Object.keys(d).length === 0) return;
    up({ exames: [...db.exames, { id: nid(), pessoaId, data, d }] });
    setVals({});
  };

  const campos = verExtras ? TODOS_CAMPOS : CAMPOS_PRINCIPAIS;

  return (
    <>
      {/* Primeira pergunta, sempre: de quem é esta medição? Tudo abaixo
          depende da resposta, então ela não pode ficar no meio da tela. */}
      <div className="cartao">
        <h2>De quem é a medição?</h2>
        <div className="campo" style={{ maxWidth: 340 }}>
          <label>Atleta</label>
          <select value={pessoaId} onChange={(e) => setPessoaId(e.target.value)}>
            <option value="">Selecione um atleta</option>
            {db.pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </div>
        {db.pessoas.length === 0 && (
          <p style={{ marginTop: 10 }}><small>Nenhum atleta cadastrado ainda. Comece pela aba <strong>Atletas</strong>.</small></p>
        )}
      </div>

      {!pessoa ? (
        <div className="cartao"><small>Escolha um atleta acima para cadastrar e ver as medições dele.</small></div>
      ) : (
        <>
          <div className="cartao">
            <h2>Nova medição de {pessoa.nome}</h2>
            <p><small>Envie a imagem do relatório ou digite os valores. Deixe em branco o que não for usar — só entra no ranking o indicador que as duas medições tiverem.</small></p>
            <LeitorRelatorio aplicar={aplicarLeitura} />

            <div className="linha" style={{ marginBottom: 12 }}>
              <div className="campo" style={{ maxWidth: 200 }}>
                <label>Data da medição</label>
                <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
              </div>
            </div>

            {conflito && (
              <p style={{ margin: "0 0 12px" }}><small style={{ color: "var(--alerta)" }}>
                <strong>{pessoa.nome} já tem uma medição em {data.split("-").reverse().join("/")}.</strong>{" "}
                Vale uma por dia: duas no mesmo dia deixam o ranking dependendo de qual delas o sistema pegar como
                início ou fim. Apague a anterior no histórico abaixo, ou escolha outra data.
              </small></p>
            )}

            <div className="grade">
              {campos.map((c) => (
                <div className="campo" key={c}>
                  <label>{METRICAS[c].label} {METRICAS[c].un && `(${METRICAS[c].un})`}</label>
                  <input inputMode="decimal" value={vals[c] ?? ""} onChange={(e) => setVals({ ...vals, [c]: e.target.value })} />
                </div>
              ))}
            </div>
            <div className="linha" style={{ marginTop: 14 }}>
              <button className="b" onClick={salvar} disabled={!!conflito}>Salvar medição</button>
              <button className="b ghost" onClick={() => setVerExtras(!verExtras)}>
                {verExtras ? "Mostrar só os principais" : "Mostrar todos os indicadores"}
              </button>
            </div>
          </div>

          <ImportarJSON db={db} up={up} />

          <div className="cartao">
            <h2>Histórico de {pessoa.nome}</h2>
            {meus.length === 0 && <small>Nenhuma medição registrada para {pessoa.nome}.</small>}
            {meus.map((e) => (
              <div className="item" key={e.id}>
                <span>
                  <strong>{e.data.split("-").reverse().join("/")}</strong>
                  <br />
                  <small>
                    {CAMPOS_PRINCIPAIS.filter((c) => e.d[c] !== undefined)
                      .map((c) => `${METRICAS[c].label}: ${fmt(e.d[c], 1)}${METRICAS[c].un}`)
                      .join("   ·   ")}
                  </small>
                </span>
                <button className="b perigo" onClick={() => up({ exames: db.exames.filter((x) => x.id !== e.id) })}>Excluir</button>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/* ---------------------------- EVENTOS ---------------------------- */
function Eventos({ db, up, abrir }) {
  const [editando, setEditando] = useState(null);
  const ev = db.eventos.find((e) => e.id === editando);

  const criar = () => {
    const novo = { id: nid(), nome: `Evento de ${new Date().toLocaleDateString("pt-BR", { month: "long" })}`,
      criterios: [], premiados: 1, permitirRepetir: false, normalizarTempo: false, desempate: [], participantes: [] };
    up({ eventos: [...db.eventos, novo] });
    setEditando(novo.id);
  };
  const salvarEv = (patch) => up({ eventos: db.eventos.map((e) => (e.id === ev.id ? { ...e, ...patch } : e)) });

  if (!ev) {
    return (
      <div className="cartao">
        <h2>Eventos</h2>
        <p><small>
          Um evento é uma disputa: categorias escolhidas, participantes com medição inicial e final, e regras de premiação.
          Ele fica guardado do jeito que você deixar — a cerimônia é um momento à parte, para o dia da premiação.
        </small></p>

        {db.eventos.length === 0 && <small>Nenhum evento ainda. Crie um, configure com calma, e volte aqui quando for premiar.</small>}

        {db.eventos.map((e) => {
          const pronto = e.criterios.length > 0 && e.participantes.length >= 2;
          return (
            <div className="item" key={e.id}>
              <span>
                <strong>{e.nome}</strong><br />
                <small>
                  {e.participantes.length} participantes · {e.criterios.length} categorias · {e.premiados} premiado(s) por categoria
                  {!pronto && <> · <span style={{ color: "var(--alerta)" }}>configuração incompleta</span></>}
                </small>
              </span>
              <span style={{ display: "flex", gap: 8 }}>
                <button className="b" onClick={() => setEditando(e.id)}>Abrir e configurar</button>
                <button className="b ghost" disabled={!pronto} onClick={() => abrir(e.id)}>Iniciar cerimônia</button>
              </span>
            </div>
          );
        })}
        <div style={{ marginTop: 16 }}><button className="b" onClick={criar}>Criar evento</button></div>
      </div>
    );
  }

  return <EditorEvento ev={ev} db={db} up={up} salvarEv={salvarEv} voltar={() => setEditando(null)} abrir={abrir} />;
}

function EditorEvento({ ev, db, up, salvarEv, voltar, abrir }) {
  const marcado = (campo) => ev.criterios.find((c) => c.campo === campo);
  const alternar = (campo) =>
    salvarEv({
      criterios: marcado(campo)
        ? ev.criterios.filter((c) => c.campo !== campo)
        : [...ev.criterios, { campo, modo: METRICAS[campo].rec }],
    });
  const setModo = (campo, modo) => salvarEv({ criterios: ev.criterios.map((c) => (c.campo === campo ? { ...c, modo } : c)) });

  const addPart = (pessoaId) => {
    const meus = db.exames.filter((e) => e.pessoaId === pessoaId).sort((a, b) => (a.data < b.data ? -1 : 1));
    salvarEv({ participantes: [...ev.participantes, { pessoaId, iniId: meus[0]?.id ?? "", fimId: meus[meus.length - 1]?.id ?? "" }] });
  };
  const setPart = (i, patch) => salvarEv({ participantes: ev.participantes.map((p, j) => (i === j ? { ...p, ...patch } : p)) });

  const fora = db.pessoas.filter((p) => !ev.participantes.some((x) => x.pessoaId === p.id));
  const pronto = ev.criterios.length > 0 && ev.participantes.length >= 2 &&
    ev.participantes.every((p) => p.iniId && p.fimId && p.iniId !== p.fimId);

  return (
    <>
      <div className="linha" style={{ marginBottom: 14 }}>
        <button className="b ghost" onClick={voltar}>Voltar aos eventos</button>
        <button className="b perigo" onClick={() => { up({ eventos: db.eventos.filter((e) => e.id !== ev.id) }); voltar(); }}>Excluir evento</button>
      </div>

      <div className="cartao">
        <h2>Identificação</h2>
        <div className="campo" style={{ maxWidth: 380 }}>
          <label>Nome do evento</label>
          <input value={ev.nome} onChange={(e) => salvarEv({ nome: e.target.value })} />
        </div>
      </div>

      <div className="cartao">
        <h2>Categorias em disputa</h2>
        <p><small>
          Cada categoria selecionada vira um sorteio na cerimônia. O modo decide o que conta como mérito:
          <strong> absoluto</strong> compara a diferença crua (fim menos início), <strong>percentual</strong> compara
          quanto essa diferença representa do ponto de partida de cada um. A sugestão marcada é a mais justa para aquele indicador.
        </small></p>
        {TODOS_CAMPOS.map((campo) => {
          const c = marcado(campo);
          const m = METRICAS[campo];
          return (
            <div className="crit" key={campo} data-on={c ? "1" : "0"}>
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", flex: 1 }}>
                <input type="checkbox" checked={!!c} onChange={() => alternar(campo)} style={{ width: 16, marginTop: 3 }} />
                <span>
                  <strong style={{ fontSize: 14 }}>{m.label}</strong>{" "}
                  <span className="tag">{m.melhor === "maior" ? "quanto maior, melhor" : "quanto menor, melhor"}</span>
                  {c && <><br /><small>{m.porque}</small></>}
                </span>
              </label>
              {c && (
                <div className="modo">
                  {["abs", "pct"].map((k) => (
                    <button key={k} data-on={c.modo === k ? "1" : "0"} onClick={() => setModo(campo, k)}>
                      {k === "abs" ? "absoluto" : "percentual"}{m.rec === k ? " ★" : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <small>★ marca a sugestão do sistema para aquele indicador.</small>
      </div>

      <div className="cartao">
        <h2>Regras da premiação</h2>
        <div className="linha">
          <div className="campo" style={{ maxWidth: 200 }}>
            <label>Premiados por categoria</label>
            <input type="number" min="1" value={ev.premiados} onChange={(e) => salvarEv({ premiados: Math.max(1, Number(e.target.value) || 1) })} />
          </div>
        </div>
        <label style={{ display: "flex", gap: 9, marginTop: 14, alignItems: "flex-start" }}>
          <input type="checkbox" style={{ width: 16, marginTop: 3 }} checked={ev.permitirRepetir} onChange={(e) => salvarEv({ permitirRepetir: e.target.checked })} />
          <span><strong style={{ fontSize: 14 }}>Um atleta pode ser premiado em mais de uma categoria</strong><br />
            <small>Desmarcado, quem já levou um prêmio continua aparecendo no ranking, mas em cinza: a vaga desce para o próximo ainda não premiado.</small></span>
        </label>
        <label style={{ display: "flex", gap: 9, marginTop: 12, alignItems: "flex-start" }}>
          <input type="checkbox" style={{ width: 16, marginTop: 3 }} checked={ev.normalizarTempo} onChange={(e) => salvarEv({ normalizarTempo: e.target.checked })} />
          <span><strong style={{ fontSize: 14 }}>Normalizar por tempo (resultado por 30 dias)</strong><br />
            <small>Use quando os intervalos forem diferentes entre os participantes. Quem teve 5 meses não compete de igual para igual com quem teve 2.</small></span>
        </label>
      </div>

      <Desempate ev={ev} salvarEv={salvarEv} />

      <div className="cartao">
        <h2>Participantes</h2>
        {ev.participantes.length === 0 && <small>Nenhum participante inscrito.</small>}
        {ev.participantes.map((p, i) => {
          const meus = db.exames.filter((e) => e.pessoaId === p.pessoaId).sort((a, b) => (a.data < b.data ? -1 : 1));
          const nome = db.pessoas.find((x) => x.id === p.pessoaId)?.nome;
          const ini = meus.find((e) => e.id === p.iniId), fim = meus.find((e) => e.id === p.fimId);
          return (
            <div key={p.pessoaId} style={{ borderBottom: "1px solid var(--linha)", padding: "12px 0" }}>
              <div className="linha">
                <div className="campo" style={{ maxWidth: 150 }}><strong>{nome}</strong></div>
                <div className="campo">
                  <label>Medição inicial</label>
                  <select value={p.iniId} onChange={(e) => setPart(i, { iniId: e.target.value })}>
                    <option value="">—</option>
                    {meus.map((e) => <option key={e.id} value={e.id}>{e.data.split("-").reverse().join("/")}</option>)}
                  </select>
                </div>
                <div className="campo">
                  <label>Medição final</label>
                  <select value={p.fimId} onChange={(e) => setPart(i, { fimId: e.target.value })}>
                    <option value="">—</option>
                    {meus.map((e) => <option key={e.id} value={e.id}>{e.data.split("-").reverse().join("/")}</option>)}
                  </select>
                </div>
                <button className="b perigo" onClick={() => salvarEv({ participantes: ev.participantes.filter((_, j) => j !== i) })}>Tirar</button>
              </div>
              {ini && fim && <small>{dias(ini.data, fim.data)} dias entre as duas medições</small>}
            </div>
          );
        })}
        {fora.length > 0 && (
          <div className="linha" style={{ marginTop: 14 }}>
            <div className="campo" style={{ maxWidth: 240 }}>
              <label>Inscrever atleta</label>
              <select value="" onChange={(e) => e.target.value && addPart(e.target.value)}>
                <option value="">Selecione</option>
                {fora.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
          </div>
        )}
      </div>

      <Previa ev={ev} db={db} />

      <div className="cartao" style={{ textAlign: "center" }}>
        <p><small>
          Tudo aqui é gravado enquanto você digita — não existe botão de salvar, e sair não perde nada.
          A cerimônia é opcional e pode esperar o dia da premiação.
        </small></p>
        <div className="linha" style={{ justifyContent: "center", marginTop: 6 }}>
          <button className="b" onClick={voltar}>Concluir e voltar aos eventos</button>
          <button className="b ghost" disabled={!pronto} onClick={() => abrir(ev.id)}
            style={pronto ? { color: "var(--ouro)", borderColor: "var(--ouro)" } : undefined}>
            Iniciar cerimônia agora
          </button>
        </div>
        {!pronto && <p style={{ marginTop: 10 }}><small>
          Para a cerimônia ainda faltam: {[
            ev.criterios.length ? null : "escolher ao menos uma categoria",
            ev.participantes.length >= 2 ? null : "inscrever ao menos dois participantes",
            ev.participantes.every((p) => p.iniId && p.fimId && p.iniId !== p.fimId) ? null : "definir medição inicial e final diferentes para cada um",
          ].filter(Boolean).join(" · ")}.
        </small></p>}
      </div>
    </>
  );
}

/* ------------------------- DESEMPATE ------------------------------ *
 *  Uma fila de indicadores, na ordem. Empatou na categoria em disputa,
 *  desce um degrau; empatou de novo, desce mais um.
 * ------------------------------------------------------------------ */
const MAX_DESEMPATE = 5;

function Desempate({ ev, salvarEv }) {
  const fila = ev.desempate ?? [];
  const setFila = (nova) => salvarEv({ desempate: nova });
  const fora = TODOS_CAMPOS.filter((c) => !fila.includes(c));

  const mover = (i, passo) => {
    const j = i + passo;
    if (j < 0 || j >= fila.length) return;
    const nova = [...fila];
    [nova[i], nova[j]] = [nova[j], nova[i]];
    setFila(nova);
  };

  return (
    <div className="cartao">
      <h2>Critérios de desempate</h2>
      <p><small>
        Quando duas pessoas terminam a categoria com exatamente o mesmo mérito, a ordem abaixo decide quem fica na
        frente: consulta-se o primeiro indicador da fila; persistindo o empate, o segundo; e assim por diante.
        Cada um é lido no seu modo recomendado.
      </small></p>
      <p><small>
        <strong>Dois já é o ideal.</strong> Um empate sobrevive ao primeiro desempate raramente, e ao segundo quase
        nunca; do terceiro em diante você ganha regra para decorar sem ganhar decisão. O limite é {MAX_DESEMPATE}.
      </small></p>

      {fila.length === 0 && <small>Nenhum critério de desempate. Havendo empate, a ordem entre os empatados fica indefinida.</small>}

      {fila.map((campo, i) => (
        <div className="item" key={campo}>
          <span>
            <span className="num">{i + 1}º</span> &nbsp;<strong>{METRICAS[campo].label}</strong>{" "}
            <span className="tag">{METRICAS[campo].melhor === "maior" ? "maior, melhor" : "menor, melhor"}</span>
            <span className="tag" style={{ marginLeft: 6 }}>{METRICAS[campo].rec === "pct" ? "percentual" : "absoluto"}</span>
          </span>
          <span style={{ display: "flex", gap: 6 }}>
            <button className="b ghost" disabled={i === 0} onClick={() => mover(i, -1)} aria-label="Subir">↑</button>
            <button className="b ghost" disabled={i === fila.length - 1} onClick={() => mover(i, 1)} aria-label="Descer">↓</button>
            <button className="b perigo" onClick={() => setFila(fila.filter((c) => c !== campo))}>Tirar</button>
          </span>
        </div>
      ))}

      {fila.length < MAX_DESEMPATE && fora.length > 0 && (
        <div className="linha" style={{ marginTop: 14 }}>
          <div className="campo" style={{ maxWidth: 300 }}>
            <label>Acrescentar ao fim da fila</label>
            <select value="" onChange={(e) => e.target.value && setFila([...fila, e.target.value])}>
              <option value="">Selecione um indicador</option>
              {fora.map((c) => <option key={c} value={c}>{METRICAS[c].label}</option>)}
            </select>
          </div>
        </div>
      )}
      {fila.length >= MAX_DESEMPATE && <small>Limite de {MAX_DESEMPATE} atingido. Tire um para acrescentar outro.</small>}

      {fila.length > 0 && (
        <p style={{ marginTop: 12, marginBottom: 0 }}><small>
          Um desempate igual à categoria em disputa é ignorado automaticamente: os valores que empataram
          são os mesmos, e consultá-los de novo daria o mesmo empate.
        </small></p>
      )}
    </div>
  );
}

/* Prévia técnica: o organizador confere os números antes da festa. */
function Previa({ ev, db }) {
  if (!ev.criterios.length || ev.participantes.length < 2) return null;
  return (
    <div className="cartao">
      <h2>Prévia dos rankings</h2>
      <p><small>Só você vê isto. Serve para conferir se o modo escolhido produz um resultado que faz sentido antes de sortear em público.</small></p>
      {ev.criterios.map((c) => {
        const r = calcularRanking(ev, c, db.exames, db.pessoas);
        return (
          <div key={c.campo} style={{ marginBottom: 16 }}>
            <h3>{METRICAS[c.campo].label} <span className="tag">{c.modo === "pct" ? "percentual" : "absoluto"}</span></h3>
            {r.map((l, i) => (
              <div className="item" key={l.pessoaId}>
                <span>
                  <span className="num">{i + 1}º</span> &nbsp;{l.nome}
                  {l.desempatadoPor && <span className="tag" style={{ marginLeft: 8 }}>desempate: {METRICAS[l.desempatadoPor].label}</span>}
                </span>
                <small>
                  {fmt(l.vi, 1)} → {fmt(l.vf, 1)} {METRICAS[c.campo].un} &nbsp;·&nbsp;
                  <span className={l.score >= 0 ? "mais" : "menos"}>
                    {c.modo === "pct" ? `${l.pct > 0 ? "+" : ""}${fmt(l.pct, 1)}%` : `${l.abs > 0 ? "+" : ""}${fmt(l.abs, 2)}`}
                  </span>
                  {ev.normalizarTempo && ` · ${l.d} dias`}
                </small>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------- CERIMÔNIA --------------------------- */
function Cerimonia({ evento, db, fechar }) {
  const ordem = useMemo(() => [...evento.criterios].sort(() => Math.random() - 0.5), [evento.id]);
  const [idx, setIdx] = useState(0);
  const [fase, setFase] = useState("abertura"); // abertura | sorteio | revelando | resultado | fim
  const [girando, setGirando] = useState("");
  const [visiveis, setVisiveis] = useState(0);
  const [historico, setHistorico] = useState([]);
  const timer = useRef(null);

  const jaPremiados = useMemo(() => {
    const s = new Set();
    historico.forEach((h) => h.ranking.forEach((l) => l.premio && s.add(l.pessoaId)));
    return s;
  }, [historico]);

  const criterio = ordem[idx];
  const rankingAtual = useMemo(
    () => (criterio ? aplicarPremiacao(calcularRanking(evento, criterio, db.exames, db.pessoas), jaPremiados, evento) : []),
    [criterio, jaPremiados]
  );

  // roleta de sorteio da categoria
  const sortear = () => {
    setFase("sorteio");
    let n = 0;
    const nomes = ordem.map((c) => METRICAS[c.campo].label);
    const passo = () => {
      n += 1;
      setGirando(nomes[Math.floor(Math.random() * nomes.length)]);
      if (n < 22) timer.current = setTimeout(passo, 60 + n * 9);
      else {
        setGirando(METRICAS[criterio.campo].label);
        timer.current = setTimeout(() => { setFase("revelando"); setVisiveis(0); }, 1100);
      }
    };
    passo();
  };

  // revelação de baixo para cima, um por vez, no ritmo de quem apresenta
  const avancar = () => {
    if (fase !== "revelando") return;
    if (visiveis < rankingAtual.length) setVisiveis((v) => v + 1);
    else setFase("resultado");
  };

  useEffect(() => {
    const tecla = (e) => {
      if (["ArrowRight", "ArrowDown", " ", "Enter"].includes(e.key)) { e.preventDefault(); avancar(); }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); setVisiveis((v) => Math.max(0, v - 1)); }
      if (e.key === "Escape") fechar();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [fase, visiveis, rankingAtual.length]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const proxima = () => {
    setHistorico((h) => [...h, { campo: criterio.campo, modo: criterio.modo, ranking: rankingAtual }]);
    if (idx + 1 < ordem.length) { setIdx(idx + 1); setFase("abertura"); setVisiveis(0); }
    else setFase("fim");
  };

  const mostrados = rankingAtual.slice(Math.max(0, rankingAtual.length - visiveis));
  const campeao = rankingAtual.find((l) => l.premio === 1);

  return (
    <div className="palco" onClick={fase === "revelando" ? avancar : undefined} style={fase === "revelando" ? { cursor: "pointer" } : undefined}>
      {(fase === "resultado" || fase === "fim") && <Confete />}
      <button className="b ghost" style={{ position: "absolute", top: 16, right: 16, color: "#8FA5AC", borderColor: "#33474F" }}
        onClick={(e) => { e.stopPropagation(); fechar(); }}>Sair</button>

      {fase === "abertura" && (
        <>
          <small style={{ color: "#7E979F" }}>{evento.nome} · categoria {idx + 1} de {ordem.length}</small>
          <h1>Próxima categoria</h1>
          <p style={{ color: "#9DB2B8", textAlign: "center", maxWidth: 460 }}>
            {ordem.length - idx} envelope(s) ainda fechado(s). Ninguém sabe qual indicador vai valer agora.
          </p>
          <button className="b grande" style={{ marginTop: 18, background: "var(--ouro)", borderColor: "var(--ouro)", color: "#0C1D26" }} onClick={sortear}>
            Sortear categoria
          </button>
        </>
      )}

      {fase === "sorteio" && (
        <>
          <small style={{ color: "#7E979F" }}>sorteando…</small>
          <div className="roleta">{girando}</div>
        </>
      )}

      {(fase === "revelando" || fase === "resultado") && (
        <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <small style={{ color: "#7E979F" }}>
            {METRICAS[criterio.campo].melhor === "maior" ? "maior ganho" : "maior redução"} · comparação {criterio.modo === "pct" ? "percentual" : "absoluta"}
            {evento.normalizarTempo && " · por 30 dias"}
          </small>
          <h1 style={{ marginBottom: 22 }}>{METRICAS[criterio.campo].label}</h1>
          {mostrados.map((l) => {
            const pos = rankingAtual.indexOf(l) + 1;
            return (
              <div className="pos" key={l.pessoaId} data-premio={l.premio ?? "0"} data-bloq={l.bloqueado ? "1" : "0"}>
                <span className="lugar">{pos}º</span>
                <span className="quem">
                  {l.nome}
                  {l.premio === 1 && <span className="tag" style={{ marginLeft: 8, color: "var(--ouro)", borderColor: "var(--ouro)" }}>campeão</span>}
                  {l.bloqueado && <span className="tag" style={{ marginLeft: 8, color: "#7E979F", borderColor: "#33474F" }}>já premiado</span>}
                  {l.desempatadoPor && <span className="tag" style={{ marginLeft: 8, color: "#9DB2B8", borderColor: "#33474F" }}>
                    desempate: {METRICAS[l.desempatadoPor].label}
                  </span>}
                  <br /><small style={{ color: "#7E979F" }}>{fmt(l.vi, 1)} → {fmt(l.vf, 1)} {METRICAS[criterio.campo].un} · {l.d} dias</small>
                </span>
                <span className="val">
                  {criterio.modo === "pct" ? `${l.pct > 0 ? "+" : ""}${fmt(l.pct, 1)}%` : `${l.abs > 0 ? "+" : ""}${fmt(l.abs, 2)}`}
                </span>
              </div>
            );
          })}
          {fase === "revelando" && (
            <>
              {/* No celular não há seta nem "clique na tela" evidente.
                  Um botão de verdade resolve, e no computador ele não atrapalha. */}
              <div className="linha" style={{ justifyContent: "center", marginTop: 18, width: "100%" }}>
                <button className="b ghost" disabled={visiveis === 0}
                  style={{ color: "#F2F6F4", borderColor: "#33474F" }}
                  onClick={(e) => { e.stopPropagation(); setVisiveis((v) => Math.max(0, v - 1)); }}>Voltar</button>
                <button className="b grande" style={{ background: "var(--ouro)", borderColor: "var(--ouro)", color: "#0C1D26", flex: 1, maxWidth: 320 }}
                  onClick={(e) => { e.stopPropagation(); avancar(); }}>
                  {visiveis === 0 ? "Revelar o último colocado"
                    : visiveis < rankingAtual.length ? `Revelar o ${rankingAtual.length - visiveis}º lugar`
                    : "Coroar o campeão"}
                </button>
              </div>
              <p className="dica">Toque na tela, no botão, ou use <kbd>→</kbd> e <kbd>←</kbd></p>
            </>
          )}
          {fase === "resultado" && (
            <>
              <h2 className="campeao" style={{ color: "var(--ouro)", fontSize: 30, marginTop: 18 }}>
                {campeao ? `${campeao.nome} leva a categoria` : "Sem premiação nesta categoria"}
              </h2>
              <button className="b grande" style={{ marginTop: 10 }} onClick={(e) => { e.stopPropagation(); proxima(); }}>
                {idx + 1 < ordem.length ? "Próxima categoria" : "Ver o resumo final"}
              </button>
            </>
          )}
        </div>
      )}

      {fase === "fim" && <Encerramento evento={evento} historico={historico} fechar={fechar} />}
    </div>
  );
}

function Confete() {
  const cores = ["#D9A227", "#9FB0B6", "#B4703C", "#1B6F5C", "#F2F6F4"];
  return (
    <>
      {Array.from({ length: 60 }).map((_, i) => (
        <span key={i} className="conf" style={{
          left: `${Math.random() * 100}%`,
          background: cores[i % cores.length],
          animationDuration: `${2.2 + Math.random() * 2}s`,
          animationDelay: `${Math.random() * 1.2}s`,
        }} />
      ))}
    </>
  );
}

/* ------------------------- ENCERRAMENTO -------------------------- */
function Encerramento({ evento, historico, fechar }) {
  const pontos = {};
  historico.forEach((h) => h.ranking.forEach((l) => { if (l.premio) pontos[l.nome] = (pontos[l.nome] ?? 0) + (evento.premiados - l.premio + 1); }));
  const geral = Object.entries(pontos).sort((a, b) => b[1] - a[1]);

  const relatorio = () => {
    let t = `# ${evento.nome}\n\nEncerrado em ${new Date().toLocaleDateString("pt-BR")}\n\n`;
    t += `Regras: ${evento.premiados} premiado(s) por categoria · ${evento.permitirRepetir ? "prêmios acumuláveis" : "campeão único por atleta"}${evento.normalizarTempo ? " · resultados normalizados por 30 dias" : ""}\n\n`;
    historico.forEach((h, i) => {
      const m = METRICAS[h.campo];
      t += `## Categoria ${i + 1}: ${m.label} (${h.modo === "pct" ? "variação percentual" : "variação absoluta"})\n`;
      t += `Critério de mérito: ${m.melhor === "maior" ? "maior ganho" : "maior redução"}. ${m.porque}\n\n`;
      t += `| Pos | Atleta | Início | Fim | Variação | Situação |\n|---|---|---|---|---|---|\n`;
      h.ranking.forEach((l, j) => {
        const v = h.modo === "pct" ? `${l.pct > 0 ? "+" : ""}${fmt(l.pct, 1)}%` : `${l.abs > 0 ? "+" : ""}${fmt(l.abs, 2)} ${m.un}`;
        t += `| ${j + 1}º | ${l.nome} | ${fmt(l.vi, 1)} | ${fmt(l.vf, 1)} | ${v} | ${l.premio ? `premiado (${l.premio}º)` : l.bloqueado ? "já premiado antes" : "—"} |\n`;
      });
      t += `\n`;
    });
    t += `## Classificação geral\n\n`;
    geral.forEach(([n, p], i) => { t += `${i + 1}. ${n} — ${p} ponto(s) de pódio\n`; });
    return t;
  };

  const baixar = (conteudo, nome, tipo) => {
    const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
    const a = document.createElement("a");
    a.href = url; a.download = nome; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ textAlign: "center", maxWidth: 560, width: "100%" }}>
      <small style={{ color: "#7E979F" }}>{evento.nome}</small>
      <h1 style={{ marginBottom: 18 }}>Fim da cerimônia</h1>
      {geral.map(([nome, p], i) => (
        <div className="pos" key={nome} data-premio={i + 1 <= 3 ? i + 1 : "0"}>
          <span className="lugar">{i + 1}º</span>
          <span className="quem" style={{ textAlign: "left" }}>{nome}</span>
          <span className="val">{p}</span>
        </div>
      ))}
      <p style={{ color: "#7E979F", marginTop: 10 }}><small>Pontos de pódio: 1º lugar vale {evento.premiados}, e cada posição abaixo vale um a menos.</small></p>
      <div className="linha" style={{ justifyContent: "center", marginTop: 18 }}>
        <button className="b" onClick={() => baixar(relatorio(), `${evento.nome}.md`, "text/markdown")}>Baixar relatório</button>
        <button className="b ghost" style={{ color: "#F2F6F4", borderColor: "#33474F" }}
          onClick={() => baixar(JSON.stringify({ evento: evento.nome, regras: { premiados: evento.premiados, permitirRepetir: evento.permitirRepetir, normalizarTempo: evento.normalizarTempo }, categorias: historico }, null, 2), `${evento.nome}.json`, "application/json")}>
          Baixar JSON
        </button>
        <button className="b ghost" style={{ color: "#F2F6F4", borderColor: "#33474F" }} onClick={fechar}>Fechar</button>
      </div>
    </div>
  );
}
