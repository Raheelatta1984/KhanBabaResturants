import { requireRole } from "@/lib/auth/guard";
import { PortalNav } from "@/components/portal/PortalNav";
import { AdminSide } from "@/components/portal/AdminSide";
import { isEphemeralStorage } from "@/lib/db/paths";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole(["admin", "manager"]);
  const ephemeral = isEphemeralStorage();

  return (
    <div className="portal">
      <PortalNav name={session.name} role={session.role} />
      <main className="container portal-main">
        {ephemeral ? (
          <div className="notice" style={{ marginBottom: 18 }}>
            <span>
              <strong>Preview storage.</strong> This deployment has no persistent disk, so the database lives in a
              temporary directory — data resets when the function restarts. Set <code>KB_DATA_DIR</code> on a host with
              a persistent volume, or connect a managed Postgres database, before taking real orders.
            </span>
          </div>
        ) : null}
        <div className="admin-grid">
          <AdminSide />
          <div>{children}</div>
        </div>
      </main>
    </div>
  );
}
