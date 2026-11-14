import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/guard";
import { homeForRole, ROLE_LABELS } from "@/lib/auth/core";
import { ChangePasswordForm } from "@/components/portal/UserAdmin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Change your password",
  robots: { index: false },
};

export default async function StaffPasswordPage() {
  const session = await requireStaff();
  const home = homeForRole(session.role);

  return (
    <div className="login-page">
      <div className="login-card">
        <Link href={home} className="brand" style={{ marginBottom: 18 }}>
          <span className="brand-mark">KB</span>
          <span className="brand-text">
            <b>Khan Baba</b>
            <span>Operations</span>
          </span>
        </Link>
        <h1>Change your password</h1>
        <p className="small muted">
          Signed in as {session.email} · {ROLE_LABELS[session.role]}
        </p>
        <div style={{ marginTop: 22 }}>
          <ChangePasswordForm homePath={home} />
        </div>
        <div style={{ marginTop: 18, textAlign: "center" }}>
          <Link href={home} className="tiny" style={{ color: "var(--muted-2)" }}>
            ← Back without changing it
          </Link>
        </div>
      </div>
    </div>
  );
}
