/* ------------------------------------------------------------------ *
 *  Leitura do relatório sem chave de API.
 *
 *  Duas etapas independentes:
 *  1. lerTexto()   — OCR dentro do próprio navegador (Tesseract).
 *  2. interpretar() — transforma a sopa de texto em indicadores.
 *
 *  A segunda é testável sem imagem nenhuma, o que importa: é ali que
 *  mora praticamente todo o risco de erro.
 * ------------------------------------------------------------------ */

/* ---------- 1. OCR ---------- */

/**
 * Amplia a imagem antes de reconhecer. Não é capricho: no tamanho
 * original, o ponto decimal de "81.95" ocupa menos de um pixel e some,
 * virando "8195". Dobrar a imagem é o que separa um resultado inútil
 * de um resultado aproveitável.
 */
function ampliar(file, fator = 2) {
  return new Promise((ok, erro) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width * fator;
      c.height = img.height * fator;
      const ctx = c.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, c.width, c.height);
      // Cinza com contraste reforçado: o OCR não usa cor para nada.
      const d = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < d.data.length; i += 4) {
        const g = 0.3 * d.data[i] + 0.59 * d.data[i + 1] + 0.11 * d.data[i + 2];
        const v = Math.max(0, Math.min(255, (g - 128) * 1.25 + 128));
        d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
      }
      ctx.putImageData(d, 0, 0);
      c.toBlob((b) => ok(b), "image/png");
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => erro(new Error("Imagem inválida."));
    img.src = URL.createObjectURL(file);
  });
}

export async function lerTexto(files, aoProgredir = () => {}) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("por", 1, {
    logger: (m) => m.status === "recognizing text" && aoProgredir(m.progress),
  });
  let texto = "";
  try {
    for (const f of files) {
      const { data } = await worker.recognize(await ampliar(f));
      texto += "\n" + data.text;
    }
  } finally {
    await worker.terminate();
  }
  return texto;
}

/* ---------- 2. Interpretação ---------- */

const semAcento = (s) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Faixas do plausível para um adulto. Servem de peneira: um número
// fora da faixa é quase certamente erro de leitura, não um recorde.
const FAIXA = {
  peso: [25, 300], gorduraKg: [1, 150], musculo: [15, 120], musculoEsq: [8, 80],
  agua: [10, 90], proteina: [3, 30], salInorganico: [1, 8], pontuacao: [0, 150],
  visceral: [1, 40], tmb: [700, 4000], pesoLivreGordura: [20, 150],
  gorduraSubcutanea: [1, 60], smi: [3, 20], idadeCorpo: [5, 99],
  whr: [0.4, 1.6], imc: [10, 70], gorduraPct: [3, 70],
};

// A ordem é a regra. "gordura corporal" está dentro de "taxa de gordura
// corporal", então o rótulo mais específico precisa ser consumido antes.
const ROTULOS = [
  ["gorduraSubcutanea", ["gordura subcutanea"]],
  ["visceral", ["grau de gordura visceral", "gordura visceral"]],
  ["tmb", ["taxa metabolica basal"]],
  ["idadeCorpo", ["idade do corpo", "idade corporal"]],
  ["smi", ["smi"]],
  ["whr", ["whr"]],
  ["musculoEsq", ["musculo esqueletico"]],
  ["musculo", ["musculo", "massa muscular"]],
  ["gorduraPct", ["taxa de gordura corporal"]],
  ["gorduraKg", ["gordura corporal", "massa gorda"]],
  ["proteina", ["proteina"]],
  ["agua", ["agua corporal"]],
  ["salInorganico", ["sal inorganico"]],
  ["pontuacao", ["pontuacao corporal", "pontuacao"]],
  ["imc", ["imc"]],
  ["pesoLivreGordura", ["peso corporal livre de gordura", "peso livre de gordura"]],
  ["peso", ["peso"]],
];

/**
 * Coerência fisiológica: um corpo não pode ter mais músculo esquelético
 * do que músculo total, nem peso livre de gordura menor que o músculo.
 * Quando o OCR oferece um valor que quebra uma dessas regras, o valor
 * está errado — não a fisiologia. É a peneira mais barata que existe.
 */
const COERENCIA = {
  musculo: (v, j) => (j.musculoEsq ? v > j.musculoEsq : true),
  pesoLivreGordura: (v, j) => (j.musculo ? v >= j.musculo : true),
  gorduraKg: (v, j) => (j.peso ? v < j.peso : true),
  agua: (v, j) => (j.musculo ? v < j.musculo * 1.2 : true),
};

// Trechos que contêm números e usam as mesmas palavras dos rótulos.
// São apagados antes de qualquer busca, para não roubarem o valor certo.
const ISCAS = [
  "peso alvo", "controle de peso", "controle de gordura", "controle muscular",
  "analise de gordura segmentar", "equilibrio muscular", "distribuicao muscular",
  "obesidade(peso atual/peso alvo)", "obesidade (peso atual/peso alvo)",
  "analise de obesidade", "avaliacao da obesidade", "massa muscular", "massa gorda",
];

// Blocos inteiros do relatório que só têm ruído: eixos de gráfico com
// suas marcas de escala, o histórico de medições anteriores, a grade de
// tipo de corpo e a tabela de impedância. Cada um deles é uma fábrica de
// números plausíveis e errados.
const REGIOES = [
  ["historia", "outros indicadores"],
  ["analise de gordura muscular", "analise de gordura segmentar"],
  ["avaliacao do tipo de corpo", "outros indicadores"],
  ["controle de peso", "avaliacao da obesidade"],
  ["impedancia bioeletrica", null],
];

/** Aceita números plausíveis, corrigindo pontos decimais perdidos. */
function candidatos(trecho, faixa) {
  const saida = [];
  const re = /-?\d+(?:[.,]\d+)?/g;
  let m, achados = 0;
  while ((m = re.exec(trecho)) !== null && achados < 4) {
    achados += 1;
    const n = Number(m[0].replace(",", "."));
    if (Number.isNaN(n)) continue;
    // "81.95" lido como "8195" é o erro mais comum do OCR nesta fonte.
    for (const v of [n, n / 10, n / 100]) {
      if (v >= faixa[0] && v <= faixa[1]) {
        saida.push({ valor: Math.round(v * 100) / 100, decimal: /[.,]/.test(m[0]), dist: m.index });
        break;
      }
    }
  }
  return saida;
}

// Indicadores que o relatório imprime como inteiros. Nos demais, um
// número com casa decimal é sinal de que veio da tabela, e não de um
// eixo de gráfico — que só tem inteiros redondos.
const INTEIROS = new Set(["pontuacao", "visceral", "idadeCorpo", "tmb"]);

/**
 * Escolhe por votação, não pela primeira aparição.
 *
 * O mesmo indicador costuma aparecer duas ou três vezes no relatório,
 * e o valor certo aparece repetido enquanto os erros de leitura são
 * cada um diferente do outro. Repetição é evidência. E, empatados,
 * vence o número que está colado no rótulo: na tabela o valor vem
 * logo depois do nome; no ruído, quase sempre há palavras no meio.
 */
function decidir(campo, ocorrencias, jaLidos) {
  const votos = new Map();
  ocorrencias.forEach(({ valor, decimal, dist }) => {
    const atual = votos.get(valor) ?? { n: 0, decimal: false, dist: 999 };
    votos.set(valor, {
      n: atual.n + 1,
      decimal: atual.decimal || decimal,
      dist: Math.min(atual.dist, dist),
    });
  });
  const regra = COERENCIA[campo];
  let melhor = null, melhorNota = -Infinity;
  for (const [valor, v] of votos) {
    if (regra && !regra(valor, jaLidos)) continue;
    const nota = v.n
      + (v.decimal && !INTEIROS.has(campo) ? 0.7 : 0)
      + (!v.decimal && INTEIROS.has(campo) ? 0.4 : 0)
      - v.dist * 0.06;
    if (nota > melhorNota) { melhorNota = nota; melhor = valor; }
  }
  return melhor;
}

export function interpretar(textoBruto) {
  let t = semAcento(textoBruto).replace(/[|]/g, " ").replace(/\s+/g, " ");

  // Data e altura antes de tudo: são âncoras, não indicadores.
  const md = t.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const data = md ? `${md[3]}-${md[2]}-${md[1]}` : null;

  const mn = t.match(/id\s*[:;]\s*([a-z][a-z\s]{1,24}?)\s+(sexo|idade|altura)/);
  const nome = mn ? mn[1].trim().replace(/\b\w/g, (c) => c.toUpperCase()) : null;

  let altura = null;
  const ma = t.match(/altura\s*[:;]?\s*([^\s]{2,6})\s*[ce]m/);
  if (ma) {
    const limpo = ma[1].replace(/[il|]/g, "1").replace(/[o]/g, "0").replace(/[^\d]/g, "");
    const v = Number(limpo);
    if (v >= 120 && v <= 230) altura = v;
  }

  const branco = (n) => " ".repeat(n);
  const apagar = (texto, alvo) => texto.split(alvo).join(branco(alvo.length));

  // Regiões ruidosas primeiro, depois iscas, depois faixas de referência.
  for (const [ini, fim] of REGIOES) {
    let i = t.indexOf(ini);
    while (i !== -1) {
      const alvo = fim ? t.indexOf(fim, i + ini.length) : -1;
      const ate = alvo === -1 ? Math.min(t.length, i + 900) : alvo;
      t = t.slice(0, i) + branco(ate - i) + t.slice(ate);
      i = t.indexOf(ini, ate);
    }
  }
  ISCAS.forEach((isca) => { t = apagar(t, isca); });
  t = t.replace(/\([^)]{0,30}\)/g, (m) => branco(m.length));
  t = t.replace(/\//g, " ");

  const valores = {};
  for (const [campo, rotulos] of ROTULOS) {
    const ocorrencias = [];
    for (const rot of rotulos) {
      let i = t.indexOf(rot);
      while (i !== -1) {
        const fim = i + rot.length;
        ocorrencias.push(...candidatos(t.slice(fim, fim + 30), FAIXA[campo]));
        i = t.indexOf(rot, fim);
      }
      // Apaga o rótulo (só o rótulo, nunca os números) para que um
      // rótulo genérico não case dentro de um específico já resolvido.
      t = apagar(t, rot);
    }
    const v = decidir(campo, ocorrencias, valores);
    if (v !== null) valores[campo] = v;
  }

  // Dois indicadores saem de conta, não de leitura: os rótulos deles
  // ficam colados em eixos de gráfico e o OCR erra quase sempre.
  if (valores.peso && altura) {
    valores.imc = Math.round((valores.peso / (altura / 100) ** 2) * 10) / 10;
  }
  if (valores.peso && valores.gorduraKg) {
    valores.gorduraPct = Math.round((valores.gorduraKg / valores.peso) * 1000) / 10;
  }

  return { nome, data, altura, valores };
}
