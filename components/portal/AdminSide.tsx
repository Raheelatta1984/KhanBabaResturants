"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { activeHref, sidebarNav } from "@/lib/nav";
import { Icon } from "../Icon";

/**
 * The admin sidebar.
 *
 * Every link is a block on its own line. That sounds too obvious to write
 * down, but it was the fault: the stylesheet laid the sidebar out as a grid of
 * links while the markup wrapped each group in a <div>, so the links were
 * inline text and the whole menu rendered as one run-on paragraph — "Command
 * centre Overview Operational log Orders Counter portal…" — with labels broken
 * across lines. "Marketing & social" was in there; it could not be found.
 *
 * On a phone the list sits behind one clearly labelled button, because 28
 * links above every page is worse than one tap. The Command centre carries the
 * same links as large tiles.
 */
export function AdminSide({ build }: { build?: string }) {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const groups = sidebarNav();
  const links = groups.flatMap((group) => group.links);
  const current = activeHref(
    pathname,
    links.map((link) => link.href),
  );
  const currentLabel = links.find((link) => link.href === current)?.label ?? "Admin";

  // Choosing a page closes the menu, so the page itself is what you see next.
  // The effect covers the browser's back button; the links close it themselves,
  // because a link to a section of the page you are on changes no pathname.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <aside className="admin-side" data-open={open ? "true" : "false"} aria-label="Admin navigation">
      <button
        type="button"
        className="admin-side-toggle"
        aria-expanded={open}
        aria-controls="admin-side-groups"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={open ? "close" : "menu"} size={16} />
        <span>
          <b>Admin menu</b>
          <small>
            {currentLabel} · {links.length} pages
          </small>
        </span>
        <Icon name="chevron" size={14} className="admin-side-chevron" />
      </button>

      <div className="admin-side-groups" id="admin-side-groups">
        {groups.map((group) => (
          <nav key={group.id} aria-label={group.title} data-group={group.id}>
            <div className="group">{group.title}</div>
            {group.links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                data-active={link.href === current ? "true" : "false"}
                aria-current={link.href === current ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        ))}
        {build ? (
          <div className="admin-side-foot" title="The build that is serving this page">
            {build}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
