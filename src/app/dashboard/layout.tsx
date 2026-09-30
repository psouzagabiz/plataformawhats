import { redirect } from "next/navigation";
import { apiServer, ApiError } from "@/lib/api";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { Topbar } from "@/components/dashboard/Topbar";

type Eu = { nome: string; setor: string; roboOnline: boolean; superAdmin: boolean };

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let eu: Eu;
  try {
    eu = await apiServer<Eu>("eu");
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect("/entrar");
    throw e;
  }

  return (
    <div className="flex min-h-screen bg-parchment">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar nome={eu.nome} setor={eu.setor} roboOnline={eu.roboOnline} superAdmin={eu.superAdmin} />
        <main className="flex-1 px-6 py-8 md:px-10">{children}</main>
      </div>
    </div>
  );
}
