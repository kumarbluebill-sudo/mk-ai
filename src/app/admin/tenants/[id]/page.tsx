import AdminTenantDetail from "@/components/admin-tenant-detail";

export const metadata = { title: "Agency · Platform admin" };

export default async function AdminTenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminTenantDetail id={id} />;
}
