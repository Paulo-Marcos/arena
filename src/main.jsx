import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { sb, temAcesso } from "./dados";

/**
 * Portão de entrada — duas perguntas, nesta ordem.
 *
 *   1. Quem é você?      → o link enviado por e-mail responde.
 *   2. Você foi convidado? → a lista `permitidos` no banco responde.
 *
 * A primeira sozinha não basta: provar que o e-mail é seu não faz dele
 * um e-mail autorizado. A segunda é a que realmente fecha a porta, e ela
 * vive dentro do banco — o app só repete a pergunta para poder recusar
 * em português, em vez de mostrar uma arena vazia sem explicação.
 */
function Portao() {
  const [sessao, setSessao] = useState(undefined);
  const [acesso, setAcesso] = useState(undefined); // undefined | true | false
  const [email, setEmail] = useState("");
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSessao(data.session ?? null));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSessao(s));
    return () => data.subscription.unsubscribe();
  }, []);

  // Segunda pergunta: só faz sentido depois que existe uma sessão.
  useEffect(() => {
    if (!sessao) { setAcesso(undefined); return; }
    let vivo = true;
    temAcesso()
      .then((ok) => vivo && setAcesso(ok))
      .catch(() => vivo && setAcesso(false));
    return () => { vivo = false; };
  }, [sessao]);

  if (sessao === undefined) return <Tela>Carregando…</Tela>;

  if (sessao) {
    if (acesso === undefined) return <Tela>Conferindo o convite…</Tela>;
    if (acesso) return <App />;
    return (
      <Tela>
        <h1 style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 30, margin: "0 0 6px" }}>
          Sem acesso
        </h1>
        <p style={{ color: "#5C6F69", fontSize: 14 }}>
          O e-mail <b>{sessao.user.email}</b> não está na lista de convidados
          desta arena. Peça a quem administra para incluí-lo.
        </p>
        <button onClick={() => sb.auth.signOut()}
          style={{ background: "#132B36", color: "#fff", border: 0, borderRadius: 2, padding: "9px 18px", cursor: "pointer",
                   fontFamily: "'Barlow Condensed',sans-serif", fontSize: 16, fontWeight: 600, marginTop: 14 }}>
          Sair e tentar outro e-mail
        </button>
      </Tela>
    );
  }

  const entrar = async (e) => {
    e.preventDefault();
    setAviso("Enviando…");

    // Primeiro a lista de convidados, depois o e-mail. Nesta ordem a
    // tabela `permitidos` é a única lista que existe: quem está nela
    // entra (a conta nasce sozinha na primeira vez), quem não está nem
    // consome um envio.
    const { data: convidado, error: erroLista } = await sb.rpc("email_permitido", { alvo: email });
    if (erroLista) {
      setAviso("Não consegui conferir a lista de convidados. Rode o schema.sql no Supabase. (" + erroLista.message + ")");
      return;
    }
    if (!convidado) {
      setAviso("Este e-mail não está na lista de convidados. Peça a quem administra a arena para incluí-lo.");
      return;
    }

    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin, shouldCreateUser: true },
    });

    // Chegando aqui, o e-mail É convidado. Qualquer erro agora é outra
    // coisa — limite de envios, SMTP, configuração — e esconder isso
    // atrás de "sem acesso" custa horas de procura no lugar errado.
    setAviso(error
      ? "O e-mail está liberado, mas o envio falhou: " + error.message
      : "Link enviado. Abra sua caixa de entrada.");
  };

  return (
    <Tela>
      <h1 style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 34, margin: "0 0 6px" }}>
        Arena de composição corporal
      </h1>
      <p style={{ color: "#5C6F69", fontSize: 14, marginBottom: 20 }}>
        Informe seu e-mail. Você recebe um link de acesso, sem senha para decorar.
      </p>
      <form onSubmit={entrar} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com"
          style={{ flex: 1, minWidth: 200, padding: "9px 10px", border: "1px solid #C9D4CE", borderRadius: 2, fontSize: 14 }} />
        <button type="submit"
          style={{ background: "#132B36", color: "#fff", border: 0, borderRadius: 2, padding: "9px 18px", cursor: "pointer",
                   fontFamily: "'Barlow Condensed',sans-serif", fontSize: 16, fontWeight: 600 }}>
          Enviar link
        </button>
      </form>
      {aviso && <p style={{ color: "#1B6F5C", fontSize: 13, marginTop: 12 }}>{aviso}</p>}
    </Tela>
  );
}

const Tela = ({ children }) => (
  <div style={{ minHeight: "100vh", background: "#EDF1EE", display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
                fontFamily: "Inter,system-ui,sans-serif", color: "#132B36" }}>
    <div style={{ background: "#fff", border: "1px solid #C9D4CE", borderRadius: 3, padding: 28, maxWidth: 420, width: "100%" }}>
      {children}
    </div>
  </div>
);

createRoot(document.getElementById("raiz")).render(<Portao />);
