import Link from "next/link";
import { requireRole } from "@/lib/auth/guard";
import { PortalNav } from "@/components/portal/PortalNav";
import { AutoRefresh } from "@/components/portal/AutoRefresh";
import { MusicStudio } from "@/components/portal/MusicStudio";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export const metadata = { title: "Counter · Music" };

/**
 * The counter's music desk. The same shared player as the admin console, with
 * the library and schedule controls available — the brief asks front-of-house
 * to be able to stop, resume, replay and load songs without waiting for an
 * administrator.
 */
export default async function CounterMusicPage() {
  const session = await requireRole(["admin", "manager", "counter"]);

  return (
    <div className="portal">
      <PortalNav name={session.name} role={session.role} />
      <AutoRefresh intervalMs={12000} />
      <main className="container portal-main">
        <div className="page-head">
          <div>
            <h1>Music</h1>
            <p>
              The room’s Lahore soundtrack and every guest request. Stop, resume, replay or change
              the collection — the customer website and the in-room screen follow this player.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/counter" className="btn btn-outline btn-sm">
              <Icon name="arrow" size={14} /> Back to counter
            </Link>
            <Link href="/music" className="btn btn-ghost btn-sm">
              <Icon name="eye" size={14} /> Guest view
            </Link>
          </div>
        </div>

        <MusicStudio />
      </main>
    </div>
  );
}
