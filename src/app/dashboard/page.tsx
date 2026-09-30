export default function DashboardHome() {
  return (
    <div className="grid gap-2">
      <h1 className="font-display text-2xl text-ink">Visão geral</h1>
      <p className="max-w-prose text-sm text-ink-soft">
        Esta é a base do novo painel (Fase 0 da mesclagem): login e sessão já são os
        mesmos de produção. As telas de atendimento, agenda, dízimos, paroquianos,
        campanhas e mensagens automáticas entram nas próximas fases. Até lá, o dia a dia
        continua no{" "}
        <a href="/painel-antigo" className="text-candle-dim underline">
          painel antigo
        </a>
        .
      </p>
    </div>
  );
}
