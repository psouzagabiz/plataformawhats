import { cookies, headers } from "next/headers";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function baseUrl() {
  const h = headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host");
  return `${proto}://${host}`;
}

/** Chama /api/principal a partir de um Server Component, repassando o cookie de sessão. */
export async function apiServer<T = unknown>(
  rota: string,
  opts: { method?: string; body?: unknown; query?: Record<string, string> } = {}
): Promise<T> {
  const params = new URLSearchParams({ rota, ...opts.query });
  const res = await fetch(`${baseUrl()}/api/principal?${params.toString()}`, {
    method: opts.method ?? "GET",
    headers: {
      cookie: cookies().toString(),
      ...(opts.body ? { "content-type": "application/json" } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, dados?.erro ?? "Erro ao carregar dados.");
  return dados as T;
}
