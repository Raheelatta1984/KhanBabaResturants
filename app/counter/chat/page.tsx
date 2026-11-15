import { requireRole } from "@/lib/auth/guard";
import { PortalNav } from "@/components/portal/PortalNav";
import { StaffChat } from "@/components/StaffChat";
import { buildLabel } from "@/lib/build";
export const dynamic = "force-dynamic";
export default async function CounterChat() { const session = await requireRole(["admin", "manager", "counter"]); return <div className="portal"><PortalNav name={session.name} role={session.role} build={buildLabel()} /><main className="container portal-main"><StaffChat /></main></div>; }
