import BookingDetail from "@/components/booking-detail";

export const metadata = { title: "Booking · MK AI Travel" };

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BookingDetail id={id} />;
}
