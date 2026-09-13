import { env } from "@/config/env";
import type { Communication, Patient } from "@/core/types";
import { getStore } from "@/core/store";
import { nowIso, shortId } from "@/core/ids";

/**
 * Patient messaging. SMS goes through Twilio when configured; otherwise the message is
 * recorded as `simulated` and rendered on the portal's virtual phone. Either way it is
 * persisted as a Communication so the case history is complete.
 *
 * Policy: never put clinical detail (medication names, symptoms) in an SMS body.
 * Use references and a portal link.
 */
export async function sendPatientMessage(input: {
  patient: Patient;
  caseId: string;
  body: string;
  channel?: "sms" | "email" | "portal";
}): Promise<Communication> {
  const channel = input.channel ?? input.patient.preferredContact ?? "sms";
  const to = channel === "email" ? input.patient.email : input.patient.phone;
  const comm: Communication = {
    id: shortId("msg"),
    patientId: input.patient.id,
    caseId: input.caseId,
    channel,
    direction: "outbound",
    to,
    body: input.body,
    status: "simulated",
    at: nowIso(),
  };

  if (channel === "sms" && env.twilioAccountSid && env.twilioAuthToken && env.twilioFromNumber && to && !env.dryRun) {
    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.twilioAccountSid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${env.twilioAccountSid}:${env.twilioAuthToken}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: env.twilioFromNumber, Body: input.body }),
      });
      const json = (await res.json()) as { sid?: string; message?: string };
      if (res.ok && json.sid) {
        comm.status = "sent";
        comm.providerId = json.sid;
      } else {
        comm.status = "failed";
        comm.body += `\n[delivery failed: ${json.message ?? res.status}]`;
      }
    } catch (e) {
      comm.status = "failed";
      comm.body += `\n[delivery failed: ${(e as Error).message}]`;
    }
  }

  await getStore().putCommunication(comm);
  return comm;
}
