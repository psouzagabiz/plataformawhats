import { redirect } from "next/navigation";
import { apiServer, ApiError } from "@/lib/api";
import { MatrizTable, type Instituicao } from "@/components/dashboard/MatrizTable";

export default async function MatrizPage() {
  let instituicoes: Instituicao[];
  try {
    instituicoes = await apiServer<Instituicao[]>("matriz/instituicoes");
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 401)) redirect("/dashboard");
    throw e;
  }

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="font-display text-2xl text-ink">Painel matriz</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Todas as igrejas e colégios cadastrados na plataforma, com o status da
          assinatura. Instituições em &ldquo;pendente&rdquo; ainda não confirmaram o
          pagamento pelo Stripe — não conseguem entrar até isso acontecer.
        </p>
      </div>
      <MatrizTable instituicoes={instituicoes} />
    </div>
  );
}
