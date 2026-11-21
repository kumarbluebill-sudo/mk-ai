"use client";

import { signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CalendarCheck, LogOut, MapPinned, MessageCircle, Users } from "lucide-react";

const LINKS = [
  { href: "/chat", label: "Agent chat", icon: MessageCircle },
  { href: "/designer", label: "Trips", icon: MapPinned },
  { href: "/bookings", label: "Bookings", icon: CalendarCheck },
  { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/team", label: "Team", icon: Users },
];

const HIDDEN = ["/", "/login", "/register", "/offline", "/debug"];

/** Top navigation for signed-in screens. Sign-out lives here so every page has it. */
export function AppNav() {
  const pathname = usePathname();
  if (HIDDEN.some((p) => pathname === p)) return null;
  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
      <div className="flex h-14 items-center gap-2 px-4">
        <Link href="/chat" className="mr-3 flex items-center gap-2 font-semibold tracking-tight text-gray-900">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-800 text-xs font-bold text-white">MK</span>
          <span className="hidden sm:inline">MK AI Travel</span>
        </Link>
        <nav aria-label="Main" className="flex flex-1 items-center gap-1 overflow-x-auto">
          {LINKS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  active ? "bg-brand-50 text-brand-800" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <Icon size={16} />
                <span className="hidden md:inline">{label}</span>
              </Link>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={() => void signOut({ callbackUrl: "/login" })}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-900"
        >
          <LogOut size={16} />
          <span className="hidden md:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}
