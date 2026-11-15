import type { Metadata } from "next";
import { GuestChat } from "@/components/GuestChat";
import { getCustomerSession } from "@/lib/auth/customer";
import { isAiChatConfigured } from "@/lib/chat/assistant";
import { BRAND_SETTINGS } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Chat",
  description:
    "Chat with Khan Baba's counter team or AI menu assistant, explore suggestions from your recent orders, and add today's dessert and drink of the day straight to your cart.",
};

export default async function ChatPage() {
  const customer = await getCustomerSession();
  return (
    <GuestChat
      phone={BRAND_SETTINGS.restaurant_phone}
      initialAiEnabled={isAiChatConfigured()}
      initialSignedIn={Boolean(customer)}
    />
  );
}
