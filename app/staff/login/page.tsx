import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, homeForRole } from "@/lib/auth/session";
import { LoginForm } from "@/components/portal/LoginForm";
import { getDb } from "@/lib/db";
import { demoLoginsEnabled } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Staff sign in",
  robots: { index: false },
};

export default async function StaffLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; denied?: string }>;
}) {
  const session = await getSession();
  const query = await searchParams;
  if (session && !query.next) redirect(homeForRole(session.role));

  // Demo logins are advertised only until an administrator retires them. If
  // the database cannot be asked, say nothing rather than print a password.
  let demo = false;
  try {
    demo = await demoLoginsEnabled(await getDb());
  } catch {
    demo = false;
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <Link href="/" className="brand" style={{ marginBottom: 18 }}>
          <span className="brand-mark">KB</span>
          <span className="brand-text">
            <b>Khan Baba</b>
            <span>Operations</span>
          </span>
        </Link>
        <h1>Staff sign in</h1>
        <p className="small muted">
          One login for the counter, kitchen, delivery coordination and admin.
        </p>
        {query.denied ? (
          <div className="notice notice-red" style={{ marginTop: 16 }}>
            Your account does not have access to that portal. Sign in with the right role.
          </div>
        ) : null}
        <div style={{ marginTop: 22 }}>
          <LoginForm nextPath={query.next} demo={demo} />
        </div>
        <div style={{ marginTop: 18, textAlign: "center" }}>
          <Link href="/" className="tiny" style={{ color: "var(--muted-2)" }}>
            ← Back to khanbabarestaurant.com.au
          </Link>
        </div>
      </div>
    </div>
  );
}
