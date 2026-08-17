"""
DIYhomie — Visual Evidence, Measurement & AR Guidance Engine (Build Document 5).

Helps homeowners capture the RIGHT photo/measurement and understand visual results with an
explicit confidence boundary and a usable fallback. Visual evidence should reduce uncertainty,
not manufacture false certainty.

Rules:
  - Ask for the right image, not more images (purpose-driven capture templates).
  - Measurements stay traceable to their source (value+unit preserved, deterministic conversion).
  - AR is assistive guidance, never safety authorization (2D fallback always available).
  - Every visual inference includes a confidence status; high-risk inferences are blocked.

Namespace: /api/hi/visual/*  (+ admin /api/hi/admin/visual/*). Reuses gr_evidence / gr_issues.
"""
import re
import uuid
from datetime import datetime, timezone
from typing import Callable, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None
_llm_key = None

# Purpose-driven capture templates (P0) — "ask for the right image".
CAPTURE_TEMPLATES = {
    "wide_context": {"purpose": "Show the whole area and its surroundings",
                     "framing": "Stand back so the full wall/surface and nearby features are visible",
                     "distance": "2-3 metres / 6-10 ft", "orientation": "Landscape, level",
                     "reference_scale": None, "privacy_reminder": "Avoid capturing personal documents or people",
                     "will_infer": "General layout and where the problem sits", "wont_infer": "Exact cause or hidden conditions"},
    "close_up": {"purpose": "Show the condition in detail",
                 "framing": "Fill the frame with the affected spot, keep it sharp",
                 "distance": "20-40 cm / 8-16 in", "orientation": "Steady, good light",
                 "reference_scale": None, "privacy_reminder": "Crop out anything sensitive",
                 "will_infer": "Visible surface condition", "wont_infer": "What's behind the surface"},
    "before_after": {"purpose": "Compare condition over time",
                     "framing": "Match the same angle and distance as the earlier photo",
                     "distance": "Same as prior photo", "orientation": "Same as prior photo",
                     "reference_scale": None, "privacy_reminder": None,
                     "will_infer": "Visible change between photos", "wont_infer": "Whether the fix is permanent"},
    "with_measurement": {"purpose": "Show size using a reference object",
                         "framing": "Place a tape measure or a known object (coin, card) beside the subject",
                         "distance": "Close enough to read the scale", "orientation": "Scale flat and in focus",
                         "reference_scale": "Tape measure or known-size object", "privacy_reminder": None,
                         "will_infer": "Approximate size relative to the reference", "wont_infer": "Precise engineering dimensions"},
    "label_model": {"purpose": "Read a model / serial label",
                    "framing": "Fill the frame with the label, no glare",
                    "distance": "10-20 cm / 4-8 in", "orientation": "Straight-on, well lit",
                    "reference_scale": None, "privacy_reminder": "Hide serial numbers before sharing externally",
                    "will_infer": "Printed model/brand text", "wont_infer": "Warranty or recall status"},
    "inspection_video": {"purpose": "Show movement, sound or a walk-around",
                         "framing": "Slow pan across the area, keep it steady",
                         "distance": "As needed", "orientation": "Landscape", "reference_scale": None,
                         "privacy_reminder": "Mute or avoid recording private conversations",
                         "will_infer": "Visible/audible behaviour", "wont_infer": "Root cause with certainty"},
}
MEASURE_TYPES = ["length", "width", "height", "depth", "diameter", "clearance", "angle", "slope"]
MEASURE_INSTRUCTIONS = {
    "length": "Measure end-to-end along the longest side. Keep the tape straight and taut.",
    "width": "Measure across the shortest side, perpendicular to the length.",
    "height": "Measure vertically from the base to the top; keep the tape plumb.",
    "depth": "Measure straight back from the front edge to the deepest point.",
    "diameter": "Measure across the widest point through the centre of the circle.",
    "clearance": "Measure the open gap between the two nearest surfaces.",
    "angle": "Use a level/angle tool; note degrees from horizontal.",
    "slope": "Measure rise over run, or degrees from horizontal.",
}
CONFIDENCE_LEVELS = ["confirmed_by_user", "likely", "needs_better_evidence", "cannot_determine_safely", "professional_verification_required"]
ANNOTATION_KINDS = ["point", "box", "arrow", "measurement_line", "label", "inspect_here"]
ANNOTATION_AUTHORS = ["homeowner", "household_member", "homie_suggestion", "admin_reference"]
AR_USE_CASES = ["inspection_area", "measure_location", "component_orientation", "clearance_zone", "assembly_sequence"]

# High-risk targets we NEVER authorize from an image (observation only).
_HIGH_RISK = ["conceal", "behind the wall", "wiring", "electrical panel", "gas line", "gas",
              "structural", "load bearing", "load-bearing", "beam", "foundation crack",
              "hidden moisture", "moisture extent", "asbestos", "lead", "mold extent", "code", "permit"]
# Length unit conversion factors to millimetres (deterministic).
_TO_MM = {"mm": 1.0, "cm": 10.0, "m": 1000.0, "in": 25.4, "ft": 304.8}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


def configure(db, logger, llm_key):
    global _db, _logger, _llm_key
    _db, _logger, _llm_key = db, logger, llm_key


async def _cap(user_id, event, props=None):
    try:
        import analytics_engine
        await analytics_engine.capture({"id": user_id}, event, props or {})
    except Exception:
        pass


async def _owned_issue(iid, uid):
    issue = await _db.gr_issues.find_one({"id": iid, "user_id": uid}, {"_id": 0})
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found.")
    return issue


def _convert(value: float, unit: str):
    """Deterministic conversion — preserves original, adds metric + imperial views."""
    if unit not in _TO_MM or value is None:
        return {"original": {"value": value, "unit": unit}}
    mm = value * _TO_MM[unit]
    return {"original": {"value": value, "unit": unit},
            "mm": round(mm, 2), "cm": round(mm / 10.0, 3), "m": round(mm / 1000.0, 4),
            "in": round(mm / 25.4, 3), "ft": round(mm / 304.8, 4)}


async def _vision_infer(image_base64: str, target: Optional[str]) -> dict:
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
        chat = LlmChat(api_key=_llm_key, session_id=_nid(), system_message=(
            "You analyse a home-repair photo to reduce uncertainty WITHOUT inventing certainty. "
            "Identify only what is plainly visible. Rank alternative interpretations. If the image is "
            "dark, blurry, or the subject isn't clearly visible, say the evidence is insufficient. "
            "You must NEVER claim to see concealed wiring, gas lines, structural load paths, hidden "
            "moisture extent, hazardous materials, or code compliance. Return STRICT JSON: "
            "{\"detected\": short label, \"condition\": one honest sentence, \"confidence\": one of "
            "[likely, needs_better_evidence, cannot_determine_safely], \"alternatives\": array of "
            "strings, \"region_hint\": short where-to-look string, \"next_action\": one safe next step}."
        )).with_model("openai", "gpt-4o")
        out = await chat.send_message(UserMessage(
            text=f"Analyse this photo. Target of interest: {target or 'the visible problem'}. Return only the JSON.",
            file_contents=[ImageContent(image_base64)]))
        s = (out or "").strip()
        if s.startswith("```"):
            s = re.sub(r"^```[a-zA-Z]*\n?|\n?```$", "", s).strip()
        from json import loads
        return loads(s)
    except Exception as e:
        if _logger:
            _logger.warning(f"visual inference failed: {e}")
        return {}


# ----------------------------------------------------------------- models
class CaptureReqIn(BaseModel):
    template: str
    task_id: Optional[str] = None
    note: Optional[str] = None


class MeasurementIn(BaseModel):
    measure_type: str
    value: float
    unit: str
    source_method: str = "manual"  # manual | camera_assisted | device_assisted
    confidence: str = "confirmed_by_user"
    note: Optional[str] = None
    evidence_id: Optional[str] = None


class AnnotationIn(BaseModel):
    annotations: List[dict]
    author: str = "homeowner"


class InferIn(BaseModel):
    base64: str
    target: Optional[str] = None
    task_id: Optional[str] = None


class CorrectIn(BaseModel):
    corrected_label: str


class ARSessionIn(BaseModel):
    use_case: str
    device_capable: bool = False
    task_id: Optional[str] = None


# ----------------------------------------------------------------- user router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/visual")

    @r.get("/templates")
    async def templates(user: dict = Depends(get_current_user)):
        return {"capture_templates": CAPTURE_TEMPLATES, "measure_types": MEASURE_TYPES,
                "measure_instructions": MEASURE_INSTRUCTIONS, "confidence_levels": CONFIDENCE_LEVELS,
                "annotation_kinds": ANNOTATION_KINDS, "ar_use_cases": AR_USE_CASES}

    @r.post("/issues/{iid}/capture-request")
    async def capture_request(iid: str, req: CaptureReqIn, user: dict = Depends(get_current_user)):
        await _owned_issue(iid, user["id"])
        tpl = CAPTURE_TEMPLATES.get(req.template)
        if not tpl:
            raise HTTPException(status_code=400, detail="Unknown capture template.")
        doc = {"id": _nid(), "issue_id": iid, "user_id": user["id"], "template": req.template,
               "task_id": req.task_id, "note": (req.note or "")[:300] or None, "status": "requested", "created_at": _now()}
        await _db.gr_capture_requests.insert_one(dict(doc)); doc.pop("_id", None)
        await _cap(user["id"], "visual_capture.requested", {"template": req.template})
        return {"capture_request": doc, "guidance": {"template": req.template, **tpl}}

    # ---------------- Measurements ----------------
    @r.post("/issues/{iid}/measurements")
    async def add_measurement(iid: str, req: MeasurementIn, user: dict = Depends(get_current_user)):
        await _owned_issue(iid, user["id"])
        if req.measure_type not in MEASURE_TYPES:
            raise HTTPException(status_code=400, detail="Unsupported measurement type.")
        if req.source_method not in ("manual", "camera_assisted", "device_assisted"):
            raise HTTPException(status_code=400, detail="Invalid source method.")
        doc = {"id": _nid(), "issue_id": iid, "user_id": user["id"], "measure_type": req.measure_type,
               "value": req.value, "unit": req.unit, "source_method": req.source_method,
               "confidence": req.confidence if req.confidence in CONFIDENCE_LEVELS else "confirmed_by_user",
               "note": (req.note or "")[:300] or None, "evidence_id": req.evidence_id,
               "conversion": _convert(req.value, req.unit), "created_at": _now()}
        await _db.gr_measurements.insert_one(dict(doc)); doc.pop("_id", None)
        # Also file a lightweight evidence entry so the project remembers it.
        await _db.gr_evidence.insert_one({"id": _nid(), "issue_id": iid, "user_id": user["id"], "type": "measurement",
                                          "note": f"{req.measure_type}: {req.value} {req.unit}" + (f" — {req.note}" if req.note else ""),
                                          "value": req.value, "unit": req.unit, "base64": None, "_had_media": False, "created_at": _now()})
        await _cap(user["id"], "measurement.recorded", {"type": req.measure_type, "source": req.source_method})
        return {"measurement": doc}

    @r.get("/issues/{iid}/measurements")
    async def list_measurements(iid: str, user: dict = Depends(get_current_user)):
        await _owned_issue(iid, user["id"])
        rows = await _db.gr_measurements.find({"issue_id": iid}, {"_id": 0}).sort("created_at", -1).to_list(200)
        return {"measurements": rows}

    @r.delete("/measurements/{mid}")
    async def delete_measurement(mid: str, user: dict = Depends(get_current_user)):
        res = await _db.gr_measurements.delete_one({"id": mid, "user_id": user["id"]})
        if res.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Measurement not found.")
        return {"ok": True}

    # ---------------- Annotations ----------------
    @r.post("/evidence/{eid}/annotations")
    async def add_annotations(eid: str, req: AnnotationIn, user: dict = Depends(get_current_user)):
        ev = await _db.gr_evidence.find_one({"id": eid, "user_id": user["id"]}, {"_id": 0, "base64": 0})
        if not ev:
            raise HTTPException(status_code=404, detail="Evidence not found.")
        author = req.author if req.author in ANNOTATION_AUTHORS else "homeowner"
        clean = []
        for a in (req.annotations or [])[:40]:
            if not isinstance(a, dict) or a.get("kind") not in ANNOTATION_KINDS:
                continue
            clean.append({"kind": a["kind"], "x": a.get("x"), "y": a.get("y"), "w": a.get("w"), "h": a.get("h"),
                          "points": a.get("points"), "label": str(a.get("label") or "")[:120] or None})
        prev = await _db.gr_annotations.count_documents({"evidence_id": eid})
        doc = {"id": _nid(), "evidence_id": eid, "issue_id": ev.get("issue_id"), "user_id": user["id"],
               "version": prev + 1, "author": author, "is_suggestion": author == "homie_suggestion",
               "annotations": clean, "created_at": _now()}
        await _db.gr_annotations.insert_one(dict(doc)); doc.pop("_id", None)
        await _cap(user["id"], "visual_annotation.created", {"count": len(clean), "author": author})
        return {"annotation_set": doc}

    @r.get("/evidence/{eid}/annotations")
    async def get_annotations(eid: str, user: dict = Depends(get_current_user)):
        ev = await _db.gr_evidence.find_one({"id": eid, "user_id": user["id"]}, {"_id": 0, "base64": 0})
        if not ev:
            raise HTTPException(status_code=404, detail="Evidence not found.")
        rows = await _db.gr_annotations.find({"evidence_id": eid}, {"_id": 0}).sort("version", -1).to_list(50)
        return {"annotation_sets": rows}

    # ---------------- Visual inference ----------------
    @r.post("/issues/{iid}/infer")
    async def infer(iid: str, req: InferIn, user: dict = Depends(get_current_user)):
        await _owned_issue(iid, user["id"])
        if not req.base64:
            raise HTTPException(status_code=400, detail="A photo is required.")
        await _cap(user["id"], "visual_inference.generated", {})
        target_l = (req.target or "").lower()
        high_risk = any(k in target_l for k in _HIGH_RISK)
        # Basic quality precheck (very small payload -> low quality).
        quality_warning = len(req.base64) < 800
        if quality_warning:
            await _cap(user["id"], "visual_capture.quality_warning_shown", {})
        result = await _vision_infer(req.base64, req.target)
        conf = result.get("confidence") if result.get("confidence") in ("likely", "needs_better_evidence", "cannot_determine_safely") else "needs_better_evidence"
        if high_risk:
            conf = "professional_verification_required"
        if quality_warning and conf == "likely":
            conf = "needs_better_evidence"
        doc = {"id": _nid(), "issue_id": iid, "user_id": user["id"],
               "detected": str(result.get("detected") or "")[:200] or "Unclear",
               "condition": str(result.get("condition") or "")[:400] or "Not enough detail to be sure.",
               "confidence": conf, "alternatives": [str(x)[:160] for x in (result.get("alternatives") or [])][:5],
               "region_hint": str(result.get("region_hint") or "")[:200] or None,
               "next_action": str(result.get("next_action") or "Add a clearer, well-lit close-up.")[:300],
               "high_risk_blocked": high_risk, "quality_warning": quality_warning,
               "authorizes_action": False, "created_at": _now()}
        await _db.gr_visual_inferences.insert_one(dict(doc)); doc.pop("_id", None)
        if conf in ("cannot_determine_safely", "professional_verification_required"):
            try:
                await _db.gr_visual_quality.insert_one({"id": _nid(), "issue_id": iid, "user_id": user["id"],
                                                        "reason": "safety_visual_uncertainty", "confidence": conf,
                                                        "status": "open", "created_at": _now()})
            except Exception:
                pass
        return {"inference": doc}

    @r.post("/inferences/{fid}/correct")
    async def correct_inference(fid: str, req: CorrectIn, user: dict = Depends(get_current_user)):
        res = await _db.gr_visual_inferences.update_one({"id": fid, "user_id": user["id"]},
                                                        {"$set": {"detected": req.corrected_label.strip()[:200],
                                                                  "confidence": "confirmed_by_user", "corrected": True, "corrected_at": _now()}})
        if res.matched_count == 0:
            raise HTTPException(status_code=404, detail="Inference not found.")
        await _cap(user["id"], "visual_inference.corrected", {})
        try:
            await _db.gr_visual_quality.insert_one({"id": _nid(), "user_id": user["id"], "reason": "recognition_disagreement", "status": "open", "created_at": _now()})
        except Exception:
            pass
        return {"ok": True}

    # ---------------- AR guidance (assistive only; always has 2D fallback) ----------------
    @r.post("/issues/{iid}/ar-session")
    async def ar_session(iid: str, req: ARSessionIn, user: dict = Depends(get_current_user)):
        await _owned_issue(iid, user["id"])
        if req.use_case not in AR_USE_CASES:
            raise HTTPException(status_code=400, detail="Unsupported AR use case.")
        fallback = not req.device_capable
        doc = {"id": _nid(), "issue_id": iid, "user_id": user["id"], "use_case": req.use_case,
               "task_id": req.task_id, "device_capable": req.device_capable,
               "mode": "fallback_2d" if fallback else "ar", "status": "started", "created_at": _now()}
        await _db.gr_ar_sessions.insert_one(dict(doc)); doc.pop("_id", None)
        await _cap(user["id"], "ar_guidance.fallback_used" if fallback else "ar_guidance.started", {"use_case": req.use_case})
        return {"session": doc,
                "safety_notice": "AR is guidance only — always physically verify slope, clearance and safety. Never use an overlay as the sole approval for drilling, cutting, electrical, gas or structural work.",
                "fallback_instructions": ("Your device doesn't support stable AR here. Use the annotated-image guide instead: mark the inspect/measure point on a photo." if fallback else None),
                "requires_native_build": True}

    return r


# ----------------------------------------------------------------- admin router
def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/visual", dependencies=[Depends(require_admin)])

    @r.get("/quality")
    async def quality(status: str = "open", admin: dict = Depends(require_admin)):
        q = {} if status == "all" else {"status": status}
        rows = await _db.gr_visual_quality.find(q, {"_id": 0}).sort("created_at", -1).to_list(300)
        counts = {}
        for reason in ("safety_visual_uncertainty", "recognition_disagreement", "capture_failure", "ar_alignment_failure"):
            counts[reason] = await _db.gr_visual_quality.count_documents({"reason": reason, "status": "open"})
        return {"items": rows, "counts": counts,
                "measurements": await _db.gr_measurements.count_documents({}),
                "inferences": await _db.gr_visual_inferences.count_documents({}),
                "ar_sessions": await _db.gr_ar_sessions.count_documents({})}

    return r


async def seed_visual():
    if _db is None:
        return
    try:
        await _db.gr_measurements.create_index("issue_id")
        await _db.gr_annotations.create_index("evidence_id")
        await _db.gr_visual_inferences.create_index("issue_id")
        await _db.gr_capture_requests.create_index("issue_id")
        await _db.gr_ar_sessions.create_index("issue_id")
        await _db.gr_visual_quality.create_index("status")
        if _logger:
            _logger.info("visual evidence & measurement engine (Build Doc 5) seeded")
    except Exception as e:
        if _logger:
            _logger.error(f"visual engine seed failed: {e}")
