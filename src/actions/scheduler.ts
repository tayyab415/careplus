import { clinic, getAppointmentType, getLocation, type AppointmentModeId, type StaffMember } from "@/data/clinic";
import type { Appointment, Patient } from "@/core/types";
import { getStore } from "@/core/store";
import { addDays, localDate, localToUtc, localWeekday } from "@/core/time";
import { freeBusy, insertEvent, updateEventStatus } from "./calendar";
import { nowIso, shortId } from "@/core/ids";

export interface Slot {
  start: string;
  end: string;
  mode: AppointmentModeId;
  location?: string;
  clinicianId: string;
  clinician: string;
}

export interface SlotQuery {
  appointmentTypeId: string;
  mode?: AppointmentModeId;
  /** Earliest acceptable start (ISO). Defaults to now + 2h. */
  notBefore?: string;
  /** Search window in days. */
  days?: number;
  patient?: Patient;
  /** Hard requirement: only wheelchair-accessible locations. */
  requireWheelchair?: boolean;
  /** Hard requirement: an interpreter attends → long-type duration + notice. */
  requireInterpreter?: boolean;
  preferredClinicianId?: string;
  limit?: number;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

function timeToMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function minToTime(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Dependency-aware, accessibility-aware slot finder. Combines clinic-authored
 * rosters with existing bookings in the store and (when live) Google Calendar busy time.
 */
export async function findSlots(q: SlotQuery): Promise<Slot[]> {
  const type = getAppointmentType(q.appointmentTypeId);
  if (!type) throw new Error(`Unknown appointment type ${q.appointmentTypeId}`);

  const store = getStore();
  const now = Date.now();
  let notBefore = q.notBefore ? Date.parse(q.notBefore) : now + 2 * 3600_000;
  if (q.requireInterpreter) {
    const notice = clinic.accommodations.find((a) => a.id === "interpreter")?.requiresNoticeHours ?? 48;
    notBefore = Math.max(notBefore, now + notice * 3600_000);
  }
  const days = q.days ?? 10;
  const duration = q.requireInterpreter ? Math.max(type.durationMin, 30) : type.durationMin;

  const wheelchair = q.requireWheelchair || (q.patient?.accessibility ?? []).some((a) => /wheelchair|step-free/i.test(a));
  const allowedLocations = type.locationIds.filter((id) => !wheelchair || getLocation(id)?.wheelchairAccessible);

  const modes: AppointmentModeId[] = q.mode ? [q.mode] : type.modes;
  const staff = clinic.staff.filter((s) => type.roles.includes(s.role) && s.modes.some((m) => modes.includes(m)));
  const ordered = q.preferredClinicianId
    ? [...staff.filter((s) => s.id === q.preferredClinicianId), ...staff.filter((s) => s.id !== q.preferredClinicianId)]
    : staff;

  const windowStart = new Date(notBefore).toISOString();
  const windowEnd = new Date(notBefore + days * 86400_000).toISOString();
  const [existing, busy] = await Promise.all([
    store.listAppointments({ from: windowStart, to: windowEnd }),
    freeBusy(windowStart, windowEnd).catch(() => []),
  ]);
  const taken = existing.filter((a) => a.status !== "cancelled");

  const slots: Slot[] = [];
  const limit = q.limit ?? 6;
  const startDate = localDate(new Date(notBefore));

  outer: for (let d = 0; d <= days; d++) {
    const date = addDays(startDate, d);
    const weekday = localWeekday(localToUtc(date, "12:00"));
    const clinicHours = clinic.hours.find((h) => h.days.includes(weekday));
    if (!clinicHours) continue;

    for (const s of ordered) {
      const roster = s.hours.find((h) => h.days.includes(weekday));
      if (!roster) continue;
      const mode = modes.find((m) => s.modes.includes(m));
      if (!mode) continue;
      const locId = mode === "in_person" ? s.locationIds.find((l) => allowedLocations.includes(l)) : undefined;
      if (mode === "in_person" && !locId) continue;

      const from = Math.max(timeToMin(roster.start), timeToMin(clinicHours.start));
      const to = Math.min(timeToMin(roster.end), timeToMin(clinicHours.end));
      // At most 3 slots per clinician per day (early / mid / late) so options have variety.
      const perDay: Slot[] = [];
      for (let m = from; m + duration <= to; m += 15) {
        const start = localToUtc(date, minToTime(m));
        const end = new Date(start.getTime() + duration * 60000);
        if (start.getTime() < notBefore) continue;
        const clash =
          taken.some((a) => a.clinician === s.id && overlaps(start.getTime(), end.getTime(), Date.parse(a.start), Date.parse(a.end))) ||
          busy.some((b) => overlaps(start.getTime(), end.getTime(), Date.parse(b.start), Date.parse(b.end)));
        if (clash) continue;
        perDay.push({ start: start.toISOString(), end: end.toISOString(), mode, location: locId, clinicianId: s.id, clinician: s.name });
      }
      if (perDay.length) {
        const picks = perDay.length <= 3 ? perDay : [perDay[0], perDay[Math.floor(perDay.length / 2)], perDay[perDay.length - 1]];
        slots.push(...picks);
      }
      if (slots.length >= limit * 4) break outer;
    }
  }

  // Interleave by day so the patient sees the earliest options across different days.
  slots.sort((a, b) => a.start.localeCompare(b.start));
  const byDay = new Map<string, Slot[]>();
  for (const s of slots) {
    const k = localDate(new Date(s.start));
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(s);
  }
  const spread: Slot[] = [];
  const dayLists = [...byDay.values()];
  for (let i = 0; spread.length < limit && dayLists.some((l) => l.length); i++) {
    for (const l of dayLists) {
      const next = l.shift();
      if (next) spread.push(next);
      if (spread.length >= limit) break;
    }
  }
  return spread;
}

export async function bookAppointment(input: {
  patient: Patient;
  caseId: string;
  appointmentTypeId: string;
  slot: Slot;
  status: "held" | "confirmed";
  dependsOn?: string[];
  notes?: string;
}): Promise<Appointment> {
  const type = getAppointmentType(input.appointmentTypeId)!;
  const store = getStore();
  const loc = input.slot.location ? getLocation(input.slot.location) : undefined;
  const appt: Appointment = {
    id: shortId("appt"),
    patientId: input.patient.id,
    caseId: input.caseId,
    appointmentTypeId: type.id,
    title: `${type.title} — ${input.slot.clinician}`,
    start: input.slot.start,
    end: input.slot.end,
    mode: input.slot.mode,
    location: loc?.id,
    clinician: input.slot.clinicianId,
    status: input.status,
    dependsOn: input.dependsOn ?? [],
    notes: input.notes,
    createdAt: nowIso(),
  };
  const initials = input.patient.name.split(" ").map((p, i, a) => (i === a.length - 1 ? p[0] + "." : p)).join(" ");
  const ev = await insertEvent({
    summary: `${type.title} — ${initials} (${input.caseId})`,
    description: [
      `Case ${input.caseId} · Patient ${input.patient.id}`,
      `Mode: ${appt.mode}${loc ? ` · ${loc.name}` : ""}`,
      `Clinician: ${input.slot.clinician}`,
      input.notes ? `Notes: ${input.notes}` : "",
      "Created by CarePlus. Contains no clinical detail by design.",
    ]
      .filter(Boolean)
      .join("\n"),
    start: appt.start,
    end: appt.end,
    location: loc ? `${loc.name}, ${loc.address}` : undefined,
    status: input.status,
    meta: { caseId: input.caseId, patientId: input.patient.id, appointmentId: appt.id },
  }).catch((e) => {
    console.warn("[calendar] insert failed:", (e as Error).message);
    return null;
  });
  if (ev) {
    appt.calendarEventId = ev.eventId;
    appt.calendarLink = ev.htmlLink;
  }
  await store.putAppointment(appt);
  return appt;
}

export async function confirmAppointment(appointmentId: string): Promise<Appointment | null> {
  const store = getStore();
  const all = await store.listAppointments({});
  const appt = all.find((a) => a.id === appointmentId);
  if (!appt) return null;
  appt.status = "confirmed";
  if (appt.calendarEventId) await updateEventStatus(appt.calendarEventId, "confirmed").catch(() => undefined);
  await store.putAppointment(appt);
  return appt;
}

export async function cancelAppointment(appointmentId: string): Promise<void> {
  const store = getStore();
  const all = await store.listAppointments({});
  const appt = all.find((a) => a.id === appointmentId);
  if (!appt) return;
  appt.status = "cancelled";
  if (appt.calendarEventId) await updateEventStatus(appt.calendarEventId, "cancelled").catch(() => undefined);
  await store.putAppointment(appt);
}

export function describeStaff(s: StaffMember) {
  return `${s.name} (${s.role})`;
}
