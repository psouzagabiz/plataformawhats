import { NextRequest, NextResponse } from "next/server";

// Checagem barata (Edge, sem acesso ao Postgres): só confirma que o cookie de
// sessão existe. A validação de verdade (token válido, instituição ativa) roda
// em cada chamada a /api/principal (atendenteLogado, api/principal.js) — quem
// faz esse gate por página é o próprio dashboard/layout.tsx, chamando rota=eu.
export function middleware(req: NextRequest) {
  const temSessao = Boolean(req.cookies.get("sessao"));
  if (!temSessao) {
    const url = new URL("/entrar", req.url);
    url.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
