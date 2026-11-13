import { requireRole } from "@/lib/auth/guard";
import { PortalNav } from "@/components/portal/PortalNav";
import { AdminSide } from "@/components/portal/AdminSide";
import { describeDatabaseTarget } from "@/lib/db";
import { mediaConfig } from "@/lib/media";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireRole(["admin", "manager"]);
  const media = await mediaConfig();
  const onDiskOnly = media.driver === "local" && !media.durable;

  return (
    <div className="portal">
      <PortalNav name={session.name} role={session.role} />
      <main className="container portal-main">
        {onDiskOnly ? (
          <div className="notice" style={{ marginBottom: 18 }}>
            <span>
              <strong>Photos are stored on local disk.</strong> Orders, menu and
              staff live in Postgres and are durable, but this host has no
              persistent disk, so uploaded dish photos disappear when the
              instance restarts. Set <code>BLOB_READ_WRITE_TOKEN</code> (Vercel
              Blob) or <code>GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON</code> +{" "}
              <code>GOOGLE_DRIVE_FOLDER_ID</code> to store photography durably.
              Database: <code>{describeDatabaseTarget()}</code>.
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
