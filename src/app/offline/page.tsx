import Link from "next/link";

export const metadata = { title: "Offline · MK AI Travel" };

/** Shown by the service worker when a page cannot be reached. Static and identical for everyone. */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">You are offline</h1>
      <p className="text-sm text-gray-600">
        MK AI Travel needs a connection to search suppliers, check availability and save your trips. Nothing you
        entered has been lost on the server. Reconnect and try again.
      </p>
      <p className="text-xs text-gray-500">For privacy, trips, quotations and bookings are never stored on this device.</p>
      <Link href="/chat" className="rounded bg-blue-600 px-4 py-2 text-sm text-white">Try again</Link>
    </main>
  );
}
