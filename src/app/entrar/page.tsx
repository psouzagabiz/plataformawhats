"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { buttonClasses } from "@/components/ui/Button";

type Instituicao = { id: number; nome: string; cidade: string | null };
type Atendente = { id: number; nome: string; setor: string };

async function chamar<T>(rota: string, opts: RequestInit & { query?: Record<string, string> } = {}) {
  const params = new URLSearchParams({ rota, ...(opts.query ?? {}) });
  const res = await fetch(`/api/principal?${params.toString()}`, {
    method: opts.method ?? "GET",
    headers: opts.body ? { "content-type": "application/json" } : undefined,
    body: opts.body,
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(dados?.erro ?? "Erro inesperado.");
  return dados as T;
}

function FormularioEntrar() {
  const router = useRouter();
  const params = useSearchParams();

  const [busca, setBusca] = useState("");
  const [instituicoes, setInstituicoes] = useState<Instituicao[]>([]);
  const [instituicao, setInstituicao] = useState<Instituicao | null>(null);
  const [atendentes, setAtendentes] = useState<Atendente[]>([]);
  const [atendenteId, setAtendenteId] = useState<number | null>(null);
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (instituicao || busca.trim().length < 2) {
      setInstituicoes([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setInstituicoes(await chamar<Instituicao[]>("instituicoes", { query: { busca } }));
      } catch {
        setInstituicoes([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [busca, instituicao]);

  async function escolherInstituicao(i: Instituicao) {
    setInstituicao(i);
    setInstituicoes([]);
    setErro(null);
    try {
      setAtendentes(await chamar<Atendente[]>("atendentes", { query: { paroquiaId: String(i.id) } }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao buscar a equipe.");
    }
  }

  async function entrar(e: FormEvent) {
    e.preventDefault();
    if (!atendenteId) return;
    setCarregando(true);
    setErro(null);
    try {
      await chamar("entrar", { method: "POST", body: JSON.stringify({ atendenteId, senha }) });
      router.push(params.get("callbackUrl") ?? "/dashboard");
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível entrar.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <>
        {!instituicao ? (
          <div className="mt-8 grid gap-2">
            <label className="grid gap-1.5 text-sm text-parchment/70">
              Sua instituição
              <input
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Nome da paróquia ou escola"
                className="rounded-md border border-white/15 bg-white/5 px-3.5 py-2.5 text-parchment outline-none focus:border-candle"
              />
            </label>
            {instituicoes.length > 0 && (
              <ul className="overflow-hidden rounded-md border border-white/10">
                {instituicoes.map((i) => (
                  <li key={i.id}>
                    <button
                      type="button"
                      onClick={() => escolherInstituicao(i)}
                      className="block w-full px-3.5 py-2.5 text-left text-sm text-parchment hover:bg-white/10"
                    >
                      {i.nome}
                      {i.cidade ? <span className="text-parchment/50"> · {i.cidade}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <form onSubmit={entrar} className="mt-8 grid gap-4">
            <button
              type="button"
              onClick={() => {
                setInstituicao(null);
                setAtendenteId(null);
                setAtendentes([]);
              }}
              className="justify-self-start text-xs text-parchment/50 hover:text-parchment"
            >
              ← {instituicao.nome}
            </button>
            <label className="grid gap-1.5 text-sm text-parchment/70">
              Quem é você
              <select
                required
                value={atendenteId ?? ""}
                onChange={(e) => setAtendenteId(Number(e.target.value) || null)}
                className="rounded-md border border-white/15 bg-white/5 px-3.5 py-2.5 text-parchment outline-none focus:border-candle"
              >
                <option value="" disabled>
                  Selecione
                </option>
                {atendentes.map((a) => (
                  <option key={a.id} value={a.id} className="bg-vesper">
                    {a.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm text-parchment/70">
              Senha
              <input
                type="password"
                required
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className="rounded-md border border-white/15 bg-white/5 px-3.5 py-2.5 text-parchment outline-none focus:border-candle"
              />
            </label>
            {erro && <p className="text-sm text-ember-soft">{erro}</p>}
            <button type="submit" disabled={carregando || !atendenteId} className={buttonClasses("primary", "mt-2")}>
              {carregando ? "Entrando…" : "Entrar"}
            </button>
          </form>
        )}
    </>
  );
}

export default function EntrarPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-vesper px-6">
      <div className="w-full max-w-sm">
        <span className="font-display text-xl italic text-parchment">Paroquiano</span>
        <h1 className="mt-6 font-display text-2xl text-parchment">Entrar no painel</h1>
        <p className="mt-1.5 text-sm text-parchment/60">Acesso restrito à equipe da instituição.</p>
        <div className="mt-8">
          <Suspense fallback={null}>
            <FormularioEntrar />
          </Suspense>
        </div>
        <p className="mt-6 text-center text-xs text-parchment/40">
          Sua instituição ainda não está cadastrada?{" "}
          <a href="/cadastro" className="text-candle-dim underline">
            Cadastre-se
          </a>
        </p>
      </div>
    </main>
  );
}
