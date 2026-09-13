# CarePlus

**An autonomous patient-intake and care-coordination agent for clinics, built on Google Cloud (Firestore, Cloud Storage, Vertex AI, TxGemma), Google Calendar, Slack, OpenAI and public medication registries.**

Live demo: https://careplus-697390864676.us-central1.run.app

Demo video: https://storage.googleapis.com/bm-match-footage/cws.mp4

A patient tells CarePlus what happened once. CarePlus reads their clinic record, asks only for what is missing (a photo of the bottle, a discharge letter), resolves the medicine against authoritative sources, runs a bounded molecular research signal through TxGemma, and then completes the next administrative step: it holds the right appointment in Google Calendar, sends the SMS, and opens a staff review in Slack only if the case needs a human. Routine cases finish on their own.

Built for the Multi-App Agent Hackathon. Everything in this repository is synthetic; see [Scope and non-claims](#scope-and-non-claims).

> **What it is:** a multi-step agent that gathers, resolves, schedules, notifies, routes and records across seven external systems, with a deterministic policy engine deciding what it may do on its own.
> **What it is not:** a diagnosis or treatment tool. CarePlus never diagnoses, prescribes, changes medicines, determines causation or declares a medicine safe. Those limits are enforced in the system prompt (`src/agent/`), the tool surface and the routing engine (`src/core/policy/`), not only in this document.

## Project overview

### The problem

Clinic front desks spend their day on coordination, not medicine: "my doctor said to book three things", "I reacted to something like this before but can't remember what", "I need wheelchair access", "I'm new, which appointment do I book?". Each of these needs history, missing evidence, a lookup in an authoritative source, a scheduling decision with dependencies, a confirmation, and sometimes a clinician's eye. Today a human does all of it, or the patient gives up.

### What CarePlus does

In one conversation CarePlus:

1. **Reconstructs history** from the clinic record in Firestore: prior appointments, patient-reported medicines, care-plan tasks, accessibility preferences, prior agent conversations, staff corrections.
2. **Asks for missing evidence** and reads it. A photo of a bottle, blister pack or discharge summary goes through Gemini vision OCR (`src/specialists/`). Extracted text is shown back with a confidence score and does not become record until the patient confirms it.
3. **Resolves the medicine** against authoritative sources: RxNorm (brand to generic to ingredients), PubChem (canonical SMILES, formula, CID) and openFDA (official label: warnings, contraindications, adverse reactions).
4. **Runs TxGemma**, Google's open therapeutics model on a dedicated Vertex AI endpoint, on the confirmed molecule's SMILES. Tasks (ClinTox, blood-brain barrier, hERG, skin reaction, CYP inhibition) are selected from what the patient reported. The output is labelled everywhere as a research signal for the clinic team, is compared against the official label, and is never shown as a clinical verdict.
5. **Routes deterministically.** A clinic-authored policy engine (`src/core/policy/policyEngine.ts`), not the LLM, decides the tier:
   - **Green**: fully autonomous. Book allowed appointment types, send confirmations, record preferences, transfer records.
   - **Amber**: reversible preparation, then review. Hold the slot, gather evidence, open one staff review, keep the patient informed. Triggers include prior adverse experience, uncertain medicine match, a new medicine alongside a high-monitoring one (for example warfarin), post-discharge changes, conflicting records, TxGemma-vs-label disagreement.
   - **Red**: clinic-authored red-flag rules (`src/core/policy/redFlags.ts`) screen every message before the LLM sees it. Ordinary workflow stops, the approved urgent instruction is shown with a call action, staff are alerted.
6. **Takes real actions**: dependency-aware bookings in Google Calendar (blood test, results window, follow-up), SMS to the patient, evidence to Cloud Storage, a Block Kit review card in Slack with buttons staff can press.
7. **Closes the loop with staff.** Staff ask the Slack bot or the web console "Why was CP-1043 routed for review?" and get the answer from the case's decision trace, with every fact tagged by provenance. They click **Ask patient: date of last dose**; the question appears in the patient's chat and phone, and the answer comes back to the review.

### Who uses it

| Role | Surface | What they get |
| --- | --- | --- |
| Existing patient (verified record) | `/portal/<id>`: text, voice, camera | History reconstructed, missing evidence requested, next step completed, receipt |
| Prospective patient (no record) | `/portal/prospective` | Conversational intake, a provisional and clearly labelled self-reported record, first visit booked |
| Clinic staff | Slack private channel or `/staff` | Exceptions only. Review cards with actions; questions about any case; decision trace |
| Research coordinator | `/research` | De-identified study pre-screens with consent status; recurring molecular signals |

### Provenance is first-class

Every fact carries one of `patient_reported · document_extracted · database_verified · model_predicted · staff_confirmed · clinic_policy` (`src/core/types.ts`). The UI shows the tag; the coordinator reasons with it; staff can ask "which facts came from a document and which from the patient?" and get two lists. A prospective patient's record is labelled *Provisional · self-reported* until the clinic verifies it.

### Walkthrough

1. Open `/`, pick **Maya Lin**. Say: "My doctor recommended this cough medicine, but I took something similar last year and became dizzy. I can't remember what it was. Can you help me arrange a medication review?" CarePlus finds the unconfirmed June 2025 dizziness report in her record and asks for the bottle.
2. Upload `public/demo/promethazine-bottle.png`. Gemini reads the label; the card shows the extraction and confidence. Confirm it.
3. In one turn CarePlus resolves the medicine (RxNorm, PubChem, openFDA), runs TxGemma on both ingredients, routes amber (prior adverse experience), holds a video medication review with her usual GP in Google Calendar, sends the SMS, stores the photo in Cloud Storage and opens one staff review.
4. In Slack or `/staff`, ask "Why was this routed for review?"; the answer comes from the trace. Click **Ask patient: date of last dose**; the question lands on Maya's phone. She answers; the reviewer sees it. **Confirm appointment** turns the hold into a booking and Maya gets the confirmation.

Other personas exercise the other paths: **Arjun** (three dependency-aware bookings including wheelchair-accessible physio, fully autonomous), **Lucia** (Portuguese; routine asthma review booked and a medication review held for a prior rash), **Tom** (post-discharge, unsure what to book), **Grace** (research pre-screen with consent plus records transfer), **I'm new here** (prospective intake).

## External apps used

CarePlus takes actions across these systems. "Live" means the code path runs against the real service; nothing below is a stub.

| # | App / service | Role in the workflow | Actions taken | Status |
| --- | --- | --- | --- | --- |
| 1 | **Google Cloud Firestore** (Native mode, database `careplus`) | Canonical case store: patients, facts, cases, documents, medications, appointments, care tasks, communications, staff reviews, counters | Read/write on every turn; transactional counters for `CP-…` / `SR-…` refs | Live |
| 2 | **Google Cloud Storage** | Evidence store for uploaded photos/PDFs; the case record keeps only the `gs://` pointer; the UI gets short-lived V4 signed URLs | Upload on ingest, signed read for the portal and staff console | Live |
| 3 | **Vertex AI: TxGemma 2B** (`txgemma-2b-predict`, Model Garden, dedicated endpoint) | Molecular research signal on the confirmed compound's SMILES using the TDC prompt templates shipped with the model | `predict` per (molecule × task) | Live |
| 4 | **Vertex AI: Gemini 3.1 Flash Lite** | Vision OCR of bottle/blister/discharge images; fast red-flag classifier (historical vs current mention) | `generateContent` with JSON schema | Live |
| 5 | **Google Calendar API** (service account owns the clinic calendar) | Holds and books appointments with clinician rosters, rooms, accessibility and dependency constraints; reschedules by cancelling the superseded event | `freebusy.query`, `events.insert / patch / delete`, calendar shared to staff | Live |
| 6 | **Slack** (Bolt, Socket Mode, Block Kit) | Clinic exception console: review cards with *Confirm appointment · Ask patient · Assign pharmacist · Dismiss*; @mention / DM / thread questions answered from the decision trace | `chat.postMessage`, `chat.update`, `views.open`, interactive actions | Live: cards post from the deployed service; button handling via `npm run slack` (Socket Mode). Web console at `/staff` mirrors the same cards |
| 7 | **RxNorm** (NLM) · **PubChem** (PUG REST) · **openFDA** (drug label) | Authoritative medicine identity, molecule record, official label text | REST lookups | Live, public |

The home page (`/`) shows which integrations are connected in the running instance.

### What is real and what is simulated

| Real | Simulated |
| --- | --- |
| Every external call in the table above | The clinic, its roster, rooms and appointment types (`src/data/clinic.ts`) |
| Firestore documents, Cloud Storage objects, Calendar events, Slack review cards (posted from the deployed service), SMS | The five patients and their histories (`src/data/patients.ts`) |
| TxGemma and Gemini inference on Vertex AI | The phone, when Twilio credentials are absent (virtual phone panel in the portal) |
| RxNorm, PubChem and openFDA lookups | The staff console, when Slack tokens are absent (`/staff` renders the same cards) |
| Hosting on Cloud Run (the live demo above) | |

## Setup instructions

### Prerequisites

- Node 20+
- A Google Cloud project with the Firestore, Cloud Storage, Vertex AI and Google Calendar APIs enabled, and a service-account key (or `gcloud auth application-default login`)
- An OpenAI API key
- Optional: Slack app tokens, Twilio credentials

### 1. Install and configure

```bash
git clone https://github.com/tayyab415/careplus && cd careplus
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY`, `COORDINATOR_MODEL` (`gpt-5.6-luna`), `COORDINATOR_REASONING` (`low`) | Coordinator LLM |
| `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_APPLICATION_CREDENTIALS` | GCP auth (SA key auto-detected at `./secrets/careplus-agent.json`, else ADC) |
| `STORE_BACKEND` (`firestore` default \| `memory`), `FIRESTORE_DATABASE` (`careplus`) | Case store |
| `EVIDENCE_BUCKET` | Cloud Storage bucket for uploads |
| `FAST_MODEL`, `VISION_MODEL` (`gemini-3.1-flash-lite`) | Vertex-served Gemini for OCR and the classifier |
| `TXGEMMA_ENDPOINT_ID`, `TXGEMMA_DEDICATED_DNS`, `TXGEMMA_LOCATION` | TxGemma endpoint |
| `CLINIC_CALENDAR_ID`, `CALENDAR_SHARE_WITH` | Clinic calendar (created by the SA on first use and shared with you) |
| `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_TRIAGE_CHANNEL` | Slack exception console |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Real SMS |
| `PUBLIC_BASE_URL` | Portal link appended to every SMS |
| `CAREPLUS_DRY_RUN` | Simulate every external action (useful for CI) |

### 2. Google Cloud

```bash
gcloud services enable firestore.googleapis.com storage.googleapis.com aiplatform.googleapis.com calendar-json.googleapis.com
gcloud firestore databases create --database=careplus --location=us-central1 --type=firestore-native
gsutil mb -l us-central1 gs://<your-evidence-bucket>
gcloud iam service-accounts create careplus-agent
# roles: datastore.user, storage.objectAdmin, aiplatform.user
gcloud iam service-accounts keys create secrets/careplus-agent.json --iam-account careplus-agent@<project>.iam.gserviceaccount.com
```

**TxGemma:** in Vertex AI Model Garden open *TxGemma*, choose *Deploy* for `txgemma-2b-predict` (one L4 is enough). Then:

```bash
gcloud ai endpoints list --region=us-central1          # TXGEMMA_ENDPOINT_ID
gcloud ai endpoints describe <id> --region=us-central1  # dedicatedEndpointDns -> TXGEMMA_DEDICATED_DNS
```

The Firestore database is seeded with the synthetic clinic and five synthetic patients on first request.

### 3. Slack (optional; the web console at `/staff` stands in otherwise)

1. [api.slack.com/apps](https://api.slack.com/apps): *Create New App*, *From an app manifest*, paste `slack-app-manifest.yaml`.
2. Install to workspace; copy the Bot User OAuth Token to `SLACK_BOT_TOKEN`.
3. Basic Information, App-Level Tokens: create one with `connections:write` and copy it to `SLACK_APP_TOKEN`.
4. Create a private channel, invite the bot, put its ID in `SLACK_TRIAGE_CHANNEL`.

### 4. Run

```bash
npm run dev          # http://localhost:3000 - portal, staff console, research view
npm run slack        # Socket-Mode Slack bot (separate terminal, needs tokens)
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Patient portal, staff console (`/staff`), research view (`/research`) |
| `npm run eval [scenario…]` | End-to-end scenario harness with assertions (see [Reliability testing](#reliability-testing)) |
| `npm run smoke -- <specialist> "…"` | Exercise one specialist in isolation: `resolver`, `txgemma`, `vision`, `redflag`, `slots`, `calendar` |
| `npm run typecheck` | `tsc --noEmit` |

Demo images are in `public/demo/` (`promethazine-bottle.png`, `amoxicillin-blister.png`).

### 5. Deploy to Cloud Run

`./deploy.sh` builds the image with Cloud Build, deploys the `careplus` service with the `careplus-agent` service account, mounts `OPENAI_API_KEY`, the SA key and (when present) the Slack tokens from Secret Manager, and sets `PUBLIC_BASE_URL` to the service's own URL. Nothing from `.env` or `./secrets` is baked into the image; the one-time project setup is listed at the bottom of the script.

```bash
./deploy.sh              # build + deploy
SKIP_BUILD=1 ./deploy.sh # redeploy the last image
```

Hosted instance: https://careplus-697390864676.us-central1.run.app

## Reliability testing

Reliability is designed in, then measured.

### Designed in

- **The LLM does not route.** It must call `evaluate_routing`; the policy engine (`src/core/policy/policyEngine.ts`) returns the tier and what may be booked. Clinic rules are data (`src/data/clinic.ts`), not prompt text.
- **Red flags are screened before the model sees the message** (`src/core/policy/redFlags.ts`): keyword rules, plus a fast classifier used only to distinguish a historical mention ("I had chest pain last year, it was reflux") from a current one. Safety never depends on the coordinator behaving.
- **Nothing extracted from an image becomes record until the patient confirms it.** Extraction confidence is stored and shown.
- **TxGemma is bounded.** It only receives a SMILES string; its output is typed (`TxGemmaSignal`), labelled `model_predicted`, compared with the official label, and a disagreement is itself an amber trigger. Regression tasks were removed from auto-selection after evaluation showed low-quality outputs at 2B.
- **Idempotent side effects.** One open staff review per case (later findings update it rather than duplicate it); re-booking the same appointment type cancels the superseded hold in Calendar; SMS is sent only when something changed for the patient; portal URLs in SMS are generated by the system, never by the model.
- **Bounded tool loop** with a forced summary turn if the budget is exhausted, so the patient always gets a real reply (`src/agent/coordinator.ts`).
- **Retries with backoff** on Vertex 429/503; graceful degradation when an integration is missing (virtual phone, web staff console, in-memory store), reported on the home page rather than silently.
- **Firestore-safe records.** Evidence goes to Cloud Storage and only the pointer is stored, keeping case documents well under the 1 MiB limit (a full Maya case is about 30 KB).

### Measured: `npm run eval`

`scripts/eval.ts` drives the real coordinator, real tools and real external APIs (Vertex Gemini, TxGemma, RxNorm/PubChem/openFDA, Calendar in dry-run) through scripted multi-turn patient conversations on a fresh store, then asserts on the outcomes, cumulatively across turns: cards rendered, tier chosen, appointments held or booked, reviews created, TxGemma tasks selected, SMS content.

| Scenario | Path exercised | Key assertions |
| --- | --- | --- |
| `maya` | Prior adverse experience, photo, confirm, amber | `evidence_request` card on turn 1; extraction confirm card; RxNorm exact match; ClinTox and BBB signals; held video review with usual GP; exactly one staff review; SMS carries no clinical detail |
| `arjun` | Three linked instructions from GP | Blood test booked before follow-up with results window; wheelchair-accessible physio location chosen; green, no staff review |
| `tom` | Post-discharge, unsure what to book | Discharge PDF extracted; medication change routes amber; correct appointment type chosen |
| `lucia` | Non-English (Portuguese), prior rash | Replies in Portuguese; `Skin_Reaction` TxGemma task selected; routine asthma review booked and medication review held; one review |
| `grace` | Research interest plus records transfer | Study pre-screen with explicit consent; records-transfer task; no eligibility claim made |
| `red` | Current chest pain | Red flag fires before the LLM; urgent card; urgent staff alert; no booking |
| `historical-not-red` | "Chest pain last year, it was reflux" | Does not trip red; proceeds as routine |
| `prospective` | New patient, no record | Intake questions asked conversationally; provisional record labelled self-reported; `slot_options` card; first visit booked |

**Current result: 8 / 8 scenarios passing.** Each run prints the agent's replies, cards, decision trace and every external action, so regressions in behaviour, not only crashes, are visible. The harness was the primary instrument for tuning routing and prompts; the fixes it drove (duplicate reviews, invented URLs, missing upload control, over-eager SMS, symptom-to-label matching) are all now assertions.

```bash
npm run eval                 # all scenarios
npm run eval maya red        # a subset
```

### Also verified

- `npm run typecheck` clean; `npm run lint` clean.
- End-to-end browser run of the Maya flow against live Firestore, Cloud Storage, Calendar and Vertex: case, document pointer, appointment, review and SMS all present in Firestore; photo present in the bucket; staff console reads the same record.
- Specialist smoke tests (`npm run smoke`) for each external dependency in isolation.

## Demo video

**Demo (under 2 minutes):** _link to be added_

What the video shows, in order: Maya's request; history found; bottle photo read and confirmed; RxNorm/PubChem/openFDA and TxGemma in one turn; amber routing; Calendar hold and SMS on the phone; Slack review card; "Why was this routed?" answered from the trace; *Ask patient* lands on the phone; staff confirms; booking receipt.

## Architecture

```
Patient portal (Next.js 15)  ── text · voice · photo/PDF ──▶  /api/chat (SSE)
                                                                  │
                                       Red-flag screen (deterministic, before the LLM)
                                                                  │
                                   Coordinator — GPT 5.6 Luna, tool-calling loop (20+ typed tools)
                                                                  │
   ┌───────────────┬────────────────┬───────────────┬─────────────┴──────┬──────────────────┬────────────────────┐
 Firestore       Gemini 3.1       RxNorm ·        openFDA          TxGemma 2B          Policy engine        Actions
 case store      Flash Lite       PubChem         official         Vertex AI            clinic-authored      Google Calendar (SA)
 + Cloud Storage vision OCR       identity +      label            dedicated endpoint   red / amber / green  SMS (Twilio / virtual phone)
 evidence        + classifier     SMILES                           TDC prompts                               Slack review cards + Q&A
```

**Who decides what.** The coordinator gathers, asks, resolves and explains. The policy engine decides the tier. Red-flag rules run first. TxGemma only sees SMILES and only produces a labelled research signal. Staff have the last word on anything amber.

### Code map

```
src/agent/          coordinator loop, system prompt, tool definitions + handlers, context builder
src/core/policy/    red-flag screen, routing engine
src/core/types.ts   zod schemas: Fact (provenance), Patient, Case, StaffReview, Card, TxGemmaSignal…
src/core/store/     CaseStore interface; Firestore (default) + in-memory implementations
src/specialists/    vision label extractor · RxNorm/PubChem/openFDA resolver · TxGemma client + TDC task selection
src/actions/        scheduler + Google Calendar · evidence (Cloud Storage) · messaging (Twilio/virtual phone) · Slack cards · staff reviews
src/data/           synthetic clinic (roster, rooms, appointment types, red-flag rules, studies) + 5 synthetic patients
src/app/            portal, staff console, research view, API routes
scripts/            eval.ts (scenario harness) · smoke.ts · slack-bot.ts
deploy.sh           Cloud Run build + deploy
slack-app-manifest.yaml
```

### TxGemma

`txgemma-2b-predict` from Vertex AI Model Garden on a dedicated endpoint. Prompts are the TDC templates shipped with the model (`src/specialists/txgemma/tdc_prompts.json`). Tasks are chosen from what the patient reported: dizziness or drowsiness selects `BBB_Martins`; rash selects `Skin_Reaction`; palpitations select `hERG`; interaction concerns select the CYP tasks; `ClinTox` is always on. Each signal is compared with the official label's adverse-reactions section and recorded as corroborating context or as a disagreement (an amber trigger). It is presented to staff, not used to advise the patient.

## Scope and non-claims

All patients, clinicians, records and the clinic are synthetic; no real health information is used. CarePlus coordinates care; it does not diagnose, prescribe, alter medication, determine causation, declare a medicine safe or determine trial eligibility. Running on Google Cloud does not make this a compliance, privacy or security design; a real clinic deployment would need one, deliberately. This repository is a prototype demonstrating autonomous, bounded, auditable multi-app coordination.
