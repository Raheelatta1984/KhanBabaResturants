"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { PORTAL_LINKS, ROLE_LABELS, type Role } from "@/lib/auth/core";
import { Icon } from "../Icon";

export function PortalNav({ name, role }: { name: string; role: Role }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const links = PORTAL_LINKS.filter((link) => link.roles.includes(role));

  async function signOut() {
    setSigningOut(true);
    await fetch("/api/staff/logout", { method: "POST" });
    router.push("/staff/login");
    router.refresh();
  }

  return (
    <header className="portal-topbar">
      <div className="container portal-topbar-inner">
        <Link href={links[0]?.href ?? "/admin"} className="brand" style={{ marginRight: 0 }}>
          <span className="brand-mark" style={{ width: 34, height: 34, fontSize: "0.95rem" }}>
            KB
          </span>
          <span className="brand-text">
            <b style={{ fontSize: "0.98rem" }}>Khan Baba Ops</b>
            <span>Live kitchen · delivery</span>
          </span>
        </Link>

        <nav className="portal-nav">
          {links.map((link) => (
            <Link key={link.href} href={link.href} data-active={pathname === link.href || pathname.startsWith(link.href + "/") ? "true" : "false"}>
              {link.label}
            </Link>
          ))}
        </nav>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ textAlign: "right", lineHeight: 1.2 }} className="tiny">
            <div className="strong">{name}</div>
            <div style={{ color: "var(--muted-2)" }}>{ROLE_LABELS[role]}</div>
          </div>
          <Link href="/" className="btn btn-ghost btn-sm" title="Open the customer website">
            <Icon name="eye" size={14} />
          </Link>
          <button type="button" className="btn btn-ghost btn-sm" onClick={signOut} disabled={signingOut} title="Sign out">
            <Icon name="logout" size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}
