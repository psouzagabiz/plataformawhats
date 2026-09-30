"use client";

import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { buttonClasses } from "@/components/ui/Button";

async function chamar<T>(rota: string, body?: unknown) {
  const res = await fetch(`/api/principal?rota=${rota}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(dados?.erro ?? "Erro inesperado.");
  return dados as T;
}

async function irParaCheckout(paroquiaId: number, setErro: (m: string | null) => void, setCarregando: (b: boolean) => void) {
  setCarregando(true);
  setErro(null);
  try {
    const r = await chamar<{ url?: string; jaAtiva?: boolean }>("checkout", { paroquiaId });
    if (r.jaAtiva) {
      window.location.href = "/dashboard";
      return;
    }
    if (r.url) {
      window.location.href = r.url;
      return;
    }
    setErro("Não foi possível abrir o pagamento.");
  } catch (e) {
    setErro(e instanceof Error ? e.message : "Não foi possível abrir o pagamento.");
  } finally {
    setCarregando(false);
  }
}

function FormularioCadastro() {
  const params = useSearchParams();
  const paroquiaIdRetomar = params.get("paroquiaId");
  const cancelado = params.get("cancelado") === "1";

  const [erro, setErro] = useState<string | null>(cancelado ? "Pagamento cancelado. Tente novamente quando quiser." : null);
  const [carregando, setCarregando] = useState(false);

  async function cadastrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCarregando(true);
    setErro(null);
    const form = new FormData(e.currentTarget);
    try {
      const { paroquiaId } = await chamar<{ paroquiaId: number }>("instituicoes", {
        nomeInstituicao: form.get("nomeInstituicao"),
        tipo: form.get("tipo"),
        nomeResponsavel: form.get("nomeResponsavel"),
        senha: form.get("senha"),
        contatoEmail: form.get("contatoEmail"),
      });
      await irParaCheckout(paroquiaId, setErro, setCarregando);
    } catch (e) {
      setCarregando(false);
      setErro(e instanceof Error ? e.message : "Não foi possível cadastrar.");
    }
  }

  if (paroquiaIdRetomar) {
    return (
      <div className="grid gap-4">
        <p className="text-sm text-parchment/70">
          Seu cadastro já existe — falta só confirmar o pagamento pra liberar o acesso.
        </p>
        {erro && <p className="text-sm text-ember-soft">{erro}</p>}
        <button
          onClick={() => irParaCheckout(Number(paroquiaIdRetomar), setErro, setCarregando)}
          disabled={carregando}
          className={buttonClasses("primary")}
        >
          {carregando ? "Abrindo pagamento…" : "Ir para o pagamento"}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={cadastrar} className="grid gap-4">
      <label className="grid gap-1.5 text-sm text-parchment/70">
        Nome da instituição
        <input
          name="nomeInstituicao"
          required
          placeholder="Paróquia Sant'Ana"
          className="rounded-md border border-white/15 bg-white/5 px-3.5 py-2.5 text-parchment outline-none focus:border-candle"
        />
      </label>
      <label className="grid gap-1.5 text-sm text-parchment/70">
        Tipo
        <select
          name="tipo"
          defaultValue="paroquia"
          className="rounded-md border border-white/15 bg-white/5 px-3.5 py-2.5 text-parchment outline-none focus:border-candle"
        >
          <option value="paroquia" className="bg-vesper">Paróquia</option>
          <option value="escola" className="bg-vesper">Colégio católico</option>
          <option value="outro" className="bg-vesper">Outro</option>
        </select>
      </label>
      <label className="grid gap-1.5 text-sm text-parchment/70">
        Seu nome
        <input
          name="nomeResponsavel"
          required
          className="rounded-md border border-white/15 bg-white/5 px-3.5 py-2.5 text-parchment outline-none focus:border-candle"
        />
      </label>
      <label className="grid gap-1.5 text-sm text-parchment/70">
        E-mail de contato
        <input
          name="contatoEmail"
          type="email"
          className="rounded-md border border-white/15 bg-white/5 px-3.5 py-2.5 text-parchment outline-none focus:border-candle"
        />
      </label>
      <label className="grid gap-1.5 text-sm text-parchment/70">
        Crie uma senha
        <input
          name="senha"
          type="password"
          required
          minLength={4}
          className="rounded-md border border-white/15 bg-white/5 px-3.5 py-2.5 text-parchment outline-none focus:border-candle"
        />
      </label>
      {erro && <p className="text-sm text-ember-soft">{erro}</p>}
      <button type="submit" disabled={carregando} className={buttonClasses("primary", "mt-2")}>
        {carregando ? "Continuando…" : "Continuar para o pagamento"}
      </button>
      <p className="text-xs text-parchment/40">
        O acesso libera assim que a assinatura for confirmada no próximo passo.
      </p>
    </form>
  );
}

export default function CadastroPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-vesper px-6 py-12">
      <div className="w-full max-w-sm">
        <a href="/" className="font-display text-xl italic text-parchment">
          Paroquiano
        </a>
        <h1 className="mt-6 font-display text-2xl text-parchment">Cadastrar instituição</h1>
        <p className="mt-1.5 text-sm text-parchment/60">
          Pra igrejas e colégios católicos ainda não cadastrados.
        </p>
        <div className="mt-8">
          <Suspense fallback={null}>
            <FormularioCadastro />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
