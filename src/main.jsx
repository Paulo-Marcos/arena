import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { sb } from "./dados";

/**
 * Portão de entrada.
 *
 * Sem login, a chave pública do navegador daria a qualquer pessoa o
 * mesmo acesso que você tem. Com login, as regras de segurança do banco
 * conseguem responder à única pergunta que importa: de quem é esta linha?
 */
function Portao() {
  const [sessao, setSessao] = useState(undefined);
  const [email, setEmail] = useState("");
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSessao(data.session ?? null));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSessao(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (sessao === undefined) return <Tela>Carregando…</Tela>;
  if (sessao) return <App />;

  const entrar = async (e) => {
    e.preventDefault();
    setAviso("Enviando…");
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setAviso(error ? "Não foi possível enviar o link. Confira o e-mail." : "Link enviado. Abra sua caixa de entrada.");
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
