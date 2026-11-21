import TripDesigner from "@/components/trip-designer";

export const metadata = { title: "Trip designer · MK AI Travel" };

export default async function DesignerTripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TripDesigner conversationId={id} />;
}
