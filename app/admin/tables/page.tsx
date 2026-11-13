import QRCode from "qrcode";
import { getDb } from "@/lib/db";
import { getBaseUrl } from "@/lib/url";
import { TableManager } from "@/components/portal/AdminForms";

export const dynamic = "force-dynamic";

export default async function TablesPage() {
  const db = await getDb();
  const baseUrl = await getBaseUrl();
  const rows = await db.query<{
    id: number;
    code: string;
    name: string;
    zone: string | null;
    seats: number;
    active: boolean;
  }>("SELECT * FROM dining_tables ORDER BY code");

  const tables = await Promise.all(
    rows.map(async (row) => ({
      ...row,
      qrSvg: await QRCode.toString(`${baseUrl}/table/${row.code}`, {
        type: "svg",
        margin: 1,
        width: 150,
        color: { dark: "#0a0908", light: "#ffffff" },
      }),
    })),
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tables &amp; QR codes</h1>
          <p>
            Print a QR for each table. Guests scan it, order from their phone
            and track preparation live — no app, no third-party platform.
          </p>
        </div>
        <span className="badge badge-amber">{tables.length} tables</span>
      </div>

      <TableManager tables={tables} baseUrl={baseUrl} />
    </>
  );
}
