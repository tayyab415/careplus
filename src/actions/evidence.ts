import { Storage } from "@google-cloud/storage";
import { env } from "@/config/env";

/**
 * Evidence store: uploaded photos / documents go to Cloud Storage and the case record
 * keeps only the gs:// pointer (Firestore documents are capped at 1 MiB, and a phone
 * photo is routinely bigger). Falls back to an inline data URL when no bucket is set.
 */

let storage: Storage | null = null;
function gcs() {
  if (!storage) storage = new Storage({ projectId: env.gcpProject, ...(env.gcpServiceAccountKey ? { keyFilename: env.gcpServiceAccountKey } : {}) });
  return storage;
}

export function evidenceEnabled() {
  return Boolean(env.evidenceBucket) && !env.dryRun;
}

export async function storeEvidence(input: { docId: string; caseId: string; mimeType: string; base64: string }): Promise<string> {
  const inline = `data:${input.mimeType};base64,${input.base64}`;
  if (!evidenceEnabled()) return inline;
  try {
    const ext = input.mimeType.split("/")[1]?.split("+")[0] || "bin";
    const object = `cases/${input.caseId}/${input.docId}.${ext}`;
    await gcs()
      .bucket(env.evidenceBucket)
      .file(object)
      .save(Buffer.from(input.base64, "base64"), { contentType: input.mimeType, resumable: false, metadata: { cacheControl: "private, max-age=0" } });
    return `gs://${env.evidenceBucket}/${object}`;
  } catch (e) {
    console.warn("[evidence] GCS upload failed, keeping inline:", (e as Error).message);
    return inline;
  }
}

/** Short-lived read URL for the UI. Data URLs pass straight through. */
export async function evidencePreviewUrl(uri: string, minutes = 60): Promise<string | undefined> {
  if (uri.startsWith("data:")) return uri;
  const m = uri.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!m) return undefined;
  try {
    const [url] = await gcs()
      .bucket(m[1])
      .file(m[2])
      .getSignedUrl({ version: "v4", action: "read", expires: Date.now() + minutes * 60_000 });
    return url;
  } catch (e) {
    console.warn("[evidence] signed URL failed:", (e as Error).message);
    return undefined;
  }
}
