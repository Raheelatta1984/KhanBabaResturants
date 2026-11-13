import { requireRole } from "@/lib/auth/guard";
import { getDb } from "@/lib/db";
import { StaffManager } from "@/components/portal/AdminForms";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const session = await requireRole(["admin", "manager"]);
  const db = await getDb();
  const staff = await db.query<{
    id: number;
    name: string;
    email: string;
    role: string;
    active: boolean;
    created_at: string;
  }>(
    "SELECT id, name, email, role, active, created_at FROM staff ORDER BY role, name",
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Staff &amp; access</h1>
          <p>
            Counter staff confirm orders, kitchen staff bump tickets, the
            delivery coordinator dispatches couriers. Administrators manage
            everything.
          </p>
        </div>
      </div>

      <StaffManager staff={staff} currentId={session.id} />

      <div className="notice" style={{ marginTop: 18 }}>
        Passwords are stored as scrypt hashes. Sessions are signed, HTTP-only
        cookies valid for 12 hours. Change
        <code style={{ margin: "0 4px" }}>SESSION_SECRET</code> in production to
        invalidate all sessions.
      </div>
    </>
  );
}
