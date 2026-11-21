import type { Metadata, Viewport } from "next";
import { AppNav } from "@/components/app-nav";
import { InstallPrompt, OfflineBanner, PwaRegister } from "@/components/pwa";
import "./globals.css";

export const metadata: Metadata = {
  title: "MK AI Travel — Your next trip, thoughtfully planned",
  description: "A smarter, more personal way to plan your next journey with MK Solutions.",
  applicationName: "MK AI Travel",
  icons: {
    icon: [{ url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }, { url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "MK Travel", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#173d35",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <OfflineBanner />
        <AppNav />
        {children}
        <InstallPrompt />
        <PwaRegister />
      </body>
    </html>
  );
}
