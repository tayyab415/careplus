import { performStaffAction } from "@/agent/coordinator";
import { ensureSeeded, errorResponse, json } from "@/server/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    await ensureSeeded();
    const body = (await req.json()) as { reviewId: string; actionId: string; staffName?: string; freeText?: string };
    const res = await performStaffAction({ reviewId: body.reviewId, actionId: body.actionId, staffName: body.staffName || "Clinic staff", freeText: body.freeText });
    return json(res);
  } catch (e) {
    return errorResponse(e);
  }
}
