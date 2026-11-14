import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  atoReportCsv,
  driverAtoReport,
  financialYear,
  verifyDriverToken,
} from "@/lib/drivers";

export const dynamic = "force-dynamic";

/** A driver downloads their own ATO cents-per-km history (capability link). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const identity = await verifyDriverToken(url.searchParams.get("token") ?? "");
  if (!identity)
    return NextResponse.json({ error: "Driver link expired" }, { status: 401 });
  const fy = url.searchParams.get("fy") || financialYear();
  const db = await getDb();
  const report = await driverAtoReport(db, identity.driverId, fy);
  return new NextResponse(atoReportCsv(report), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ato-km-${report.driver.code}-${fy}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
