import { GoogleAuth } from "google-auth-library";
import { env } from "@/config/env";

let auth: GoogleAuth | null = null;

/** Shared Google auth (service-account key if configured, otherwise ADC). */
export function googleAuth(scopes: string[] = ["https://www.googleapis.com/auth/cloud-platform"]) {
  if (!auth) {
    auth = new GoogleAuth({
      scopes,
      projectId: env.gcpProject,
      ...(env.gcpServiceAccountKey ? { keyFilename: env.gcpServiceAccountKey } : {}),
    });
  }
  return auth;
}

export async function googleAccessToken(): Promise<string> {
  const client = await googleAuth().getClient();
  const t = await client.getAccessToken();
  if (!t.token) throw new Error("Failed to obtain Google access token");
  return t.token;
}

export async function googleFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await googleAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("x-goog-user-project", env.gcpProject);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  return fetch(url, { ...init, headers });
}
