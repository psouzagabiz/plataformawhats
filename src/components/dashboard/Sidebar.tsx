"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

// Fase 0/2: só as telas que já existem de verdade no painel novo. Itens novos
// (dízimos, paroquianos, campanhas, mensagens automáticas...) entram aqui à
// medida que cada fase do plano de mesclagem for implementada.
const ITENS = [{ href: "/dashboard", label: "Visão geral" }];

export function Sidebar({ superAdmin }: { superAdmin: boolean }) {
  const pathname = usePathname();
  const itens = superAdmin ? [...ITENS, { href: "/dashboard/matriz", label: "Painel matriz" }] : ITENS;
  return (
    <aside className="hidden w-56 shrink-0 border-r border-parchment-line bg-parchment-card md:block">
      <div className="px-6 py-6">
        <span className="font-display text-lg italic text-vesper">Paroquiano</span>
      </div>
      <nav className="flex flex-col gap-0.5 px-3">
        {itens.map((item) => {
          const ativo = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "rounded-md px-3.5 py-2.5 text-sm transition-colors",
                ativo
                  ? "bg-vesper text-parchment"
                  : "text-ink-soft hover:bg-parchment hover:text-ink"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-3 pt-4">
        <a
          href="/painel-antigo"
          className="block rounded-md px-3.5 py-2.5 text-xs text-ink-faint hover:bg-parchment hover:text-ink-soft"
        >
          Abrir painel antigo
        </a>
      </div>
    </aside>
  );
}
