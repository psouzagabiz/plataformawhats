"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function Topbar({
  nome,
  setor,
  roboOnline,
  superAdmin,
}: {
  nome: string;
  setor: string;
  roboOnline: boolean;
  superAdmin: boolean;
}) {
  const router = useRouter();
  const [saindo, setSaindo] = useState(false);

  async function sair() {
    setSaindo(true);
    await fetch("/api/principal?rota=sair", { method: "POST" });
    router.push("/entrar");
    router.refresh();
  }

  return (
    <header className="flex items-center justify-between border-b border-parchment-line bg-parchment-card px-6 py-4">
      <div>
        <p className="text-sm text-ink-faint">
          Bem-vinda, <span className="text-ink">{nome}</span>
          {superAdmin && (
            <span className="ml-2 rounded-full bg-candle/15 px-2 py-0.5 text-[0.65rem] font-medium text-candle-dim">
              super admin
            </span>
          )}
        </p>
        <p className="text-xs text-ink-faint">{setor}</p>
      </div>
      <div className="flex items-center gap-5">
        <span
          className="flex items-center gap-1.5 text-xs text-ink-faint"
          title={roboOnline ? "Robô do WhatsApp conectado" : "Robô do WhatsApp offline"}
        >
          <span className={`h-2 w-2 rounded-full ${roboOnline ? "bg-emerald-500" : "bg-ember"}`} />
          {roboOnline ? "Robô online" : "Robô offline"}
        </span>
        <button
          type="button"
          onClick={sair}
          disabled={saindo}
          className="rounded-md border border-parchment-line px-3.5 py-2 text-xs text-ink-soft hover:bg-parchment disabled:opacity-50"
        >
          {saindo ? "Saindo…" : "Sair"}
        </button>
      </div>
    </header>
  );
}
