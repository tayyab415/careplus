import { runTurn } from "@/agent/coordinator";
import type { Attachment } from "@/core/types";
import { ensureSeeded, errorResponse } from "@/server/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * One conversational turn, streamed as server-sent events:
 *   event: progress  data: {"note": "Resolving medication…"}
 *   event: result    data: TurnResult
 *   event: error     data: {"error": "..."}
 */
export async function POST(req: Request) {
  try {
    await ensureSeeded();
    const body = (await req.json()) as { patientId: string; caseId?: string; text: string; attachments?: Attachment[] };
    if (!body.patientId || !body.text?.trim()) return errorResponse(new Error("patientId and text are required"), 400);

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        const heartbeat = setInterval(() => controller.enqueue(encoder.encode(": keep-alive\n\n")), 10_000);
        try {
          const result = await runTurn({
            patientId: body.patientId,
            caseId: body.caseId,
            text: body.text,
            attachments: body.attachments?.map((a) => ({ ...a, previewUrl: undefined })),
            onProgress: (note) => send("progress", { note }),
          });
          send("result", result);
        } catch (e) {
          send("error", { error: (e as Error).message });
        } finally {
          clearInterval(heartbeat);
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
  } catch (e) {
    return errorResponse(e);
  }
}
