import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default function Home() {
  const temSessao = Boolean(cookies().get("sessao"));
  redirect(temSessao ? "/dashboard" : "/entrar");
}
