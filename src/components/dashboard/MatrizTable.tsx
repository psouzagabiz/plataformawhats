"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";

export type Instituicao = {
  id: number;
  nome: string;
  tipo: string;
  status: "ativa" | "pendente" | "suspensa" | string;
  criadoEm: string;
  totalAtendentes: number;
  conversasAtivas: number;
  statusAssinatura: string | null;
  periodoFimAssinatura: string | null;
};

const BADGE_STATUS: Record<string, string> = {
  ativa: "bg-emerald-100 text-emerald-700",
  pendente: "bg-candle/15 text-candle-dim",
  suspensa: "bg-ember/15 text-ember",
};

export function MatrizTable({ instituicoes }: { instituicoes: Instituicao[] }) {
  const router = useRouter();
  const [carregandoId, setCarregandoId] = useState<number | null>(null);

  async function alternar(id: number, acao: "suspender" | "reativar") {
    setCarregandoId(id);
    await fetch(`/api/principal?rota=matriz/instituicoes/${acao}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setCarregandoId(null);
    router.refresh();
  }

  return (
    <div className="overflow-hidden rounded-lg border border-parchment-line bg-parchment-card shadow-card">
      <table className="w-full text-sm">
        <thead className="border-b border-parchment-line text-left text-xs text-ink-faint">
          <tr>
            <th className="px-4 py-3 font-medium">Instituição</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Assinatura</th>
            <th className="px-4 py-3 font-medium">Equipe</th>
            <th className="px-4 py-3 font-medium">Conversas ativas</th>
            <th className="px-4 py-3 font-medium">Ação</th>
          </tr>
        </thead>
        <tbody>
          {instituicoes.map((i) => (
            <tr key={i.id} className="border-b border-parchment-line last:border-0">
              <td className="px-4 py-3">
                <p className="text-ink">{i.nome}</p>
                <p className="text-xs text-ink-faint">{i.tipo}</p>
              </td>
              <td className="px-4 py-3">
                <span
                  className={clsx(
                    "rounded-full px-2.5 py-0.5 text-xs font-medium",
                    BADGE_STATUS[i.status] ?? "bg-parchment text-ink-faint"
                  )}
                >
                  {i.status}
                </span>
              </td>
              <td className="px-4 py-3 text-ink-soft">
                {i.statusAssinatura ?? "—"}
                {i.periodoFimAssinatura && (
                  <span className="block text-xs text-ink-faint">
                    até {new Date(i.periodoFimAssinatura).toLocaleDateString("pt-BR")}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-ink-soft tabular">{i.totalAtendentes}</td>
              <td className="px-4 py-3 text-ink-soft tabular">{i.conversasAtivas}</td>
              <td className="px-4 py-3">
                {i.status === "suspensa" ? (
                  <button
                    onClick={() => alternar(i.id, "reativar")}
                    disabled={carregandoId === i.id}
                    className="rounded-md border border-parchment-line px-3 py-1.5 text-xs text-ink hover:bg-parchment disabled:opacity-50"
                  >
                    Reativar
                  </button>
                ) : (
                  <button
                    onClick={() => alternar(i.id, "suspender")}
                    disabled={carregandoId === i.id}
                    className="rounded-md border border-parchment-line px-3 py-1.5 text-xs text-ember hover:bg-parchment disabled:opacity-50"
                    title={
                      i.status === "pendente"
                        ? "Ativa manualmente sem esperar o Stripe (ex: pagamento combinado por fora)"
                        : "Suspende o acesso da instituição"
                    }
                  >
                    {i.status === "pendente" ? "Suspender" : "Suspender"}
                  </button>
                )}
                {i.status === "pendente" && (
                  <button
                    onClick={() => alternar(i.id, "reativar")}
                    disabled={carregandoId === i.id}
                    className="ml-2 rounded-md border border-parchment-line px-3 py-1.5 text-xs text-ink hover:bg-parchment disabled:opacity-50"
                    title="Ativa manualmente sem esperar o Stripe (ex: pagamento combinado por fora)"
                  >
                    Ativar manualmente
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
