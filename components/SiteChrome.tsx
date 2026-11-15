"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { CustomerSession } from "@/lib/auth/customer";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import { MusicPlayer } from "./MusicPlayer";
import { CulturalTheme } from "./CulturalTheme";

const PORTAL_PREFIXES = ["/staff", "/admin", "/counter", "/kitchen", "/delivery"];

export function SiteChrome({
  children,
  restaurant,
  customer,
  build,
}: {
  children: ReactNode;
  restaurant: { name: string; address: string; phone: string; email: string; hours: string };
  /** Signed-in customer, read from the cookie — never a database call. */
  customer?: CustomerSession | null;
  /** "v3.7.0+abc1234" — printed in the footer so anyone can tell which build is live. */
  build?: string;
}) {
  const pathname = usePathname() ?? "/";
  const isPortal = PORTAL_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"));

  if (isPortal) return <>{children}</>;

  return (
    <CulturalTheme name={restaurant.name}>
      <SiteHeader customer={customer} />
      <main id="main">{children}</main>
      <SiteFooter restaurant={restaurant} build={build} />
      <MusicPlayer />
    </CulturalTheme>
  );
}
