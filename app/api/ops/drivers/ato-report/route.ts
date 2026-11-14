import { NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth/api";
import { getDb } from "@/lib/db";
import { atoReportCsv, driverAtoReport, financialYear } from "@/lib/drivers";

export const dynamic = "force-dynamic";

/**
 * Downloadable ATO kilometre claim report (CSV) for one driver and financial
 * year. Includes every trip, the rate used, the 5,000 km cap and the total.
 */
export async function GET(request: Request) {
  const session = await getApiSession(["admin", "manager", "delivery"]);
  if (!session)
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  const url = new URL(request.url);
  const driverId = Number(url.searchParams.get("driver") ?? 0);
  const fy = url.searchParams.get("fy") || financialYear();
  if (!driverId)
    return NextResponse.json({ error: "Choose a driver" }, { status: 400 });
  const db = await getDb();
  const report = await driverAtoReport(db, driverId, fy);
  const csv = atoReportCsv(report);
  const filename = `ato-km-${report.driver.code}-${fy}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
