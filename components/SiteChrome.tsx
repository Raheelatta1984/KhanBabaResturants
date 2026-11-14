"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { CustomerSession } from "@/lib/auth/customer";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import { MusicPlayer } from "./MusicPlayer";

const PORTAL_PREFIXES = ["/staff", "/admin", "/counter", "/kitchen", "/delivery"];

export function SiteChrome({
  children,
  restaurant,
  customer,
}: {
  children: ReactNode;
  restaurant: { name: string; address: string; phone: string; email: string; hours: string };
  /** Signed-in customer, read from the cookie — never a database call. */
  customer?: CustomerSession | null;
}) {
  const pathname = usePathname() ?? "/";
  const isPortal = PORTAL_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"));

  if (isPortal) return <>{children}</>;

  return (
    <>
      <SiteHeader customer={customer} />
      <main id="main">{children}</main>
      <SiteFooter restaurant={restaurant} />
      <MusicPlayer />
    </>
  );
}
