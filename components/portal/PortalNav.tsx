"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { PORTAL_LINKS, ROLE_LABELS, type Role } from "@/lib/auth/core";
import { activeHref } from "@/lib/nav";
import { Icon } from "../Icon";

export function PortalNav({
  name,
  role,
  build,
}: {
  name: string;
  role: Role;
  /** "v3.7.0+abc1234" — which build is serving this screen. */
  build?: string;
}) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const links = PORTAL_LINKS.filter((link) => link.roles.includes(role));
  // The Khan Baba logo is the administrator's way home: the command centre with
  // every option on one page. Other roles go straight to their own queue.
  const homeHref =
    role === "admin" || role === "manager" ? "/admin/hub" : links[0]?.href ?? "/";
  // The most specific tab wins, so /admin/marketing lights Marketing, not Admin.
  const current = activeHref(
    pathname,
    links.map((link) => link.href),
  );

  async function signOut() {
    setSigningOut(true);
    await fetch("/api/staff/logout", { method: "POST" });
    router.push("/staff/login");
    router.refresh();
  }

  return (
    <header className="portal-topbar" data-crowded={links.length > 4 ? "true" : "false"}>
      <div className="container portal-topbar-inner">
        <Link href={homeHref} className="brand" style={{ marginRight: 0 }} title="Khan Baba command centre">
          <span className="brand-mark" style={{ width: 34, height: 34, fontSize: "0.95rem" }}>
            KB
          </span>
          <span className="brand-text">
            <b style={{ fontSize: "0.98rem" }}>Khan Baba Ops</b>
            <span>Live kitchen · delivery</span>
          </span>
        </Link>

        <nav className="portal-nav" aria-label="Staff portals">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              data-active={link.href === current ? "true" : "false"}
              aria-current={link.href === current ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="portal-user">
          <div className="portal-user-name tiny">
            <div className="strong">{name}</div>
            <div style={{ color: "var(--muted-2)" }}>
              {ROLE_LABELS[role]}
              {build ? (
                <span className="mono-text" title={`Build serving this screen: ${build}`}>
                  {" · "}
                  {build.split("+")[0]}
                </span>
              ) : null}
            </div>
          </div>
          <Link href="/" className="btn btn-ghost btn-sm" title="Open the customer website">
            <Icon name="eye" size={14} />
          </Link>
          <Link href="/staff/password" className="btn btn-ghost btn-sm" title="Change your password" aria-label="Change your password">
            <Icon name="shield" size={14} />
          </Link>
          <button type="button" className="btn btn-ghost btn-sm" onClick={signOut} disabled={signingOut} title="Sign out">
            <Icon name="logout" size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}
