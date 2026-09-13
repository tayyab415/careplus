import { PortalClient } from "@/components/portal/PortalClient";

export const dynamic = "force-dynamic";

export default async function PortalPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  return <PortalClient patientId={patientId} />;
}
