"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";

const PORTAL_PREFIXES = ["/staff", "/admin", "/counter", "/kitchen", "/delivery"];

export function SiteChrome({
  children,
  restaurant,
}: {
  children: ReactNode;
  restaurant: { name: string; address: string; phone: string; email: string; hours: string };
}) {
  const pathname = usePathname() ?? "/";
  const isPortal = PORTAL_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"));

  if (isPortal) return <>{children}</>;

  return (
    <>
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter restaurant={restaurant} />
    </>
  );
}
