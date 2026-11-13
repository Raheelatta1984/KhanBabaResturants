"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useCart } from "./CartProvider";
import { Icon } from "./Icon";

const LINKS = [
  { href: "/menu", label: "Menu" },
  { href: "/whats-new", label: "What's new" },
  { href: "/#story", label: "Our story" },
  { href: "/#visit", label: "Find us" },
  { href: "/table/T04", label: "Table ordering" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { count, hydrated } = useCart();
  const [open, setOpen] = useState(false);

  return (
    <header className="site-header">
      <div className="container site-header-inner">
        <Link href="/" className="brand" aria-label="Khan Baba Restaurant home">
          <span className="brand-mark">KB</span>
          <span className="brand-text">
            <b>Khan Baba</b>
            <span>Pakistani kitchen · Sydney</span>
          </span>
        </Link>

        <nav className="nav">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              data-active={pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href.split("#")[0]) && link.href !== "/table/T04") ? "true" : "false"}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="header-actions">
          <Link href="/checkout" className="cart-pill" aria-label="View cart">
            <Icon name="cart" size={16} />
            <span className="label">Cart</span>
            {hydrated && count > 0 ? <span className="count">{count}</span> : null}
          </Link>
          <Link href="/menu" className="btn btn-primary btn-sm">
            Order now
          </Link>
          <button
            type="button"
            className="btn btn-ghost btn-icon mobile-only"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <Icon name={open ? "close" : "menu"} />
          </button>
        </div>
      </div>

      {open ? (
        <div className="container" style={{ paddingBottom: 18 }}>
          <nav style={{ display: "grid", gap: 4 }}>
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                style={{ padding: "10px 4px", borderBottom: "1px solid var(--line)", color: "var(--muted)" }}
              >
                {link.label}
              </Link>
            ))}
            <Link href="/staff/login" onClick={() => setOpen(false)} style={{ padding: "10px 4px", color: "var(--muted-2)", fontSize: "0.82rem" }}>
              Staff sign in
            </Link>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
