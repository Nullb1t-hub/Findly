import type { Metadata, Viewport } from "next";
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
  themeColor: "#15161b",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
