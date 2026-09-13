# CarePlus

### Tell the clinic once. CarePlus carries the case forward.

**An evidence-aware coordination agent for clinics.**

> "I remember the dizziness. I don't remember the medicine."

That is where CarePlus starts. Maya, a fictional patient, does not know the right appointment type or the exact medicine name. CarePlus reads her existing clinic history, asks for the missing label, waits for her to confirm the transcription, resolves the active ingredient, prepares a medication-review appointment, and sends the unresolved history to staff. When staff asks a follow-up question, it appears back in Maya's conversation.

CarePlus does not answer and disappear. It keeps the case moving.

`144 deterministic tests` · `12/12 live routing scenarios` · `6 connected services` · `5 synthetic patient profiles`

CarePlus is autonomous about coordination, not treatment. It does not diagnose, prescribe, change medication, infer causation, or decide that a medicine is safe.

## More than a medical chatbot

A chatbot can summarize Maya's message. CarePlus has to maintain a case, gather evidence, take a permitted action, and leave a trace:

1. Load the correct patient's synthetic history.
2. Decide whether it has enough evidence for the requested clinic workflow.
3. Ask for a label only when medication identity is missing.
4. Keep OCR output untrusted until the patient accepts or rejects it.
5. Resolve active ingredients through RxNorm, PubChem, and DailyMed without turning a database match into a clinical conclusion.
6. Offer an allowed appointment and require explicit confirmation before the write.
7. Produce a receipt that says which effects are real and which are simulated.
8. Send unresolved facts to staff, then return the staff's follow-up to the patient.

The coordinator proposes the next action. The application enforces evidence, consent, access, idempotency, and state-transition rules before anything changes.

```text
Patient website
      |
      v
GPT-5.6 Luna coordinator  --->  validated decision  --->  policy and state engine
      |                                                     |
      | asks for evidence                                   +--> simulated appointment + receipt
      v                                                     +--> staff exception console
Gemini label transcription                                 +--> Firestore case record
      |
      v
RxNorm + PubChem + DailyMed
      |
      v
TxGemma research adapter, isolated from care routing
```

## One story, one closed loop

```text
Maya asks for a medication review
  -> CarePlus finds an unresolved past reaction in her clinic history
  -> Maya uploads a label or uses the attributed DailyMed demo image
  -> Gemini transcribes product text and active ingredients
  -> Maya confirms or rejects the transcription
  -> RxNorm resolves the ingredient and PubChem returns a molecular identity
  -> DailyMed returns official label candidates with scope kept explicit
  -> CarePlus offers appointment slots and waits for consent
  -> the simulated booking is written once and a receipt is issued
  -> the unresolved past reaction appears in the staff console
  -> staff asks when the final dose was taken
  -> the question arrives in Maya's patient conversation
  -> "I don't remember" remains an unknown fact, not a guessed answer
```

The demo stays focused on Maya. Four other profiles test whether the same agent can handle different case states instead of replaying one script:

| Profile | What it tests |
|---|---|
| Noor | Wheelchair and interpreter requests whose availability is not yet confirmed |
| Leo | Patient-reported and imported medication records that disagree |
| Sam | A routine follow-up supported by an existing care plan |
| Alex | A new patient with no clinic history |

## One case, six connected services

CarePlus currently exercises six external services across one case. The state-changing delivery adapters are intentionally simulated until a real clinic chooses the destination accounts.

| External system | What CarePlus uses it for | Current status |
|---|---|---|
| Google Cloud Firestore | Canonical synthetic case state, decisions, evidence, receipts, and the patient-to-staff loop | Live in the configured local run |
| OpenAI API | `gpt-5.6-luna` coordinator calls that return structured next-action decisions | Live when a key is configured |
| Google Gemini API | Prescription-label transcription with separate active-ingredient and visible-text fields | Live when a key is configured |
| NIH RxNorm API | Exact ingredient identity lookup | Live public API |
| NIH PubChem API | CID, stereochemical SMILES, and InChIKey lookup for resolved ingredients | Live public API |
| NIH DailyMed API | Candidate official labels, with no claim that a candidate proves the photographed product | Live public API |
| Appointment calendar | Slot offer, explicit confirmation, replay protection, and receipt | Simulated provider |
| Clinic staff inbox / Slack path | Exception brief and staff follow-up action | In-app console works; Slack delivery is simulated |
| Patient delivery | Confirmation receipt and staff question | In-app inbox works; SMS and email are simulated |

The distinction matters. A green check from a mock calendar is not a real clinic booking. Every receipt names the boundary.

## TxGemma without the hand-waving

TxGemma is the project's molecular specialist. It is not the coordinator and it cannot decide urgency, safety, diagnosis, dose, treatment, or access to care.

The adapter is built around two initial Therapeutics Data Commons classification prompts:

- `BBB_Martins`, a research task for blood-brain barrier penetration
- `ClinTox`, a research task based on clinical-trial toxicity and FDA approval labels

This repository does **not** claim a live TxGemma result yet. The official prompt artifact is gated; an attempt with the available Hugging Face token returned HTTP 403. No paid Vertex deployment was provisioned or live-verified. Earlier brainstorm results were generated by Gemini prompted to act like TxGemma. They are not TxGemma evidence and are excluded from this README.

Instead of silently substituting another model, `careplus/txgemma.py` fails closed. Before a paid prediction it verifies:

- a pinned official TxGemma-Predict checkpoint and commit revision
- approved prompt and artifact hashes
- the Vertex endpoint, deployed model ID, model version, container image, and 100 percent traffic destination
- a unique reviewed PubChem identity with stereochemistry-preserving SMILES
- an exact one-token classification response tied to the verified deployment and input digest

The current adapter requires a pinned deployment manifest and the future `careplus-txgemma-identity-v1` runtime identity report. No custom container implements that protocol yet, and the resolver does not supply the required chemistry-validation metadata. An ordinary Model Garden endpoint alone cannot enable inference.

Unsupported tasks, mixtures, disconnected salts, ambiguous identities, altered manifests, wrong traffic splits, malformed output, authentication failures, and provider failures return `abstained` or `unavailable`. Gemini is never used as a fallback. Completed research is stored separately and never enters the coordinator's routing context.

The point is not to put TxGemma in a diagram. It is to make a molecular model useful while proving which model, prompt, molecule, deployment, and output produced every result.

Read the [TxGemma specialist contract and evaluation plan](docs/research/txgemma.md).

## Built to be caught when it is wrong

A completed request is not automatically a correct result. CarePlus records the evidence, model decision, state change, and receipt so failures can be inspected after the run.

### Current verified results

Run on September 13, 2026:

| Check | Result | What it covers |
|---|---|---|
| Deterministic test suite | **144 passed** | Access isolation, consent, request replay, stale writes, urgent-stop precedence, evidence rejection, coordinator validation, research isolation, and TxGemma deployment-contract failures |
| Live Luna regression | **12 of 12 passed** | Missing history, unavailable label, routine follow-up, new patient, accommodations, conflicting records, staff questions, prompt injection, research requests, current versus historical urgent wording, and an unknown request |
| End-to-end API run | Corrected journey passed in 22.20 seconds | Firestore, live Luna, active-only Gemini OCR, exact RxNorm salt identity, PubChem CID 8980, confirmation-triggered replanning, simulated booking, staff follow-up, and access denial. Molecular work abstained; no genuine TxGemma prediction claimed |
| Browser journey | Blocked by T3 preview failure | An API success is not presented as proof that the patient and staff screens work |
| Genuine TxGemma inference | Not yet verified | The adapter and contract tests exist, but no authorized endpoint result is claimed |

The post-fix Luna run had a 2.33-second median latency for model-backed cases and required no response repairs. Keep Luna for this build; a Sol comparison is not needed to continue.

Run the deterministic suite:

```bash
uv run pytest -q
```

Run the live coordinator regression. This makes provider calls and may incur API charges:

```bash
PYTHONPATH=. uv run python scripts/evaluate.py --model gpt-5.6-luna
```

With the development server running, exercise the full API journey:

```bash
PYTHONPATH=. uv run python scripts/journey.py
```

The live run saves complete artifacts under `.local/evals/` so a failure can be inspected rather than reduced to an HTTP status. The evaluation is a small regression suite, not clinical validation or a generalization benchmark.

### Failure cases covered by tests

- A repeated booking request cannot create a second appointment.
- Reusing a request ID with different input is a conflict.
- One patient's token cannot read another patient's case.
- A rejected OCR result never reaches ingredient lookup.
- An inactive ingredient cannot enter molecular research.
- Current urgent wording preempts an existing offer, while quoted or historical wording does not.
- Coordinator output with invented citations or unsupported observations gets one repair attempt, then fails closed.
- Research output is removed from the coordinator context, so changing it cannot change clinic routing.
- A tampered TxGemma manifest, prompt, container, model version, traffic split, response identity, or output format blocks the prediction.
- Accessibility support remains unconfirmed until a clinic-owned system or staff member confirms it.

## What you can run today

| Area | Current implementation |
|---|---|
| Patient experience | Text conversation, five fictional profiles, image upload, transcription review, appointment choices, case status, evidence, and receipts |
| Staff experience | Exception queue, full evidence and decision trace, and a follow-up action that updates the patient's conversation |
| Case storage | Firestore by default, with an explicit SQLite option for local tests. There is no silent cloud-to-local fallback |
| Coordinator | Live structured OpenAI calls checked against the current case, permitted actions, quoted observations, and evidence IDs |
| Document flow | JPEG, PNG, or WebP validation, size limits, SHA-256 fingerprinting, Gemini transcription, and mandatory patient confirmation |
| Medication evidence | RxNorm ingredient lookup, PubChem molecular identity, and scoped DailyMed label candidates |
| Scheduling | Two deterministic demo slots, explicit consent, idempotent confirmation, and an honest simulated receipt |
| Access boundary | Per-case bearer token, separate local staff session, host/origin checks, CSP, no-store responses, and loopback-only serving |
| Molecular research | A fail-closed TxGemma Vertex adapter and deployment identity contract, without a claimed live model result |
| Voice | Not implemented |
| Public deployment | Not implemented. The server binds to `127.0.0.1` |

Use synthetic data only. This is not a production clinic portal, a validated triage system, or evidence of regulatory compliance.

## Run CarePlus locally

Requirements:

- Python 3.11 or newer
- [`uv`](https://docs.astral.sh/uv/)
- OpenAI and Gemini keys for live coordinator and OCR calls
- Google Application Default Credentials and a Firestore project, unless you deliberately select SQLite

```bash
git clone https://github.com/tayyab415/careplus.git
cd careplus
uv sync
cp -n .env.example .env
scripts/dev.sh
```

Open `http://127.0.0.1:8090`.

The server binds to loopback because the profile picker and staff-role switch are demo controls, not authentication suitable for a public clinic. Do not expose it through a tunnel without replacing those controls.

Set credentials in `.env` or the process environment:

```ini
OPENAI_API_KEY=
CAREPLUS_COORDINATOR_MODEL=gpt-5.6-luna
GEMINI_API_KEY=
CAREPLUS_VISION_MODEL=gemini-3.1-flash-lite
GOOGLE_CLOUD_PROJECT=
CAREPLUS_STORE=firestore
CAREPLUS_COLLECTION=careplus_demo_v1
```

For local storage instead of Firestore:

```ini
CAREPLUS_STORE=sqlite
```

This changes storage only. It does not replace live model calls with fixtures. Never commit keys, print tokens, or upload real patient records.

## The two-minute demo

The planned two-minute demo still needs a verified recording:

> **Demo video:** pending

The strongest recording is one complete loop, not a tour of every screen:

1. Start with Maya's request.
2. Show that CarePlus reads the unresolved history and asks for evidence.
3. Upload or select the public DailyMed sample, then confirm the transcription.
4. Confirm a simulated appointment and pause on the receipt.
5. Open the staff console and inspect why the case needs review.
6. Send "When was the final dose?" back to Maya.
7. End on the case trace and the explicit TxGemma boundary.

## Repository map

```text
careplus/
  app.py             FastAPI routes and local access boundary
  coordinator.py     structured Luna planner and output validation
  engine.py          case state, evidence, actions, receipts, and staff loop
  specialists.py     Gemini OCR, RxNorm, PubChem, and DailyMed adapters
  txgemma.py         pinned Vertex deployment contract and fail-closed parser
static/               patient and staff web interface
scripts/evaluate.py   live coordinator regression suite
scripts/journey.py    end-to-end HTTP journey and artifact capture
tests/                deterministic state, policy, API, coordinator, and TxGemma tests
docs/                 architecture, recovered product intent, research, and handoff
```

Further reading:

- [Architecture and safety boundaries](docs/ARCHITECTURE.md)
- [Recovered product intent](docs/context/brainstorm-recovery.md)
- [TxGemma sources and serving contract](docs/research/txgemma.md)
- [Current handoff and unresolved work](docs/HANDOFF.md)

## What comes next

1. Record a clean post-fix live journey and complete browser verification.
2. Connect a clinic-owned calendar, private Slack channel, and patient delivery target with signed callbacks and provider receipts.
3. Obtain authorized TxGemma artifacts, approve a time-limited Vertex budget, deploy the pinned endpoint, and publish genuine task evaluation results.
4. Replace the demo identity controls, move uploaded images to private object storage, define retention and deletion, then review a Cloud Run deployment.
5. Add voice only after transcript handling, consent, and action replay are tested as a separate path.

The pitch is simple: finish the coordination work, show the evidence, and never disguise an unknown as an answer.
