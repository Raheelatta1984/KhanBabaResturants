import { requireRole } from "@/lib/auth/guard";
import { StaffChat } from "@/components/StaffChat";
export const dynamic = "force-dynamic";
export default async function ChatArchive() { await requireRole(["admin"]); return <StaffChat archive />; }
