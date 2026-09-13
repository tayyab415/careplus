import "dotenv/config";
import path from "node:path";
import fs from "node:fs";

function str(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    return "";
  }
  return v;
}

function bool(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

const root = process.cwd();
const defaultSaKey = path.join(root, "secrets", "careplus-agent.json");

export const env = {
  // ---- Google Cloud ----
  gcpProject: str("GOOGLE_CLOUD_PROJECT", "onehorizon-494120"),
  gcpLocation: str("GOOGLE_CLOUD_LOCATION", "us-central1"),
  /** Service-account key used for Calendar + Firestore + GCS when present. */
  gcpServiceAccountKey: str(
    "GOOGLE_APPLICATION_CREDENTIALS",
    fs.existsSync(defaultSaKey) ? defaultSaKey : "",
  ),
  firestoreDatabase: str("FIRESTORE_DATABASE", "careplus"),
  evidenceBucket: str("EVIDENCE_BUCKET", "onehorizon-494120-careplus-evidence"),

  // ---- Models ----
  openaiApiKey: str("OPENAI_API_KEY"),
  /** Coordinator / router model (OpenAI). */
  coordinatorModel: str("COORDINATOR_MODEL", "gpt-5.6-luna"),
  /** Reasoning effort for the coordinator: low is ~2x faster; medium is more thorough. */
  coordinatorReasoning: str("COORDINATOR_REASONING", "low") as "low" | "medium" | "high",
  /** Fast model for extraction, classification, summaries (Gemini via Vertex). */
  fastModel: str("FAST_MODEL", "gemini-3.1-flash-lite"),
  /** Vision model for label/prescription extraction (Gemini via Vertex). */
  visionModel: str("VISION_MODEL", "gemini-3.1-flash-lite"),
  /** Vertex AI endpoint ID hosting TxGemma (pytorch-vllm-serve). */
  txgemmaEndpointId: str("TXGEMMA_ENDPOINT_ID"),
  txgemmaLocation: str("TXGEMMA_LOCATION", "us-central1"),
  /** Dedicated-endpoint DNS (Model Garden deployments), e.g. mg-endpoint-…prediction.vertexai.goog */
  txgemmaDedicatedDns: str("TXGEMMA_DEDICATED_DNS"),

  // ---- Slack ----
  slackBotToken: str("SLACK_BOT_TOKEN"),
  slackAppToken: str("SLACK_APP_TOKEN"),
  slackSigningSecret: str("SLACK_SIGNING_SECRET"),
  slackTriageChannel: str("SLACK_TRIAGE_CHANNEL"),

  // ---- Messaging ----
  twilioAccountSid: str("TWILIO_ACCOUNT_SID"),
  twilioAuthToken: str("TWILIO_AUTH_TOKEN"),
  twilioFromNumber: str("TWILIO_FROM_NUMBER"),

  // ---- Calendar ----
  /** Calendar owned by the service account. Created on first use if empty. */
  clinicCalendarId: str("CLINIC_CALENDAR_ID"),
  /** Human account to share the clinic calendar with (so you can watch bookings land). */
  calendarShareWith: str("CALENDAR_SHARE_WITH", "sahiltanna7@gmail.com"),

  // ---- Store ----
  /** "firestore" | "memory". Memory store persists to .careplus/store.json for dev. */
  storeBackend: str("STORE_BACKEND", "memory"),
  memoryStorePath: str("MEMORY_STORE_PATH", path.join(root, ".careplus", "store.json")),

  // ---- Behaviour ----
  clinicTimezone: str("CLINIC_TIMEZONE", "Australia/Sydney"),
  /** When true, external actions (calendar/slack/sms) are simulated and recorded, never sent. */
  dryRun: bool("CAREPLUS_DRY_RUN", false),
  debugAgent: bool("CAREPLUS_DEBUG", false),
};

export type Env = typeof env;

/** Which integrations are live, based on credentials present. Surfaced in the UI and logs. */
export function integrationStatus() {
  return {
    openai: Boolean(env.openaiApiKey),
    vertexGemini: true, // ADC / SA
    txgemma: Boolean(env.txgemmaEndpointId),
    firestore: env.storeBackend === "firestore",
    calendar: Boolean(env.gcpServiceAccountKey) && !env.dryRun,
    slack: Boolean(env.slackBotToken && env.slackTriageChannel) && !env.dryRun,
    sms: Boolean(env.twilioAccountSid && env.twilioAuthToken && env.twilioFromNumber) && !env.dryRun,
  };
}
