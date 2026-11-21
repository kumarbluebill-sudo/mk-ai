import { notFound } from "next/navigation";
import type { ReactNode } from "react";

// The debug tool is a development aid only; never serve it in production.
export default function DebugLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return <>{children}</>;
}
