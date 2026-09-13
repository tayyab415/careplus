import { google, type calendar_v3 } from "googleapis";
import { env } from "@/config/env";
import { clinic } from "@/data/clinic";

/**
 * Google Calendar owned by the CarePlus service account. Bookings and holds land
 * here as real events. The calendar is shared with CALENDAR_SHARE_WITH so a human
 * can watch it during the demo.
 */

const CAL_SUMMARY = `CarePlus — ${clinic.name}`;
let calendarClient: calendar_v3.Calendar | null = null;
let calendarId: string | null = env.clinicCalendarId || null;

export function calendarEnabled() {
  return Boolean(env.gcpServiceAccountKey) && !env.dryRun;
}

function client(): calendar_v3.Calendar {
  if (!calendarClient) {
    const auth = new google.auth.GoogleAuth({
      keyFilename: env.gcpServiceAccountKey,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    calendarClient = google.calendar({ version: "v3", auth });
  }
  return calendarClient;
}

export async function ensureClinicCalendar(): Promise<string> {
  if (calendarId) return calendarId;
  const cal = client();
  const list = await cal.calendarList.list();
  const existing = list.data.items?.find((c) => c.summary === CAL_SUMMARY);
  if (existing?.id) {
    calendarId = existing.id;
    return calendarId;
  }
  const created = await cal.calendars.insert({ requestBody: { summary: CAL_SUMMARY, timeZone: clinic.timezone } });
  calendarId = created.data.id!;
  if (env.calendarShareWith) {
    await cal.acl
      .insert({ calendarId, requestBody: { role: "owner", scope: { type: "user", value: env.calendarShareWith } } })
      .catch((e) => console.warn("[calendar] share failed:", (e as Error).message));
  }
  return calendarId;
}

export interface BusyPeriod {
  start: string;
  end: string;
}

export async function freeBusy(fromIso: string, toIso: string): Promise<BusyPeriod[]> {
  if (!calendarEnabled()) return [];
  const id = await ensureClinicCalendar();
  const res = await client().freebusy.query({
    requestBody: { timeMin: fromIso, timeMax: toIso, timeZone: clinic.timezone, items: [{ id }] },
  });
  const busy = res.data.calendars?.[id]?.busy ?? [];
  return busy.filter((b) => b.start && b.end).map((b) => ({ start: b.start!, end: b.end! }));
}

export async function insertEvent(ev: {
  summary: string;
  description: string;
  start: string;
  end: string;
  location?: string;
  status: "held" | "confirmed";
  meta: Record<string, string>;
}): Promise<{ eventId: string; htmlLink?: string } | null> {
  if (!calendarEnabled()) return null;
  const id = await ensureClinicCalendar();
  const res = await client().events.insert({
    calendarId: id,
    requestBody: {
      summary: (ev.status === "held" ? "[HOLD] " : "") + ev.summary,
      description: ev.description,
      location: ev.location,
      start: { dateTime: ev.start, timeZone: clinic.timezone },
      end: { dateTime: ev.end, timeZone: clinic.timezone },
      colorId: ev.status === "held" ? "5" : "10",
      extendedProperties: { private: ev.meta },
    },
  });
  return { eventId: res.data.id!, htmlLink: res.data.htmlLink ?? undefined };
}

export async function updateEventStatus(eventId: string, status: "confirmed" | "cancelled", summary?: string) {
  if (!calendarEnabled()) return;
  const id = await ensureClinicCalendar();
  if (status === "cancelled") {
    await client().events.delete({ calendarId: id, eventId }).catch(() => undefined);
    return;
  }
  const cur = await client().events.get({ calendarId: id, eventId });
  await client().events.patch({
    calendarId: id,
    eventId,
    requestBody: { summary: (summary ?? cur.data.summary ?? "").replace(/^\[HOLD\]\s*/, ""), colorId: "10" },
  });
}
