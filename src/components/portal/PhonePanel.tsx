"use client";

import type { Communication } from "@/core/types";
import { fmtTime } from "@/lib/ui";

/**
 * A "virtual phone". When Twilio is not configured every SMS CarePlus sends lands here
 * instead, so the demo still shows the patient receiving confirmations and staff
 * questions in real time.
 */
export function PhonePanel({ comms, phone, live }: { comms: Communication[]; phone?: string; live: boolean }) {
  const sms = comms.filter((c) => c.channel === "sms");
  return (
    <div className="mx-auto w-[260px] rounded-[2rem] border-[6px] border-stone-900 bg-stone-950 p-2 shadow-xl">
      <div className="flex h-[440px] flex-col overflow-hidden rounded-[1.5rem] bg-stone-100">
        <div className="flex items-center justify-between bg-stone-200/80 px-4 pb-2 pt-3 text-[11px] text-stone-600">
          <span>{phone ?? "—"}</span>
          <span className="font-medium">{live ? "Twilio · live" : "Simulated SMS"}</span>
        </div>
        <div className="border-b border-stone-200 bg-white px-4 py-2 text-center text-[12px] font-semibold text-stone-800">Harbourside Clinic</div>
        <div className="scroll-thin flex-1 space-y-2 overflow-y-auto px-3 py-3">
          {sms.length === 0 && <p className="pt-16 text-center text-[12px] text-stone-400">Confirmations and questions from the clinic arrive here.</p>}
          {sms.map((c) => (
            <div key={c.id} className={`flex ${c.direction === "outbound" ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[12px] leading-snug ${c.direction === "outbound" ? "rounded-bl-sm bg-white text-stone-800 shadow-sm" : "rounded-br-sm bg-accent text-white"}`}>
                <SmsBody body={c.body} />
                <div className={`mt-1 text-[10px] ${c.direction === "outbound" ? "text-stone-400" : "text-teal-100"}`}>
                  {fmtTime(c.at)}
                  {c.status === "failed" ? " · failed" : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SmsBody({ body }: { body: string }) {
  const parts = body.split(/(https?:\/\/\S+)/g);
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} className="underline" target="_blank" rel="noreferrer">
            {p.replace(/^https?:\/\//, "").slice(0, 34)}
            {p.length > 42 ? "…" : ""}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  );
}
