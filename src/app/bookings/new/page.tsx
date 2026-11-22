import NewBooking, { type Prefill } from "@/components/new-booking";

export const metadata = { title: "New booking · MK AI Travel" };

const ONE = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** A trip item can open this page with its tour already chosen. Only the shape is checked here; the supplier checks everything else. */
export default async function NewBookingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const tourId = ONE(sp.tourId);
  const date = ONE(sp.date);
  const prefill: Prefill | null =
    tourId && /^\d{1,10}$/.test(tourId)
      ? { tourId, title: (ONE(sp.title) ?? "Selected tour").slice(0, 200), date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null }
      : null;
  return <NewBooking prefill={prefill} />;
}
