"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const TENTATIVAS_MAX = 15; // ~30s de polling — o webhook do Stripe costuma chegar em segundos

function Confirmando() {
  const router = useRouter();
  const params = useSearchParams();
  const paroquiaId = params.get("paroquiaId");
  const [tentativas, setTentativas] = useState(0);
  const [expirou, setExpirou] = useState(false);

  useEffect(() => {
    if (expirou) return;
    const t = setTimeout(async () => {
      const res = await fetch("/api/principal?rota=eu");
      if (res.ok) {
        router.push("/dashboard");
        return;
      }
      if (tentativas + 1 >= TENTATIVAS_MAX) {
        setExpirou(true);
        return;
      }
      setTentativas((n) => n + 1);
    }, 2000);
    return () => clearTimeout(t);
  }, [tentativas, expirou, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-vesper px-6 text-center">
      <div className="max-w-sm">
        {!expirou ? (
          <>
            <p className="font-display text-xl italic text-parchment">Confirmando pagamento…</p>
            <p className="mt-3 text-sm text-parchment/60">
              Assim que o Stripe confirmar a assinatura, você entra automaticamente.
            </p>
          </>
        ) : (
          <>
            <p className="font-display text-xl italic text-parchment">Ainda confirmando</p>
            <p className="mt-3 text-sm text-parchment/60">
              O pagamento pode ter sido concluído, mas a confirmação está demorando mais que
              o normal. Atualize esta página em instantes, ou tente o pagamento de novo.
            </p>
            <div className="mt-5 flex justify-center gap-4 text-sm">
              <button onClick={() => window.location.reload()} className="text-candle-dim underline">
                Atualizar
              </button>
              {paroquiaId && (
                <a href={`/cadastro?paroquiaId=${paroquiaId}`} className="text-candle-dim underline">
                  Tentar pagamento de novo
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

export default function ConfirmandoPage() {
  return (
    <Suspense fallback={null}>
      <Confirmando />
    </Suspense>
  );
}
