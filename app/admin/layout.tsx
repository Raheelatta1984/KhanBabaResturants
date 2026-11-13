import { requireRole } from "@/lib/auth/guard";
import { PortalNav } from "@/components/portal/PortalNav";
import { AdminSide } from "@/components/portal/AdminSide";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole(["admin", "manager"]);
  return (
    <div className="portal">
      <PortalNav name={session.name} role={session.role} />
      <main className="container portal-main">
        <div className="admin-grid">
          <AdminSide />
          <div>{children}</div>
        </div>
      </main>
    </div>
  );
}
