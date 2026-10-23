import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Findly — discover the value in everything",
  description: "AI object scanner, resale research and your personal collection.",
  applicationName: "Findly",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Findly" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0D0F12",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body><Script src="https://telegram.org/js/telegram-web-app.js?63" strategy="beforeInteractive" />{children}</body></html>;
}
