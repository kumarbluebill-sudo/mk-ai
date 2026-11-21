import { Compass, FileText, MessageCircle, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

const POINTS = [
  { icon: MessageCircle, text: "Chat with an AI agent to plan any trip in minutes" },
  { icon: Compass, text: "Live supplier search with real availability and rates" },
  { icon: FileText, text: "Branded quotations, ready to download and share" },
  { icon: ShieldCheck, text: "Bookings confirmed only after payment is verified" },
];

/** Split-screen layout shared by the sign-in and registration pages. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-brand-900 p-12 text-white lg:flex">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-700/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-gold-500/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-lg font-bold ring-1 ring-white/20">MK</span>
          <span className="text-lg font-semibold tracking-tight">MK AI Travel</span>
        </div>
        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-400">For travel agents</p>
          <h2 className="mt-4 max-w-md font-serif text-4xl leading-tight">Plan, quote and book trips at the speed of a conversation.</h2>
          <ul className="mt-10 space-y-4">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-brand-100">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10"><Icon size={16} /></span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-brand-300">© MK Solutions</p>
      </aside>
      <main className="flex items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-800 text-sm font-bold text-white">MK</span>
            <span className="font-semibold">MK AI Travel</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{title}</h1>
          <p className="mb-8 mt-1.5 text-sm text-gray-500">{subtitle}</p>
          {children}
        </div>
      </main>
    </div>
  );
}
