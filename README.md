# VEIL — Visual Edge Inference Layer

> On-device visual perception for lightweight browser agents.
> VEIL redacts the screen on the device. Then, and only then, the server may look.

**Team:** Synapse
**Event:** Smart India Hackathon 2026 — TEKATHON-5.0
**Problem Statement:** SIH26171 (ISRO / Department of Space) — *On-device Visual Perception for Light-weight Browser Agents*
**Theme:** Smart Automation
**Status:** Phase 1 prototype — in progress

***

## What this is

VEIL is a privacy-first browser extension that lets an AI agent understand and act on what's happening in a browser tab — filling forms, clicking, navigating — **without ever sending raw screen content off the device.**

Instead of shipping a screenshot (or video) of the user's screen to a cloud model, VEIL:

1. Captures the tab locally (pixels + DOM/accessibility tree)
2. Detects sensitive content on-device — faces, passwords, emails, phone numbers, government ID numbers
3. Redacts it *before anything leaves the browser* — pixels are blurred/boxed, text is replaced with typed tokens like `[REDACTED:EMAIL]`
4. Sends only the sanitized, structured payload (the **RAAP v1** contract) to a reasoning server
5. Receives back a plain action plan — click / scroll / fill — and executes it locally

The redaction step is a hard architectural gate, not a best-effort filter: no code path exists that can send an unsanitized payload over the network.

## Why this matters

- Screen-reading agents currently require trusting a cloud model host with everything on your screen — passwords, faces, ID numbers included.
- VEIL makes that trust unnecessary: sensitive data never leaves the device in identifiable form, which matters for government/enterprise use under regulations like India's DPDP Act 2023, and makes agent-assisted workflows viable on screens that mix operational UI with identity data (KYC forms, citizen services, internal ops tools).
- The reasoning server can be cloud-hosted, on-prem, or fully air-gapped — the privacy guarantee is about *what leaves the device*, not *where the server lives*.

***

## Architecture

```
 1 · Screen        2 · Perceive         3 · VEIL filter        4 · Reasoning        5 · Act
 ───────────       ─────────────        ────────────────       ─────────────       ─────────
 Tab pixels    →   Tiny ViT +       →   Box / blur /       →   Server (VLM /   →   click
 + a11y tree        DOM/regex PII        typed tokens            stub rules)         scroll
                    detection            (the gate)              returns              fill
                                                                  action plan          — locally
```

**Capture** runs in the extension through the content script and background service worker. It grabs the visible tab and DOM/accessibility tree.

**Detect** runs in the extension on-device. The vision path flags faces and visual PII, while DOM, regex, and NER detection flags emails, phone numbers, passwords, and ID numbers.

**Redact (VEIL filter)** runs in the extension on-device. It is the gate that destructively blurs flagged pixels, replaces flagged text with typed tokens, and assembles the RAAP v1 payload.

**Reason** runs on the server through the local Phase 1 stub. It accepts a RAAP v1 payload and returns an action plan.

**Act** runs in the extension on-device. It executes returned click, scroll, and fill actions against an allowlist and never executes arbitrary instructions.

### RAAP v1 (Redacted Agent Action Protocol)

The contract between the extension and the server. Roughly:

```json
{
  "scheme_version": "RAAP-1",
  "graph": "<DOM/accessibility tree with redactions applied>",
  "redaction_map": [
    { "type": "EMAIL", "token": "[REDACTED:EMAIL]", "location": "..." },
    { "type": "FACE", "token": "[REDACTED:FACE]", "location": "..." }
  ],
  "image": "<blurred/destroyed-pixel screenshot, or omitted>"
}
```

This is the *only* shape of payload the network layer will accept — see `src/veil-filter/`.

***

## Tech stack

- **Extension client:** TypeScript, Chrome Extension Manifest V3 (Firefox WebExtensions compatibility considered, Chrome-first for the prototype)
- **On-device ML:** ONNX Runtime Web + Transformers.js, WebGPU with WASM/CPU fallback
- **Build tooling:** Vite
- **Server (Phase 1 stub):** FastAPI, Python, in-memory only — no database
- **Planned server upgrade (Phase 2):** Open-weight VLM (Qwen2.5-VL / Qwen3-VL)

***

## Project structure

```
VEIL/
├── .venv/                      # Python virtual environment (root-level, gitignored)
├── server/
│   ├── main.py                 # FastAPI stub reasoning server
│   └── requirements.txt
├── src/
│   ├── background/
│   │   └── service-worker.ts   # MV3 background service worker
│   ├── content/                # Content scripts (capture, DOM read, action execution)
│   ├── detection/               # Local PII/face detection pipeline
│   ├── metrics/
│   │   └── pipeline-metrics.ts # Stage timing + detection-count logging
│   ├── network/                # Network layer — only accepts RaapV1Payload
│   ├── popup/                  # Extension popup UI
│   ├── types/                  # Shared TypeScript contracts
│   │   ├── action.ts
│   │   ├── detection.ts
│   │   ├── messages.ts
│   │   ├── raap.ts
│   │   └── screen-state.ts
│   ├── utils/
│   └── veil-filter/             # The redaction gate — safety-critical module
├── test-page.html               # Local KYC-style demo form for testing the pipeline
├── manifest.json                 # MV3 manifest
├── package.json
├── tsconfig.json
└── vite.config.ts
```

***

## Getting started

### Prerequisites

- Node.js + npm
- Python 3.12/3.13 (install from [python.org](https://python.org) — **not** the Microsoft Store version, which causes interpreter-resolution issues with some tooling)
- Chrome (or Chromium-based browser) for loading the unpacked extension

### 1. Set up the Python server

```powershell
cd VEIL
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r server\requirements.txt
```

Run the stub reasoning server:

```powershell
python server\main.py
```

By default it serves at `http://localhost:8000`, in-memory only, no database required for Phase 1.

### 2. Set up the extension

```powershell
npm install
npm run build
```

Then load it as an unpacked extension:
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the build output folder

### 3. Try the demo

1. With the server running and the extension loaded, open `test-page.html` in the browser.
2. Open the VEIL popup and click **Turn On**.
3. Watch the pipeline panel light up through each stage (Capture → DOM Extract → Text Detect → Face Detect → Redaction → Reasoning → Execute) as it processes the form.

***

## Judge View

The popup includes a **Judge View** tab for inspecting the evidence from the latest page scan. It makes the privacy boundary visible without changing the payload sent to the reasoning server.

### On this device

The local evidence panel shows:

- A face preview captured from the active page, when a labelled face photo is detected
- Locally detected Aadhaar and password values for demonstration and verification
- Evidence marked as local-only and retained in the extension result

This evidence is assembled before redaction and is never passed to the API client.

### Sent to server

The transmitted payload panel displays the exact serialized RAAP v1 object handed to the network layer. It contains the redacted graph, typed redaction tokens, and the sanitized image representation. Raw values and the original screenshot are not included in this view of the server payload.

Run **Scan page** before opening Judge View to inspect the current scan. If a prior result does not contain its local preview data, the popup can recover that evidence from the active page without changing the RAAP v1 payload.

***

## Current phase status

### Phase 1 — Prototype (in progress)
- [x] MV3 extension scaffold
- [x] Screen capture (tab pixels + DOM/accessibility tree)
- [x] Local text/DOM PII detection (regex/NER, password field heuristics)
- [ ] Local face/visual PII detection (ONNX Runtime Web model)
- [x] VEIL redaction filter (the gate) + RAAP v1 payload construction
- [x] Stub FastAPI reasoning server (rule-based, no VLM yet)
- [ ] Action executor (click/scroll/fill against an allowlist)
- [ ] End-to-end demo flow (KYC test page)
- [ ] Pipeline metrics/logging harness
- [ ] UI pass (black/gold visual identity)

*(Update the checkboxes above as work lands — this section is meant to be the at-a-glance status tracker.)*

### Phase 2 — Real reasoning
- [ ] Swap stub server logic for an open-weight VLM (Qwen2.5-VL / Qwen3-VL)
- [ ] Multi-step workflow handling
- [ ] Canvas/video PII detection (vision path, not just DOM)

### Phase 3 — Production hardening
- [ ] Backend + persistence layer (deferred from Phase 1 by design)
- [ ] Firefox WebExtensions support
- [ ] Formal accuracy/latency benchmarking against the five ISRO scoring weights (Context 25% · PII 20% · Redaction 20% · Client 20% · Latency 15%)

***

## Known limitations (Phase 1)

- The reasoning server is a rule-based stub — it does not yet run a real VLM.
- No database or persistence layer; everything is in-memory / session-scoped, by design for this phase.
- No formal accuracy benchmarking yet — the deck's own principle applies here too: no invented accuracy claims, only what the metrics harness actually measures.
- Face/visual PII detection may still be partial depending on build status — check the checklist above for current coverage.

***

## Design principles (for anyone touching the redaction path)

- **Nothing crosses the wire until VEIL writes tokens.** The network layer's type signature should make it structurally impossible to send anything but a `RaapV1Payload`.
- **No invented claims.** Every metric reported should come from the logging harness, not an estimate.
- **Precision over completeness for Phase 1.** A working end-to-end vertical slice (capture → redact → stub-reason → act) beats a highly polished single stage with the rest missing.

***

## References

- SIH26171, ISRO / Department of Space, Smart India Hackathon 2026 — `sih2026.vuce.in/ps/SIH26171`
- Dosovitskiy et al., *An Image is Worth 16×16 Words*, ICLR 2021
- Microsoft, ONNX Runtime Web (WebGPU / WebAssembly) — `onnxruntime.ai`
- Hugging Face, Transformers.js v4 — Qwen2.5-VL / Qwen3-VL ONNX support
- Bai et al., *Qwen2.5-VL Technical Report* (2025); Qwen3-VL (2026)
- W3C, WebGPU Specification — `w3.org/TR/webgpu`
- Government of India, Digital Personal Data Protection Act, 2023 — `meity.gov.in`
- Chrome / Firefox WebExtensions, Manifest V3

***

*This README is a living document — update the phase-status checklists and architecture notes as the build progresses through each phase.*