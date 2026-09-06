"""
VEIL Stub Reasoning Server — Phase 1

FastAPI server that accepts RAAP v1 payloads and returns action plans.
Runs locally on localhost:8000, no database, in-memory only.

--- PHASE 2: PLUG VLM HERE ---
The `reason()` function currently uses simple rule-based pattern matching
against the sanitized DOM graph. In Phase 2, this would be replaced with
a call to a Vision-Language Model (Qwen2.5-VL / Qwen3-VL) that can:
  1. Understand the page layout from the redacted graph
  2. Reason about form structure and user intent
  3. Generate contextually appropriate fill values
  4. Handle multi-step workflows
--- END PHASE 2 STUB ---
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional
import time
import os

app = FastAPI(
    title="VEIL Reasoning Server (Stub)",
    version="0.1.0",
    description="Phase 1 stub — accepts RAAP v1 payloads, returns rule-based action plans",
)

# Allow requests from Chrome extensions
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Chrome extension origins are chrome-extension://<id>
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PROJECT_ROOT = os.path.join(os.path.dirname(__file__), "..")
app.mount("/assets", StaticFiles(directory=os.path.join(PROJECT_ROOT, "assets")), name="assets")


# ─── Models ───────────────────────────────────────────────────────────

class RedactedDOMNode(BaseModel):
    tag: str
    role: Optional[str] = None
    attributes: dict = {}
    textContent: Optional[str] = None
    children: list["RedactedDOMNode"] = []
    xpath: str
    cssSelector: Optional[str] = None


class RedactionEntry(BaseModel):
    type: str
    token: str
    location: dict
    confidence: float


class RedactedImage(BaseModel):
    dataUrl: str
    width: int
    height: int
    redactedRegions: int


class PipelineMetrics(BaseModel):
    timings: dict = {}
    detectionCounts: dict = {}
    totalDetections: int = 0


class RaapV1Payload(BaseModel):
    schemeVersion: str
    timestamp: int
    url: str
    graph: list[RedactedDOMNode]
    redactionMap: list[RedactionEntry]
    image: Optional[RedactedImage] = None
    metrics: PipelineMetrics


class Action(BaseModel):
    action: str
    selector: str
    value: Optional[str] = None
    description: Optional[str] = None


class ActionPlan(BaseModel):
    actions: list[Action]
    reasoning: Optional[str] = None
    confidence: float


# ─── Reasoning Logic ──────────────────────────────────────────────────

def find_inputs_in_graph(nodes: list[RedactedDOMNode]) -> list[dict]:
    """
    Walk the redacted DOM graph and find form inputs.
    Returns a list of input metadata for action generation.
    """
    inputs = []

    def walk(node: RedactedDOMNode, parent_text: str = ""):
        # Collect parent text context for labeling
        context_text = parent_text
        if node.textContent:
            context_text = node.textContent.lower()

        if node.tag == "input":
            input_info = {
                "tag": node.tag,
                "type": node.attributes.get("type", "text"),
                "name": node.attributes.get("name", ""),
                "id": node.attributes.get("id", ""),
                "placeholder": node.attributes.get("placeholder", ""),
                "autocomplete": node.attributes.get("autocomplete", ""),
                "xpath": node.xpath,
                "cssSelector": node.cssSelector or node.xpath,
                "context": context_text,
            }
            inputs.append(input_info)

        if node.tag == "textarea":
            inputs.append({
                "tag": node.tag,
                "type": "textarea",
                "name": node.attributes.get("name", ""),
                "id": node.attributes.get("id", ""),
                "placeholder": node.attributes.get("placeholder", ""),
                "autocomplete": "",
                "xpath": node.xpath,
                "cssSelector": node.cssSelector or node.xpath,
                "context": context_text,
            })

        if node.tag in ("button", "input") and node.attributes.get("type") in ("submit", "button"):
            inputs.append({
                "tag": node.tag,
                "type": "submit",
                "name": node.attributes.get("name", ""),
                "id": node.attributes.get("id", ""),
                "placeholder": node.textContent or "",
                "autocomplete": "",
                "xpath": node.xpath,
                "cssSelector": node.cssSelector or node.xpath,
                "context": context_text,
            })

        for child in node.children:
            walk(child, context_text)

    for node in nodes:
        walk(node)

    return inputs


def generate_actions(inputs: list[dict]) -> list[Action]:
    """
    Phase 1 rule-based action generation.
    Pattern-matches input types and names to generate safe fill values.

    --- PHASE 2: PLUG VLM HERE ---
    Replace this function body with a VLM call:
        result = vlm_model.generate(
            prompt=format_raap_for_vlm(payload),
            image=payload.image.dataUrl if payload.image else None,
        )
        return parse_vlm_actions(result)
    --- END PHASE 2 STUB ---
    """
    actions = []

    for inp in inputs:
        input_type = inp["type"].lower()
        name = inp["name"].lower()
        input_id = inp["id"].lower()
        placeholder = inp["placeholder"].lower()
        autocomplete = inp["autocomplete"].lower()
        selector = inp["cssSelector"]
        context = inp.get("context", "").lower()

        # Skip submit buttons for now — we'll add them at the end
        if input_type == "submit":
            continue

        # Determine what to fill based on input characteristics
        if input_type == "email" or autocomplete == "email" or "email" in name or "email" in input_id:
            actions.append(Action(
                action="fill",
                selector=selector,
                value="safe-test@example.com",
                description="Fill email field with safe placeholder",
            ))

        elif input_type == "password" or autocomplete in ("current-password", "new-password") or "password" in name:
            actions.append(Action(
                action="fill",
                selector=selector,
                value="SecureP@ss2024!",
                description="Fill password field with safe placeholder",
            ))

        elif input_type == "tel" or "phone" in name or "phone" in input_id or "tel" in name:
            actions.append(Action(
                action="fill",
                selector=selector,
                value="+91-98765-43210",
                description="Fill phone field with safe placeholder",
            ))

        elif "name" in name or "name" in input_id or "name" in placeholder or "name" in context:
            # Check for specific name types
            if "first" in name or "first" in input_id or "first" in placeholder:
                actions.append(Action(
                    action="fill",
                    selector=selector,
                    value="Jane",
                    description="Fill first name with safe placeholder",
                ))
            elif "last" in name or "last" in input_id or "last" in placeholder:
                actions.append(Action(
                    action="fill",
                    selector=selector,
                    value="Doe",
                    description="Fill last name with safe placeholder",
                ))
            else:
                actions.append(Action(
                    action="fill",
                    selector=selector,
                    value="Jane Doe",
                    description="Fill name field with safe placeholder",
                ))

        elif "aadhaar" in name or "aadhaar" in input_id or "aadhaar" in placeholder:
            actions.append(Action(
                action="fill",
                selector=selector,
                value="XXXX-XXXX-XXXX",
                description="Fill Aadhaar field with masked placeholder",
            ))

        elif "pan" in name or "pan" in input_id:
            actions.append(Action(
                action="fill",
                selector=selector,
                value="XXXXX0000X",
                description="Fill PAN field with masked placeholder",
            ))

        elif input_type == "text" and not actions:
            # Generic text input — fill with generic placeholder
            actions.append(Action(
                action="fill",
                selector=selector,
                value="Test User Input",
                description="Fill generic text field",
            ))

    # Add submit button click at the end if found
    for inp in inputs:
        if inp["type"] == "submit":
            actions.append(Action(
                action="click",
                selector=inp["cssSelector"],
                description="Click submit button",
            ))
            break  # Only click the first submit button

    return actions


def is_redacted_identity_submission(payload: RaapV1Payload, inputs: list[dict]) -> bool:
    """Recognize a protected identity form solely from its redacted shape."""
    redaction_types = {entry.type.upper() for entry in payload.redactionMap}
    has_sensitive_shape = {"FACE", "AADHAAR", "PASSWORD"}.issubset(redaction_types)
    has_submit = any(item["type"] == "submit" for item in inputs)
    return has_sensitive_shape and has_submit


# ─── Endpoints ────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "version": "0.1.0", "phase": "1-stub"}


@app.get("/test", response_class=HTMLResponse)
async def test_page():
    """Serve test page directly via HTTP."""
    test_page_path = os.path.join(PROJECT_ROOT, "test-page.html")
    with open(test_page_path, "r", encoding="utf-8") as f:
        return f.read()


@app.get("/demo-jury", response_class=HTMLResponse)
async def jury_demo_page():
    """Serve the self-contained jury scenario with its local placeholder asset."""
    demo_path = os.path.join(PROJECT_ROOT, "demo-jury.html")
    with open(demo_path, "r", encoding="utf-8") as f:
        return f.read()


@app.post("/reason", response_model=ActionPlan)
async def reason(payload: RaapV1Payload):
    """
    Accept a RAAP v1 payload and return an action plan.

    Phase 1: Rule-based pattern matching against the sanitized DOM graph.
    Phase 2: VLM-based reasoning with visual understanding.
    """
    start_time = time.time()

    # Validate the payload
    if payload.schemeVersion != "RAAP-1":
        return ActionPlan(actions=[], reasoning="Invalid scheme version", confidence=0.0)

    # Log what we received
    print(f"\n{'='*60}")
    print(f"[VEIL Server] Received RAAP-1 payload")
    print(f"  URL: {payload.url}")
    print(f"  Redactions: {len(payload.redactionMap)}")
    print(f"  Has image: {payload.image is not None}")
    print(f"  Metrics: {payload.metrics.totalDetections} detections")

    for entry in payload.redactionMap:
        print(f"    - {entry.type}: {entry.token} (confidence: {entry.confidence:.2f})")

    # Find inputs in the graph
    inputs = find_inputs_in_graph(payload.graph)
    print(f"  Found {len(inputs)} interactive elements")

    # A fully redacted identity-submission form is ready to submit. This rule
    # intentionally keys off the payload graph/redaction map, never the URL.
    if is_redacted_identity_submission(payload, inputs):
        submit = next(item for item in inputs if item["type"] == "submit")
        actions = [Action(
            action="click",
            selector=submit["cssSelector"],
            description="Submit protected identity verification",
        )]
        reasoning = "Matched redacted identity form shape; submit is the only required action"
    else:
        actions = generate_actions(inputs)
        reasoning = f"Phase 1 rule-based: matched {len(inputs)} inputs, generated {len(actions)} actions"

    elapsed = (time.time() - start_time) * 1000
    print(f"  Generated {len(actions)} actions in {elapsed:.1f}ms")
    for action in actions:
        print(f"    → {action.action}: {action.selector} = {action.value or '(click)'}")
    print(f"{'='*60}\n")

    return ActionPlan(
        actions=actions,
        reasoning=reasoning,
        confidence=0.75,  # Fixed confidence for rule-based matching
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
