/**
 * Leitura do relatório de bioimpedância.
 *
 * Esta função existe por um motivo só: a chave da Anthropic não pode
 * viver no navegador. Qualquer visitante abriria o inspetor e a levaria
 * embora. O navegador manda as imagens para cá, e só o servidor conhece
 * a chave (variável de ambiente ANTHROPIC_API_KEY na Vercel).
 */
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ erro: "Use POST." });

  const { imagens, instrucao } = req.body ?? {};
  if (!Array.isArray(imagens) || !imagens.length) {
    return res.status(400).json({ erro: "Envie ao menos uma imagem." });
  }
  if (imagens.length > 4) {
    return res.status(400).json({ erro: "Máximo de quatro imagens por leitura." });
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: [...imagens, { type: "text", text: instrucao }] }],
      }),
    });

    const dados = await r.json();
    if (!r.ok) return res.status(r.status).json({ erro: dados?.error?.message ?? "Falha na leitura." });
    return res.status(200).json(dados);
  } catch (e) {
    return res.status(500).json({ erro: "Não foi possível ler a imagem agora." });
  }
}
