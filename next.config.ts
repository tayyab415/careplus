import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  serverExternalPackages: ["@google-cloud/firestore", "@google-cloud/storage", "google-auth-library", "googleapis", "@slack/bolt"],
};

export default nextConfig;
