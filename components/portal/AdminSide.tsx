"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const GROUPS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Operations",
    links: [
      { href: "/admin", label: "Overview" },
      { href: "/admin/orders", label: "Orders" },
      { href: "/counter", label: "Counter portal" },
      { href: "/counter/customers", label: "Customers" },
      { href: "/kitchen", label: "Kitchen portal" },
      { href: "/delivery", label: "Delivery portal" },
    ],
  },
  {
    title: "Catalogue",
    links: [
      { href: "/admin/menu", label: "Menu & dishes" },
      { href: "/admin/reviews", label: "Reviews" },
      { href: "/admin/whats-new", label: "What's new" },
    ],
  },
  {
    title: "Manufacturing",
    links: [
      { href: "/admin/production", label: "Production & costing" },
    ],
  },
  {
    title: "Commercial",
    links: [
      { href: "/admin/pricing", label: "Pricing & holidays" },
      { href: "/admin/delivery", label: "Delivery & payments" },
      { href: "/admin/tables", label: "Tables & QR codes" },
      { href: "/admin/staff", label: "Users & access" },
    ],
  },
];

export function AdminSide() {
  const pathname = usePathname() ?? "";
  return (
    <aside className="admin-side">
      {GROUPS.map((group) => (
        <div key={group.title}>
          <div className="group">{group.title}</div>
          {group.links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              data-active={pathname === link.href || (link.href !== "/admin" && pathname.startsWith(link.href + "/")) ? "true" : "false"}
            >
              {link.label}
            </Link>
          ))}
        </div>
      ))}
    </aside>
  );
}
