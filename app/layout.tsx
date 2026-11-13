import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/fraunces";
import "./globals.css";
import { CartProvider } from "@/components/CartProvider";
import { SiteChrome } from "@/components/SiteChrome";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: {
    default: "Khan Baba Restaurant — Halal Pakistani food, delivered from Sydney",
    template: "%s · Khan Baba Restaurant",
  },
  description:
    "Order halal Pakistani food direct from Khan Baba in Sydney. Delivery with live courier quotes, click & collect, dine-in and table ordering with live preparation tracking.",
  metadataBase: new URL(process.env.PUBLIC_BASE_URL || "http://localhost:3000"),
  openGraph: {
    title: "Khan Baba Restaurant",
    description: "Pakistani cuisine — same taste from Lahore to Sydney. Order direct for delivery, pick-up or dine-in.",
    images: ["/images/feast.jpg"],
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0908",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const settings = getSettings();
  const restaurant = {
    name: settings.restaurant_name,
    address: settings.restaurant_address,
    phone: settings.restaurant_phone,
    email: settings.restaurant_email,
    hours: settings.restaurant_hours,
  };

  return (
    <html lang="en-AU">
      <body>
        <a href="#main" className="hidden" style={{ position: "absolute" }}>
          Skip to content
        </a>
        <CartProvider>
          <SiteChrome restaurant={restaurant}>{children}</SiteChrome>
        </CartProvider>
      </body>
    </html>
  );
}
