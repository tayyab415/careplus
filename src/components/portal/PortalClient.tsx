"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Appointment, Attachment, CarePlanTask, Case, ChatMessage, Communication, Fact, Patient, TurnResult } from "@/core/types";
import { Button, Dots, StatusBadge, TierBadge } from "@/components/ui";
import { CameraIcon, CardView } from "./Cards";
import { PhonePanel } from "./PhonePanel";
import { RecordPanel } from "./RecordPanel";
import { fmtTime, renderMarkdown } from "@/lib/ui";

interface PortalData {
  patient: Patient | null;
  facts: Fact[];
  appointments: Appointment[];
  careTasks: CarePlanTask[];
  cases: { id: string; title?: string; status: string; tier?: string; updatedAt: string; messageCount: number }[];
  communications: Communication[];
  clinic: { name: string; phone: string };
}

interface PendingAttachment extends Attachment {
  previewUrl: string;
  extraction?: { productName: string | null; confidence: number } | null;
}

const STARTERS: Record<string, string[]> = {
  default: ["My doctor recommended a new medicine but I had a bad reaction to something similar before.", "The doctor told me to book a few things — can you arrange them?", "I need a follow-up but I don't know which appointment to book."],
  prospective: ["Hi, I'm new here and would like to see a doctor.", "I'd like to register and book a first appointment."],
};

type SR = { start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; lang: string; interimResults: boolean; continuous: boolean };

export function PortalClient({ patientId: initialPatientId }: { patientId: string }) {
  const [patientId, setPatientId] = useState(initialPatientId);
  const [data, setData] = useState<PortalData | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [kase, setKase] = useState<Case | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [comms, setComms] = useState<Communication[]>([]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [integrations, setIntegrations] = useState<Record<string, boolean>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<SR | null>(null);

  const isProspective = initialPatientId === "prospective";

  const loadPortal = useCallback(async (pid: string) => {
    const r = await fetch(`/api/portal/${pid}`);
    const d = (await r.json()) as PortalData & { error?: string };
    if (d.error) throw new Error(d.error);
    setData(d);
    if (pid !== "prospective") setComms(d.communications);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state is set after an awaited fetch, not synchronously
    loadPortal(patientId).catch((e) => setError(String(e.message ?? e)));
    fetch("/api/patients")
      .then((r) => r.json())
      .then((d) => setIntegrations(d.integrations ?? {}))
      .catch(() => undefined);
  }, [patientId, loadPortal]);

  // Poll the active case so staff actions (questions, confirmations) show up live.
  useEffect(() => {
    if (!caseId) return;
    let stop = false;
    const tick = async () => {
      if (busy || stop) return;
      try {
        const r = await fetch(`/api/case/${caseId}`);
        const d = (await r.json()) as { case: Case; communications: Communication[]; appointments: Appointment[] };
        if (stop || !d.case) return;
        setKase(d.case);
        setMessages(d.case.messages);
        setComms((prev) => mergeById(prev, d.communications));
        setData((prev) => (prev ? { ...prev, appointments: mergeById(prev.appointments.filter((a) => a.caseId !== caseId), d.appointments) } : prev));
      } catch {
        /* transient */
      }
    };
    const iv = setInterval(tick, 4000);
    return () => {
      stop = true;
      clearInterval(iv);
    };
  }, [caseId, busy]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, progress, busy]);

  const send = useCallback(
    async (rawText: string) => {
      const body = rawText.trim() || (pending.length ? "Here's the photo." : "");
      if (!body || busy) return;
      setError(null);
      setBusy(true);
      setProgress([]);
      const attachments = pending.map((p) => ({ documentId: p.documentId, name: p.name, mimeType: p.mimeType, previewUrl: p.previewUrl }));
      const optimistic: ChatMessage = { id: `tmp-${Date.now()}`, role: "patient", text: body, attachments, cards: [], at: new Date().toISOString() };
      setMessages((m) => [...m, optimistic]);
      setText("");
      setPending([]);
      try {
        const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId, caseId, text: body, attachments }) });
        if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        let result: TurnResult | null = null;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const ev = /^event: (\w+)/m.exec(chunk)?.[1];
            const dataLine = chunk
              .split("\n")
              .filter((l) => l.startsWith("data: "))
              .map((l) => l.slice(6))
              .join("\n");
            if (!ev || !dataLine) continue;
            const payload = JSON.parse(dataLine);
            if (ev === "progress") setProgress((p) => [...p.slice(-4), payload.note]);
            else if (ev === "result") result = payload as TurnResult;
            else if (ev === "error") throw new Error(payload.error);
          }
        }
        if (!result) throw new Error("No reply received");
        setCaseId(result.caseId);
        setKase(result.case);
        // Keep the local preview URLs on the patient's own messages.
        const previews = new Map(attachments.map((a) => [a.documentId, a.previewUrl]));
        setMessages(result.case.messages.map((m) => ({ ...m, attachments: m.attachments.map((a) => ({ ...a, previewUrl: a.previewUrl ?? previews.get(a.documentId) })) })));
        setComms((prev) => mergeById(prev, result!.communications));
        if (result.case.patientId !== patientId) setPatientId(result.case.patientId);
        else loadPortal(patientId).catch(() => undefined);
      } catch (e) {
        setError((e as Error).message);
        setMessages((m) => m.filter((x) => x.id !== optimistic.id));
        setText(body);
      } finally {
        setBusy(false);
        setProgress([]);
      }
    },
    [busy, caseId, patientId, pending, loadPortal],
  );

  const onFile = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const base64 = await fileToBase64(file);
      const previewUrl = URL.createObjectURL(file);
      const r = await fetch("/api/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId, caseId, name: file.name, mimeType: file.type || "image/jpeg", base64 }) });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      if (!caseId) setCaseId(d.caseId);
      setPending((p) => [...p, { ...d.attachment, previewUrl, extraction: d.extraction ? { productName: d.extraction.productName, confidence: d.extraction.confidence } : null }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const toggleVoice = () => {
    const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) {
      setError("Voice input isn't supported in this browser. Try Chrome.");
      return;
    }
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = new Ctor();
    rec.lang = data?.patient?.languages?.[0] === "Portuguese" ? "pt-PT" : "en-AU";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      const transcript = Array.from({ length: e.results.length }, (_, i) => e.results[i][0].transcript).join(" ");
      setText(transcript);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  const newConversation = () => {
    setCaseId(null);
    setKase(null);
    setMessages([]);
    setPending([]);
    setText("");
  };

  const openExisting = async (id: string) => {
    const r = await fetch(`/api/case/${id}`);
    const d = (await r.json()) as { case: Case; communications: Communication[] };
    if (!d.case) return;
    setCaseId(id);
    setKase(d.case);
    setMessages(d.case.messages);
    setComms((prev) => mergeById(prev, d.communications));
  };

  const latestAgentIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role !== "patient") return i;
    return -1;
  }, [messages]);

  const starters = isProspective ? STARTERS.prospective : STARTERS.default;
  const displayName = data?.patient?.preferredName ?? data?.patient?.name;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-line bg-panel px-5 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-[13px] text-stone-500 hover:text-stone-800">
            ← Personas
          </Link>
          <span className="text-stone-300">|</span>
          <div>
            <div className="text-[15px] font-semibold text-stone-900">
              CarePlus <span className="font-normal text-stone-400">·</span> <span className="text-stone-600">{data?.clinic.name ?? "Harbourside Family Clinic"}</span>
            </div>
            <div className="text-[12px] text-stone-500">
              {data?.patient ? (
                <>
                  Signed in as <span className="font-medium text-stone-700">{displayName}</span> · {data.patient.kind === "prospective" ? "provisional record, self-reported" : "member"}
                </>
              ) : (
                <>New patient · nothing verified yet</>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {kase && (
            <div className="flex items-center gap-2 text-[12px] text-stone-500">
              <span className="font-mono">{kase.id}</span>
              <StatusBadge status={kase.status} />
              <TierBadge tier={kase.tier} />
            </div>
          )}
          <Button variant="secondary" onClick={newConversation} disabled={busy}>
            New conversation
          </Button>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1500px] flex-1 grid-cols-1 gap-5 px-5 py-5 lg:grid-cols-[300px_minmax(0,1fr)_300px]">
        {/* Record */}
        <aside className="scroll-thin order-2 max-h-[calc(100vh-100px)] overflow-y-auto rounded-xl border border-line bg-panel p-4 lg:order-1 lg:sticky lg:top-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-stone-800">Your clinic record</h2>
            <span className="text-[11px] text-stone-400">What CarePlus can see</span>
          </div>
          {data ? <RecordPanel patient={data.patient} facts={data.facts} appointments={data.appointments} careTasks={data.careTasks} /> : <div className="h-40 animate-pulse rounded-lg bg-stone-100" />}
          {data && data.cases.length > 0 && (
            <div className="mt-5">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400">Previous conversations</div>
              <ul className="space-y-1">
                {data.cases.slice(0, 6).map((c) => (
                  <li key={c.id}>
                    <button onClick={() => openExisting(c.id)} className={`w-full rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-stone-50 ${c.id === caseId ? "bg-stone-100" : ""}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-stone-500">{c.id}</span>
                        <StatusBadge status={c.status} />
                      </div>
                      <div className="truncate text-stone-700">{c.title}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>

        {/* Chat */}
        <main className="order-1 flex min-h-[70vh] flex-col rounded-xl border border-line bg-panel lg:order-2 lg:max-h-[calc(100vh-100px)]">
          <div ref={scrollRef} className="scroll-thin flex-1 overflow-y-auto px-5 py-5">
            {messages.length === 0 && (
              <div className="mx-auto max-w-lg pt-10 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                  <PlusIcon />
                </div>
                <h2 className="text-lg font-semibold text-stone-900">{data?.patient ? `Hello ${displayName}.` : "Welcome to Harbourside."}</h2>
                <p className="mt-2 text-[14px] leading-relaxed text-stone-600">
                  {data?.patient
                    ? "Tell me what happened or what your doctor asked you to arrange. I'll read your record first, ask only for what's missing, and take care of the booking."
                    : "I can register you and book a first visit. I'll ask a few questions about you, why you're coming in, and anything you need — nothing is verified until you see the clinic."}
                </p>
                <div className="mt-6 flex flex-col gap-2">
                  {starters.map((s) => (
                    <button key={s} onClick={() => send(s)} className="rounded-xl border border-line bg-white px-4 py-2.5 text-left text-[13px] text-stone-700 transition hover:border-accent hover:bg-accent-soft/40">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-4">
              {messages.map((m, i) => (
                <MessageView key={m.id} m={m} isLatest={i === latestAgentIdx && !busy} onSend={send} onUploadClick={() => fileRef.current?.click()} busy={busy} />
              ))}
              {busy && (
                <div className="flex items-start gap-3">
                  <Avatar role="agent" />
                  <div className="rounded-2xl rounded-tl-sm bg-stone-100 px-4 py-3">
                    <Dots />
                    {progress.length > 0 && (
                      <ul className="mt-2 space-y-0.5 text-[12px] text-stone-500">
                        {progress.map((p, i) => (
                          <li key={i} className={i === progress.length - 1 ? "text-stone-700" : ""}>
                            {p}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {error && <div className="mx-5 mb-2 rounded-lg bg-red-soft px-3 py-2 text-[12px] text-red">{error}</div>}

          {kase?.pendingStaffQuestions.length ? (
            <div className="mx-5 mb-2 rounded-lg border border-amber-200 bg-amber-soft px-3 py-2 text-[12px] text-amber">The clinic team is waiting for your answer above — just reply below.</div>
          ) : null}

          <div className="border-t border-line px-4 py-3">
            {pending.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {pending.map((p) => (
                  <div key={p.documentId} className="flex items-center gap-2 rounded-lg border border-line bg-stone-50 px-2 py-1.5 text-[12px]">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                    {p.mimeType.startsWith("image/") ? <img src={p.previewUrl} alt="" className="h-8 w-8 rounded object-cover" /> : <span className="text-stone-500">PDF</span>}
                    <div>
                      <div className="max-w-[160px] truncate text-stone-700">{p.name}</div>
                      {p.extraction && <div className="text-[11px] text-violet-700">Read: {p.extraction.productName ?? "unclear"} · {Math.round(p.extraction.confidence * 100)}%</div>}
                    </div>
                    <button className="text-stone-400 hover:text-stone-700" onClick={() => setPending((x) => x.filter((y) => y.documentId !== p.documentId))} aria-label="Remove">
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send(text);
              }}
            >
              <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={busy || uploading} title="Photo or document" className="flex h-10 w-10 flex-none items-center justify-center rounded-lg border border-line text-stone-600 hover:bg-stone-50 disabled:opacity-50">
                {uploading ? <Dots /> : <CameraIcon />}
              </button>
              <button type="button" onClick={toggleVoice} disabled={busy} title="Speak" className={`flex h-10 w-10 flex-none items-center justify-center rounded-lg border ${listening ? "border-red bg-red-soft text-red" : "border-line text-stone-600 hover:bg-stone-50"} disabled:opacity-50`}>
                <MicIcon />
              </button>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(text);
                  }
                }}
                rows={1}
                placeholder={listening ? "Listening…" : pending.length ? "Add a note (optional) and send" : "Type or speak — e.g. “My doctor asked me to book…”"}
                className="max-h-40 min-h-10 flex-1 resize-y rounded-lg border border-line bg-white px-3 py-2 text-[14px] text-stone-900 outline-none placeholder:text-stone-400 focus:border-accent"
                disabled={busy}
              />
              <Button type="submit" disabled={busy || uploading || (!text.trim() && pending.length === 0)} className="h-10">
                Send
              </Button>
            </form>
            <div className="mt-1.5 text-[11px] text-stone-400">CarePlus coordinates care with the clinic. It does not diagnose, prescribe or decide whether a medicine is safe for you. In an emergency call 000.</div>
          </div>
        </main>

        {/* Phone + status */}
        <aside className="order-3 space-y-4 lg:sticky lg:top-5 lg:self-start">
          <PhonePanel comms={comms} phone={data?.patient?.phone ?? (kase?.patientId.startsWith("PT-N") ? kase.patientId : "New patient")} live={Boolean(integrations.sms)} />
          {kase && (
            <div className="rounded-xl border border-line bg-panel p-4 text-[12px]">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-semibold text-stone-800">Case {kase.id}</span>
                <StatusBadge status={kase.status} />
              </div>
              <dl className="grid grid-cols-[80px_1fr] gap-y-1 text-stone-600">
                <dt className="text-stone-400">Route</dt>
                <dd>
                  <TierBadge tier={kase.tier} /> {kase.outcome ? <span className="text-stone-500">{kase.outcome.replace(/_/g, " ")}</span> : null}
                </dd>
                <dt className="text-stone-400">Updated</dt>
                <dd>{fmtTime(kase.updatedAt)}</dd>
                <dt className="text-stone-400">Steps</dt>
                <dd>{kase.trace.length} recorded</dd>
              </dl>
              <p className="mt-3 text-[11px] leading-relaxed text-stone-400">
                {kase.tier === "amber"
                  ? "A clinician is reviewing this case. Anything reserved stays reserved until they confirm."
                  : kase.tier === "red"
                    ? "Urgent instruction shown. The clinic team has been alerted."
                    : kase.status === "completed"
                      ? "Everything requested has been arranged."
                      : "Routine coordination — no staff review needed so far."}
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function MessageView({ m, isLatest, onSend, onUploadClick, busy }: { m: ChatMessage; isLatest: boolean; onSend: (t: string) => void; onUploadClick: () => void; busy: boolean }) {
  const mine = m.role === "patient";
  const questionOnly = m.role === "staff" && m.cards.some((c) => c.type === "staff_question");
  return (
    <div className={`flex items-start gap-3 ${mine ? "flex-row-reverse" : ""}`}>
      <Avatar role={m.role} />
      <div className={`max-w-[85%] ${mine ? "items-end" : ""}`}>
        {questionOnly ? null : (
        <div className={`rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed ${mine ? "rounded-tr-sm bg-accent text-white" : m.role === "staff" ? "rounded-tl-sm border border-amber-200 bg-amber-soft/60 text-stone-800" : "rounded-tl-sm bg-stone-100 text-stone-800"}`}>
          {m.role === "staff" && <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber">Clinic team</div>}
          {m.attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {m.attachments.map((a) =>
                a.previewUrl && a.mimeType.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local blob preview
                  <img key={a.documentId} src={a.previewUrl} alt={a.name} className="max-h-48 rounded-lg" />
                ) : (
                  <span key={a.documentId} className={`rounded-md px-2 py-1 text-[12px] ${mine ? "bg-teal-700/60" : "bg-stone-200"}`}>
                    📎 {a.name}
                  </span>
                ),
              )}
            </div>
          )}
          <div className="prose-chat" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />
        </div>
        )}
        {m.cards.map((card, i) => (
          <CardView key={i} card={card} onSend={onSend} onUploadClick={onUploadClick} busy={busy} isLatest={isLatest} />
        ))}
        <div className={`mt-1 text-[10px] text-stone-400 ${mine ? "text-right" : ""}`}>{fmtTime(m.at)}</div>
      </div>
    </div>
  );
}

function Avatar({ role }: { role: string }) {
  if (role === "patient") return <div className="mt-1 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-stone-200 text-[11px] font-semibold text-stone-600">You</div>;
  if (role === "staff") return <div className="mt-1 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-amber-soft text-[11px] font-semibold text-amber">Rx</div>;
  return (
    <div className="mt-1 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-accent text-white">
      <PlusIcon small />
    </div>
  );
}

function PlusIcon({ small }: { small?: boolean }) {
  const s = small ? 14 : 22;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
    </svg>
  );
}

function mergeById<T extends { id: string }>(a: T[], b: T[]): T[] {
  const map = new Map<string, T>();
  for (const x of a) map.set(x.id, x);
  for (const x of b) map.set(x.id, x);
  return Array.from(map.values()).sort((x, y) => {
    const ax = (x as unknown as { at?: string; start?: string; createdAt?: string }).at ?? (x as unknown as { start?: string }).start ?? (x as unknown as { createdAt?: string }).createdAt ?? "";
    const ay = (y as unknown as { at?: string; start?: string; createdAt?: string }).at ?? (y as unknown as { start?: string }).start ?? (y as unknown as { createdAt?: string }).createdAt ?? "";
    return ax.localeCompare(ay);
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
