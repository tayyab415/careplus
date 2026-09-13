import OpenAI from "openai";
import { env } from "@/config/env";

let client: OpenAI | null = null;

export function openai(): OpenAI {
  if (!client) {
    if (!env.openaiApiKey) throw new Error("OPENAI_API_KEY is not set");
    client = new OpenAI({ apiKey: env.openaiApiKey });
  }
  return client;
}
