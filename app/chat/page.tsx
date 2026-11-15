import { GuestChat } from "@/components/GuestChat";
import { BRAND_SETTINGS } from "@/lib/settings";
export default function ChatPage() { return <GuestChat phone={BRAND_SETTINGS.restaurant_phone} />; }
