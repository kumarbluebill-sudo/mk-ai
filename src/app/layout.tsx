import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MK AI Travel — Your next trip, thoughtfully planned",
  description: "A smarter, more personal way to plan your next journey with MK Solutions.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
