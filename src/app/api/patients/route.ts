import { getStore } from "@/core/store";
import { ensureSeeded, errorResponse, json } from "@/server/bootstrap";
import { integrationStatus } from "@/config/env";
import { clinic } from "@/data/clinic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSeeded();
    const store = getStore();
    const patients = (await store.listPatients()).filter((p) => p.kind === "existing");
    return json({
      clinic: { name: clinic.name, shortName: clinic.shortName, phone: clinic.phone },
      patients: patients.map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        demoBlurb: p.demoBlurb,
        languages: p.languages,
        accessibility: p.accessibility,
        preferredAppointmentMode: p.preferredAppointmentMode,
        primaryClinician: p.primaryClinician,
        membership: p.membership,
      })),
      integrations: integrationStatus(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
