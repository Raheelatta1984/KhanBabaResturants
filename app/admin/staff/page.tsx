import { requireRole } from "@/lib/auth/guard";
import { getDb } from "@/lib/db";
import { demoStatus } from "@/lib/auth/users";
import {
  CustomerManager,
  GoLivePanel,
  StaffManager,
  type CustomerAdminRow,
  type StaffRow,
} from "@/components/portal/UserAdmin";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const session = await requireRole(["admin", "manager"]);
  const db = await getDb();
  const staff = await db.query<StaffRow>(
    `SELECT id, name, email, role, active, created_at FROM staff
     ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, role, name`,
  );
  const customers = await db.query<CustomerAdminRow>(
    `SELECT c.id, c.name, c.email, c.phone, c.guest, c.active, c.created_at,
            (c.password_hash IS NOT NULL) AS has_password,
            (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS orders
     FROM customers c
     ORDER BY c.created_at DESC
     LIMIT 200`,
  );
  const demo = await demoStatus(db);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Users &amp; access</h1>
          <p>
            Create logins, choose what each person can open, reset a forgotten
            password and switch an account off. Changes apply on the person’s
            next click — a disabled account or a reset password signs them out
            straight away.
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gap: 18 }}>
        <GoLivePanel
          enabled={demo.enabled}
          selfOnDemo={demo.staffIds.includes(session.id)}
          staffOnDemo={staff
            .filter(
              (member) =>
                member.active &&
                member.id !== session.id &&
                demo.staffIds.includes(member.id),
            )
            .map((member) => member.name)}
          demoCustomers={demo.customers}
          isAdmin={session.role === "admin"}
        />

        <StaffManager
          staff={staff}
          currentId={session.id}
          currentRole={session.role}
          demoIds={demo.staffIds}
        />

        <section>
          <div className="panel-head">
            <h3>Customer logins</h3>
            <span className="tiny muted">
              {customers.length === 200 ? "Latest 200" : `${customers.length} total`}
            </span>
          </div>
          <CustomerManager customers={customers} />
        </section>
      </div>

      <div className="notice" style={{ marginTop: 18 }}>
        Passwords are stored as scrypt hashes and cannot be read back, only
        replaced. Staff sessions are signed, HTTP-only cookies valid for 12
        hours.
      </div>
    </>
  );
}
