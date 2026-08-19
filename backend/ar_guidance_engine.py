"""
DIYhomie — AR Step-by-Step Visual Guidance Runtime (Build Blueprint 27).

Provider-AGNOSTIC AR guidance runtime. True AR overlays (Unity / AR Foundation / ARKit /
ARCore) run only in a native build; this engine owns everything that is provider-independent
and always testable: eligibility + safety gating, spatial-context resolution, guidance content
building from APPROVED project steps, the session state machine, per-instruction confirmation,
outcome recording, and a strict fallback hierarchy (AR -> 2D visual -> text -> professional).

Hard rules honored: AR is OPTIONAL and never blocks text guidance; every session is tied to a
room/asset/project/work-item; AR never claims hidden stud/wire/pipe/structural locations or
professional precision without verified inputs (unverified => "Estimated"); project progress
updates ONLY after explicit user confirmation; safety-critical steps are gated out.

Collections: ar_sessions, ar_anchors, ar_instructions, ar_outcomes, ar_settings.
"""
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

GUIDANCE_TYPES = ["orientation_marker", "placement_marker", "measurement_marker", "component_highlight",
                  "sequence_overlay", "safe_zone", "no_drill_zone_future", "before_after_overlay",
                  "checklist_anchor", "inspection_marker"]
ELIGIBILITY = ["AVAILABLE", "LIMITED", "UNAVAILABLE", "NOT_RECOMMENDED", "PROFESSIONAL_REQUIRED"]
SESSION_STATES = ["created", "calibrating", "active", "paused", "completed", "failed", "cancelled"]
OUTCOME_RESULTS = ["completed", "abandoned", "insufficient_tracking", "unsupported_device",
                   "safety_escalated", "user_cancelled"]

# Categories/keywords where AR could create false confidence => not recommended / professional.
PROFESSIONAL_KEYWORDS = ["electrical panel", "breaker", "service panel", "gas line", "gas pipe",
                         "structural", "load-bearing", "load bearing", "roof", "asbestos", "lead paint",
                         "main water line", "sewer main", "furnace", "wiring a circuit"]
HAZARD_HINT = ["electrical", "gas", "roof", "height", "ladder", "chemical", "mold", "high voltage"]

# ================================================================ Doc 40 — reusable action vocabulary
# One reusable primitive per PHYSICAL action; never one-off per-project animations.
# anchor types: world | object | component | surface | edge | point | path | plane
ACTION_PRIMITIVES = {
    "LOOSEN_BOLT":    {"motion": "ROTATE_COUNTERCLOCKWISE", "tool": "adjustable_wrench", "direction": "counterclockwise", "anchor": "component", "visuals": ["object_outline", "ghost_tool", "rotation_arrow"]},
    "TIGHTEN_BOLT":   {"motion": "ROTATE_CLOCKWISE", "tool": "adjustable_wrench", "direction": "clockwise", "anchor": "component", "visuals": ["object_outline", "ghost_tool", "rotation_arrow"]},
    "DRIVE_SCREW":    {"motion": "ROTATE_CLOCKWISE", "tool": "drill", "direction": "clockwise", "anchor": "point", "visuals": ["target_ring", "ghost_tool", "rotation_arrow"]},
    "REMOVE_SCREW":   {"motion": "ROTATE_COUNTERCLOCKWISE", "tool": "screwdriver", "direction": "counterclockwise", "anchor": "component", "visuals": ["object_outline", "ghost_tool", "rotation_arrow"]},
    "DRILL":          {"motion": "DRILL", "tool": "drill", "direction": "forward", "anchor": "point", "visuals": ["target_crosshair", "ghost_tool", "keep_out_zone"]},
    "HAMMER":         {"motion": "HAMMER", "tool": "hammer", "direction": None, "anchor": "point", "visuals": ["target_dot", "ghost_tool"]},
    "TAP_JOINT":      {"motion": "TAP", "tool": "rubber_mallet", "direction": None, "anchor": "edge", "visuals": ["edge_highlight", "ghost_tool", "direction_arrow"]},
    "PRY":            {"motion": "PRY", "tool": "pry_bar", "direction": None, "anchor": "edge", "visuals": ["edge_highlight", "ghost_tool", "direction_arrow"]},
    "CUT":            {"motion": "CUT", "tool": "utility_knife", "direction": None, "anchor": "path", "visuals": ["cut_line", "ghost_tool", "start_point", "end_point"]},
    "SAW":            {"motion": "CUT", "tool": "handsaw", "direction": None, "anchor": "path", "visuals": ["cut_line", "ghost_tool"]},
    "MEASURE":        {"motion": "MEASURE", "tool": "tape_measure", "direction": None, "anchor": "point", "visuals": ["start_point", "end_point", "distance_indicator"]},
    "MARK":           {"motion": "MARK", "tool": "pencil", "direction": None, "anchor": "point", "visuals": ["target_dot", "alignment_guide"]},
    "LEVEL_CHECK":    {"motion": "ALIGN", "tool": "level", "direction": None, "anchor": "surface", "visuals": ["level_indicator", "alignment_guide"]},
    "APPLY_TAPE":     {"motion": "SLIDE", "tool": "painters_tape", "direction": None, "anchor": "edge", "visuals": ["tape_line", "edge_highlight", "path_line"]},
    "CUT_IN_EDGE":    {"motion": "BRUSH", "tool": "paint_brush", "direction": None, "anchor": "edge", "visuals": ["edge_highlight", "path_line", "ghost_tool"]},
    "ROLL_SURFACE":   {"motion": "ROLL", "tool": "paint_roller", "direction": None, "anchor": "surface", "visuals": ["surface_highlight", "path_line", "ghost_tool"]},
    "APPLY_COMPOUND": {"motion": "SPREAD", "tool": "drywall_knife", "direction": None, "anchor": "surface", "visuals": ["surface_highlight", "ghost_tool"]},
    "EMBED_TAPE":     {"motion": "SMOOTH", "tool": "drywall_knife", "direction": None, "anchor": "path", "visuals": ["path_line", "ghost_tool"]},
    "SAND_SURFACE":   {"motion": "SMOOTH", "tool": "sanding_block", "direction": None, "anchor": "surface", "visuals": ["surface_highlight", "ghost_tool"]},
    "SCRAPE":         {"motion": "SCRAPE", "tool": "scraper", "direction": None, "anchor": "surface", "visuals": ["surface_highlight", "ghost_tool"]},
    "CAULK_PATH":     {"motion": "CAULK", "tool": "caulk_gun", "direction": None, "anchor": "path", "visuals": ["path_line", "start_point", "end_point", "ghost_tool"]},
    "PLACE_OBJECT":   {"motion": "LOWER", "tool": None, "direction": None, "anchor": "surface", "visuals": ["ghost_object", "alignment_guide"]},
    "ALIGN_OBJECT":   {"motion": "SLIDE", "tool": None, "direction": None, "anchor": "object", "visuals": ["object_outline", "alignment_guide", "direction_arrow"]},
    "LIFT_OBJECT":    {"motion": "LIFT", "tool": None, "direction": "up", "anchor": "object", "visuals": ["object_outline", "direction_arrow"]},
    "CLOSE_SHUTOFF":  {"motion": "ROTATE_CLOCKWISE", "tool": None, "direction": "clockwise", "anchor": "component", "visuals": ["object_outline", "rotation_arrow"]},
    "OPEN_SHUTOFF":   {"motion": "ROTATE_COUNTERCLOCKWISE", "tool": None, "direction": "counterclockwise", "anchor": "component", "visuals": ["object_outline", "rotation_arrow"]},
    "DISCONNECT_SUPPLY": {"motion": "TWIST", "tool": "pliers", "direction": "counterclockwise", "anchor": "component", "visuals": ["object_outline", "ghost_tool", "rotation_arrow"]},
    "RECONNECT_SUPPLY": {"motion": "TWIST", "tool": None, "direction": "clockwise", "anchor": "component", "visuals": ["object_outline", "rotation_arrow"]},
    "INSPECT":        {"motion": "POINT", "tool": "flashlight", "direction": None, "anchor": "surface", "visuals": ["surface_highlight", "target_ring"]},
    "CHECK_FOR_LEAK": {"motion": "POINT", "tool": "flashlight", "direction": None, "anchor": "component", "visuals": ["object_outline", "inspection_marker"]},
    "FIND_STUD":      {"motion": "SLIDE", "tool": "stud_finder", "direction": None, "anchor": "surface", "visuals": ["surface_highlight", "ghost_tool", "target_dot"]},
    "WIPE_CLEAN":     {"motion": "WIPE", "tool": None, "direction": None, "anchor": "surface", "visuals": ["surface_highlight"]},
}

TOOL_LIBRARY = [
    {"id": t, "label": t.replace("_", " ").title(), "grip_point": True, "interaction_point": True,
     "rotation_axis": t in ("adjustable_wrench", "screwdriver", "drill", "socket_wrench", "impact_driver")}
    for t in ["tape_measure", "pencil", "level", "square", "chalk_line", "screwdriver", "drill", "impact_driver",
              "adjustable_wrench", "socket_wrench", "pliers", "hammer", "rubber_mallet", "pry_bar", "utility_knife",
              "handsaw", "circular_saw", "jigsaw", "paint_brush", "paint_roller", "putty_knife", "drywall_knife",
              "scraper", "caulk_gun", "trowel", "grout_float", "stud_finder", "flashlight", "laser_measure",
              "clamp", "tile_spacer", "sanding_block", "painters_tape"]
]

ANCHOR_TYPES = ["world", "object", "component", "surface", "edge", "point", "path", "plane"]
VISUAL_OBJECTS = ["target_dot", "target_ring", "target_crosshair", "object_outline", "surface_highlight",
                  "edge_highlight", "corner_highlight", "path_line", "direction_arrow", "rotation_arrow",
                  "start_point", "end_point", "cut_line", "tape_line", "keep_out_zone", "alignment_guide",
                  "level_indicator", "distance_indicator", "angle_indicator", "ghost_object", "ghost_tool",
                  "inspection_marker"]

# Doc 40 §10 — action packages: reusable sequences, NOT isolated project animations.
ACTION_PACKAGES = {
    "painting": {"label": "Painting a wall", "actions": [
        ("INSPECT", "Look over the wall for damage or grease before you start."),
        ("APPLY_TAPE", "Run tape along this edge, pressing it flat as you go."),
        ("CUT_IN_EDGE", "Load your brush lightly and cut in a steady band along the taped edge."),
        ("ROLL_SURFACE", "Roll a W pattern in this section, then fill it in without lifting the roller."),
        ("INSPECT", "Check for thin spots or drips while the paint is still wet."),
        ("ROLL_SURFACE", "Apply the second coat the same way once the first coat is dry."),
    ]},
    "toilet_replacement": {"label": "Replacing a toilet", "actions": [
        ("CLOSE_SHUTOFF", "Turn the shutoff valve clockwise until it stops."),
        ("DISCONNECT_SUPPLY", "Twist the supply-line nut counterclockwise. Keep a towel underneath."),
        ("LOOSEN_BOLT", "Place your wrench on this bolt and turn counterclockwise to loosen it."),
        ("LIFT_OBJECT", "Lift the toilet straight up with your legs, not your back."),
        ("SCRAPE", "Scrape the old wax seal off the flange completely."),
        ("PLACE_OBJECT", "Set the new seal centered on the flange."),
        ("ALIGN_OBJECT", "Lower the toilet so both bolts pass through the base holes."),
        ("TIGHTEN_BOLT", "Tighten each bolt a little at a time, alternating sides. Snug, not cranked."),
        ("RECONNECT_SUPPLY", "Reconnect the supply line hand-tight plus a quarter turn."),
        ("OPEN_SHUTOFF", "Open the shutoff counterclockwise all the way."),
        ("CHECK_FOR_LEAK", "Flush twice and check around the base and supply line for any water."),
    ]},
    "drywall_repair": {"label": "Repairing drywall", "actions": [
        ("FIND_STUD", "Slide the stud finder across the wall and mark where it signals."),
        ("MARK", "Mark your cut lines around the damaged area."),
        ("CUT", "Score along this line with steady, repeated passes."),
        ("PLACE_OBJECT", "Position the backing strip inside the opening."),
        ("DRIVE_SCREW", "Drive a screw here until the head sits just below the surface."),
        ("APPLY_COMPOUND", "Spread a thin, even layer of compound over the patch."),
        ("EMBED_TAPE", "Press the tape into the compound and smooth it flat."),
        ("APPLY_COMPOUND", "Feather a wider second coat past the edges."),
        ("SAND_SURFACE", "Sand lightly in circles until the patch blends flush."),
    ]},
    "flooring": {"label": "Installing plank flooring", "actions": [
        ("MEASURE", "Measure the room width so your last row won't be a sliver."),
        ("PLACE_OBJECT", "Set the first board with the expansion gap against this wall."),
        ("ALIGN_OBJECT", "Slide the next board into the joint at a low angle."),
        ("TAP_JOINT", "Tap the joint closed with the mallet and a tapping block."),
        ("MEASURE", "Measure the final piece for this row."),
        ("MARK", "Mark the cut line on the board."),
        ("SAW", "Cut along the line, finished side up."),
    ]},
}

_ACTION_KEYWORDS = [
    (["loosen", "unbolt"], "LOOSEN_BOLT"), (["tighten bolt", "tighten the bolt", "tighten nut", "snug"], "TIGHTEN_BOLT"),
    (["unscrew", "remove screw", "remove the screw", "back out"], "REMOVE_SCREW"),
    (["drive screw", "screw in", "fasten", "secure with screw"], "DRIVE_SCREW"),
    (["drill"], "DRILL"), (["hammer", "nail"], "HAMMER"), (["pry"], "PRY"),
    (["stud finder", "find the stud", "locate stud"], "FIND_STUD"),
    (["saw"], "SAW"), (["cut", "score"], "CUT"),
    (["measure", "distance"], "MEASURE"), (["mark"], "MARK"), (["level"], "LEVEL_CHECK"),
    (["tape off", "painter's tape", "apply tape", "tape the"], "APPLY_TAPE"),
    (["cut in", "cut-in", "brush along"], "CUT_IN_EDGE"),
    (["roll", "roller"], "ROLL_SURFACE"),
    (["compound", "mud", "joint compound", "spackle"], "APPLY_COMPOUND"),
    (["embed tape", "mesh tape", "paper tape"], "EMBED_TAPE"),
    (["sand"], "SAND_SURFACE"), (["scrape", "remove old"], "SCRAPE"),
    (["caulk", "sealant", "bead of"], "CAULK_PATH"),
    (["shut off", "shutoff", "turn off the water", "close the valve"], "CLOSE_SHUTOFF"),
    (["turn the water back on", "open the valve", "restore water"], "OPEN_SHUTOFF"),
    (["disconnect the supply", "disconnect supply"], "DISCONNECT_SUPPLY"),
    (["reconnect", "reattach the supply"], "RECONNECT_SUPPLY"),
    (["leak", "check for water"], "CHECK_FOR_LEAK"),
    (["lift"], "LIFT_OBJECT"), (["align"], "ALIGN_OBJECT"),
    (["place", "position", "set the", "lay"], "PLACE_OBJECT"),
    (["wipe", "clean the"], "WIPE_CLEAN"),
    (["inspect", "check", "verify", "look for"], "INSPECT"),
]


def compose_action(instr_text: str, safety_note=None) -> dict:
    """Doc 40 §8 — map a step instruction to a structured, reusable visual-instruction payload.
    Deterministic keyword mapping; Unity/AR layer consumes this, never free text."""
    t = (instr_text or "").lower()
    action_id = next((a for kws, a in _ACTION_KEYWORDS if any(k in t for k in kws)), "INSPECT")
    p = ACTION_PRIMITIVES[action_id]
    high_risk = any(w in t for w in HAZARD_HINT)
    try:
        from safety_engine import ppe_for
        ppe = ppe_for(instr_text)
    except Exception:
        ppe = []
    return {
        "action_id": action_id, "motion": p["motion"], "tool": p["tool"], "direction": p["direction"],
        "anchor": {"type": p["anchor"], "tracking_required": p["anchor"] in ("component", "point", "path", "edge", "object")},
        "visuals": p["visuals"],
        "ppe": ppe,
        "voice": (instr_text or "").strip()[:220],
        "verification": {"type": "user_confirmation", "prompt": "Tell me when this step is done."},
        "safety_level": "caution" if (safety_note or high_risk) else "normal",
    }

# Overlay type inference from a step instruction.
def _overlay_for(text: str) -> str:
    t = (text or "").lower()
    if any(w in t for w in ["measure", "measurement", "distance", "level", "square"]):
        return "measurement_marker"
    if any(w in t for w in ["place", "position", "mount", "hang", "align", "set the", "lay out"]):
        return "placement_marker"
    if any(w in t for w in ["locate", "find the", "identify", "component", "screw", "connector", "valve"]):
        return "component_highlight"
    if any(w in t for w in ["before", "after", "compare"]):
        return "before_after_overlay"
    if any(w in t for w in ["check", "inspect", "verify"]):
        return "inspection_marker"
    return "sequence_overlay"


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


async def _cap(user, event, props=None):
    try:
        import analytics_engine
        # never send room imagery / spatial maps to analytics — props are metadata only
        await analytics_engine.capture(user, event, props or {})
    except Exception:
        pass


def _sentry(event_type, message):
    try:
        import sentry_sdk
        sentry_sdk.capture_message(f"[ar_guidance:{event_type}] {message}", level="error")
    except Exception:
        pass


async def _prop(user_id: str) -> dict:
    p = (await _db.hi_properties.find_one({"user_id": user_id, "is_active": True}, {"_id": 0})
         or await _db.hi_properties.find_one({"user_id": user_id}, {"_id": 0}))
    if not p:
        p = {"id": _nid(), "user_id": user_id, "created_at": _now()}
        await _db.hi_properties.insert_one(dict(p))
    return p


async def _settings() -> dict:
    s = await _db.ar_settings.find_one({"id": "singleton"}, {"_id": 0})
    if not s:
        s = {"id": "singleton", "feature_enabled": True,
             "categories": {}, "category_default_enabled": True,
             "platforms": {"ios": True, "android": True, "web": False},
             "min_confidence": "low", "disabled_guidance_types": [],
             "fallback_behavior": "2d_then_text", "updated_at": _now()}
        await _db.ar_settings.insert_one(dict(s)); s.pop("_id", None)
    return s


# ------------------------------------------------------------- Spatial Context Resolver
async def _resolve_context(user_id: str, prop_id: str, room_id, project_id, asset_id) -> dict:
    ctx = {"room": None, "asset": None, "measurements": [], "twin_room": None, "measurement_confidence": None}
    if room_id:
        ctx["room"] = await _db.hi_rooms.find_one({"id": room_id, "property_id": prop_id}, {"_id": 0, "cover_photo_base64": 0})
        ctx["twin_room"] = await _db.dt_rooms.find_one({"source_room_id": room_id}, {"_id": 0}) if _db.dt_rooms else None
    if asset_id:
        ctx["asset"] = await _db.hi_assets.find_one({"id": asset_id, "property_id": prop_id}, {"_id": 0, "photo_base64": 0})
    # measurement confidence from measurement_engine (hi_measurements), scoped to room/project
    mq = {"user_id": user_id}
    if room_id:
        mq["room_id"] = room_id
    meas = await _db.hi_measurements.find(mq, {"_id": 0}).sort("created_at", -1).to_list(20)
    ctx["measurements"] = [{"id": m["id"], "label": m.get("label") or m.get("measurement_type"),
                            "verification_status": m.get("verification_status"),
                            "confidence": m.get("confidence")} for m in meas]
    if meas:
        # highest confidence available
        verified = any(m.get("verification_status") == "user_confirmed" for m in meas)
        ctx["measurement_confidence"] = "verified" if verified else "estimated"
    return ctx


# ------------------------------------------------------------- Eligibility Checker + Safety Gateway
async def _check_eligibility(prop_id, project, room_id, asset_id, guidance_type, device: dict) -> dict:
    s = await _settings()
    reasons: List[str] = []
    platform = (device or {}).get("platform", "unknown")
    supports_ar = bool((device or {}).get("supports_ar"))
    cam = (device or {}).get("camera_permission", "undetermined")

    if not s["feature_enabled"]:
        return {"status": "UNAVAILABLE", "reasons": ["AR guidance is turned off right now."], "fallback": "text",
                "allowed_guidance_types": [], "estimated": False}
    if guidance_type and guidance_type in s.get("disabled_guidance_types", []):
        return {"status": "UNAVAILABLE", "reasons": ["This guidance type is disabled."], "fallback": "2d",
                "allowed_guidance_types": [], "estimated": False}
    if not s["platforms"].get(platform, False):
        reasons.append(f"Live AR isn't supported on this platform ({platform}). You'll get 2D/text guidance.")

    # ---- Safety gateway (project-level)
    if project:
        cat = (project.get("project_category") or "")
        title = (project.get("title") or "")
        blob = f"{cat} {title}".lower()
        risk = project.get("risk_level")
        safety_status = (project.get("safety_status") or "").lower()
        if project.get("status") in ("escalated", "blocked") or "professional" in safety_status or risk == "Professional Recommended":
            return {"status": "PROFESSIONAL_REQUIRED",
                    "reasons": ["This work should be reviewed by a professional — AR guidance is disabled for safety."],
                    "fallback": "professional", "allowed_guidance_types": [], "estimated": False}
        if any(k in blob for k in PROFESSIONAL_KEYWORDS):
            return {"status": "PROFESSIONAL_REQUIRED",
                    "reasons": ["This involves high-risk infrastructure — please use a professional."],
                    "fallback": "professional", "allowed_guidance_types": [], "estimated": False}
        if risk == "High Risk" or any(k in blob for k in HAZARD_HINT):
            return {"status": "NOT_RECOMMENDED",
                    "reasons": ["AR could create false confidence for this higher-risk task. Follow the written steps carefully."],
                    "fallback": "text", "allowed_guidance_types": [], "estimated": False}

    # ---- capability
    allowed = [g for g in GUIDANCE_TYPES if g not in ("no_drill_zone_future",) and g not in s.get("disabled_guidance_types", [])]
    if platform == "web" or not supports_ar:
        reasons.append("Live camera AR needs a supported phone (native build). Showing 2D visual guidance instead.")
        status = "LIMITED"
        fallback = "2d"
    elif cam == "denied":
        reasons.append("Camera permission is off — enable it for live AR. Using 2D/text for now.")
        status = "LIMITED"; fallback = "2d"
    else:
        status = "AVAILABLE"; fallback = "2d"

    # ---- measurement confidence
    estimated = False
    if room_id is None and guidance_type in ("measurement_marker", "placement_marker"):
        reasons.append("No saved room context — placement is approximate.")
        estimated = True
        if status == "AVAILABLE":
            status = "LIMITED"
    return {"status": status, "reasons": reasons or ["Ready."], "fallback": fallback,
            "allowed_guidance_types": allowed, "estimated": estimated}


# ------------------------------------------------------------- Guidance Content Builder
async def _build_instructions(session_id, project, guidance_type, estimated) -> List[dict]:
    instructions = []
    steps = []
    if project:
        steps = await _db.hi_project_steps.find({"project_id": project["id"]}, {"_id": 0}).sort("sequence_number", 1).to_list(100)
        # order by phase then step; approved steps only (exclude escalated)
        steps = [s for s in steps if s.get("status") != "escalated"]
    if steps:
        for i, st in enumerate(steps):
            instr = str(st.get("instruction") or "").strip()
            overlay = _overlay_for(instr)
            requires_confirm = bool(st.get("stop_condition") or st.get("safety_note"))
            title = f"Step {i + 1}"
            safety_note = st.get("safety_note")
            if estimated and overlay in ("placement_marker", "measurement_marker"):
                safety_note = ("Placement is ESTIMATED from unverified data — confirm the exact spot yourself before "
                               "drilling or making anything permanent. " + (safety_note or "")).strip()
            doc = {"id": _nid(), "ar_guidance_session_id": session_id, "sequence_number": i,
                   "title": title, "instruction": instr, "overlay_type": overlay,
                   "action": compose_action(instr, st.get("safety_note")),
                   "target_state": "unconfirmed",
                   "safety_note": safety_note, "requires_confirmation": requires_confirm or overlay == "placement_marker",
                   "project_step_id": st.get("id"), "status": "pending", "created_at": _now()}
            instructions.append(doc)
    else:
        # generic guidance (no project steps) — a single guided instruction for the chosen type
        gt = guidance_type or "orientation_marker"
        generic = {
            "orientation_marker": "Point your device around the space to orient the guide.",
            "placement_marker": "Hold your device where you're considering placing the item and preview the position.",
            "measurement_marker": "Aim at the surface you measured to see the saved reference.",
            "component_highlight": "Aim at the item to review its documented components.",
            "before_after_overlay": "Frame the area to compare the before and after.",
            "checklist_anchor": "Work through the checklist anchored to this area.",
            "inspection_marker": "Frame the area you're inspecting and note what you see.",
        }.get(gt, "Follow the on-screen guide.")
        instructions.append({"id": _nid(), "ar_guidance_session_id": session_id, "sequence_number": 0,
                             "title": "Guided view", "instruction": generic, "overlay_type": gt,
                             "safety_note": "Estimated visualization only — verify anything permanent yourself." if estimated else None,
                             "requires_confirmation": True, "project_step_id": None,
                             "status": "pending", "created_at": _now()})
    if instructions:
        await _db.ar_instructions.insert_many([dict(x) for x in instructions])
    return instructions


# ============================================================= models
class EligibilityReq(BaseModel):
    project_id: Optional[str] = None
    project_work_item_id: Optional[str] = None
    room_id: Optional[str] = None
    asset_id: Optional[str] = None
    guidance_type: Optional[str] = None
    device: dict = {}


class StartReq(BaseModel):
    project_id: Optional[str] = None
    project_work_item_id: Optional[str] = None
    room_id: Optional[str] = None
    asset_id: Optional[str] = None
    guidance_type: str = "sequence_overlay"
    device: dict = {}


class ConfirmReq(BaseModel):
    anchor_confirmed: bool = True


class TrackingReq(BaseModel):
    reason: str


class FallbackReq(BaseModel):
    to: str = "2d"  # 2d | text | professional


class TargetReq(BaseModel):
    confidence: float = 0.0  # 0..1 from the vision/AR layer (or user-estimated)
    user_confirmed: bool = False


class CompleteReq(BaseModel):
    work_item_confirmed: bool = False
    user_feedback: Optional[str] = None


class OutcomeReq(BaseModel):
    result: str
    user_feedback: Optional[str] = None


# ============================================================= user router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/ar", dependencies=[Depends(get_current_user)])

    async def _sess(sid, uid):
        s = await _db.ar_sessions.find_one({"id": sid, "user_id": uid}, {"_id": 0})
        if not s:
            raise HTTPException(status_code=404, detail="AR session not found.")
        return s

    async def _project(pid, uid):
        return await _db.hi_projects.find_one({"id": pid, "user_id": uid}, {"_id": 0}) if pid else None

    @r.get("/meta/actions")
    async def meta_actions(user: dict = Depends(get_current_user)):
        return {"primitives": [{"id": k, **v} for k, v in ACTION_PRIMITIVES.items()],
                "tools": TOOL_LIBRARY, "anchor_types": ANCHOR_TYPES, "visual_objects": VISUAL_OBJECTS}

    @r.get("/meta/packages")
    async def meta_packages(user: dict = Depends(get_current_user)):
        return {"packages": [{"id": k, "label": v["label"], "action_count": len(v["actions"])}
                             for k, v in ACTION_PACKAGES.items()]}

    @r.get("/meta/packages/{pid}")
    async def meta_package(pid: str, user: dict = Depends(get_current_user)):
        pkg = ACTION_PACKAGES.get(pid)
        if not pkg:
            raise HTTPException(status_code=404, detail="Package not found.")
        return {"id": pid, "label": pkg["label"],
                "actions": [{"sequence": i, "action_id": aid,
                             "motion": ACTION_PRIMITIVES[aid]["motion"], "tool": ACTION_PRIMITIVES[aid]["tool"],
                             "direction": ACTION_PRIMITIVES[aid]["direction"], "anchor": ACTION_PRIMITIVES[aid]["anchor"],
                             "visuals": ACTION_PRIMITIVES[aid]["visuals"], "voice": voice}
                            for i, (aid, voice) in enumerate(pkg["actions"])]}

    @r.post("/sessions/{sid}/instructions/{iid}/target")
    async def target_instruction(sid: str, iid: str, req: TargetReq, user: dict = Depends(get_current_user)):
        """Doc 40 §7 confidence-aware targeting: never hallucinate certainty."""
        sess = await _db.ar_sessions.find_one({"id": sid, "user_id": user["id"]}, {"_id": 0, "id": 1})
        instr = await _db.ar_instructions.find_one({"id": iid, "ar_guidance_session_id": sid}, {"_id": 0})
        if not sess or not instr:
            raise HTTPException(status_code=404, detail="Instruction not found.")
        conf = max(0.0, min(1.0, float(req.confidence)))
        if req.user_confirmed or conf >= 0.85:
            state, behavior, message = "acquired", "anchor_and_guide", "Target locked. Follow the guide."
        elif conf >= 0.5:
            state, behavior, message = "candidate", "request_confirmation", "I believe this is the right spot. Tap it to confirm."
        else:
            state, behavior, message = "lost", "request_rescan", "I can't see the target clearly. Move closer or improve the lighting, then try again."
        await _db.ar_instructions.update_one({"id": iid}, {"$set": {"target_state": state, "target_confidence": conf}})
        return {"target_state": state, "behavior": behavior, "message": message, "confidence": conf}

    @r.post("/eligibility")
    async def eligibility(req: EligibilityReq, user: dict = Depends(get_current_user)):
        prop = await _prop(user["id"])
        project = await _project(req.project_id, user["id"])
        res = await _check_eligibility(prop["id"], project, req.room_id, req.asset_id, req.guidance_type, req.device)
        await _cap(user, "ar_guidance_requested", {"guidance_type": req.guidance_type, "has_project": bool(project)})
        await _cap(user, "ar_eligibility_checked", {"status": res["status"]})
        ctx = None
        if res["status"] in ("AVAILABLE", "LIMITED"):
            ctx = await _resolve_context(user["id"], prop["id"], req.room_id, req.project_id, req.asset_id)
        return {"eligibility": res, "context": ctx}

    @r.post("/sessions")
    async def start(req: StartReq, user: dict = Depends(get_current_user)):
        if req.guidance_type not in GUIDANCE_TYPES:
            raise HTTPException(status_code=400, detail="Unknown guidance type.")
        prop = await _prop(user["id"])
        project = await _project(req.project_id, user["id"])
        res = await _check_eligibility(prop["id"], project, req.room_id, req.asset_id, req.guidance_type, req.device)
        if res["status"] in ("UNAVAILABLE", "NOT_RECOMMENDED", "PROFESSIONAL_REQUIRED"):
            # never block — return fallback guidance instead of a session
            raise HTTPException(status_code=409, detail={"eligibility": res,
                "message": "AR isn't appropriate here — use the written steps." })
        cap_status = ("full" if res["status"] == "AVAILABLE" else "limited")
        session = {"id": _nid(), "user_id": user["id"], "property_id": prop["id"],
                   "room_id": req.room_id, "project_id": req.project_id,
                   "project_work_item_id": req.project_work_item_id, "asset_id": req.asset_id,
                   "guidance_type": req.guidance_type, "device_capability_status": cap_status,
                   "eligibility_status": res["status"], "estimated": res["estimated"],
                   "status": "created", "started_at": _now(), "completed_at": None, "created_at": _now()}
        await _db.ar_sessions.insert_one(dict(session)); session.pop("_id", None)
        # anchor placeholder (real spatial anchors resolve in the native runtime)
        await _db.ar_anchors.insert_one({
            "id": _nid(), "ar_guidance_session_id": session["id"],
            "anchor_type": "room_reference" if req.room_id else "user_placed",
            "spatial_reference_id": req.room_id, "confidence_level": "estimated" if res["estimated"] else "pending",
            "status": "active", "created_at": _now()})
        instructions = await _build_instructions(session["id"], project, req.guidance_type, res["estimated"])
        await _cap(user, "ar_session_started", {"guidance_type": req.guidance_type, "eligibility": res["status"]})
        return {"session": session, "instructions": instructions, "eligibility": res,
                "controls": ["exit", "pause", "recenter", "ask_homie", "show_text", "report_tracking", "safety"],
                "note": "Text instructions are always available. AR is an assistive visualization — not an authority."}

    @r.get("/sessions")
    async def list_sessions(user: dict = Depends(get_current_user)):
        rows = await _db.ar_sessions.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
        return {"sessions": rows}

    @r.get("/sessions/{sid}")
    async def get_session(sid: str, user: dict = Depends(get_current_user)):
        s = await _sess(sid, user["id"])
        instructions = await _db.ar_instructions.find({"ar_guidance_session_id": sid}, {"_id": 0}).sort("sequence_number", 1).to_list(200)
        anchors = await _db.ar_anchors.find({"ar_guidance_session_id": sid}, {"_id": 0}).to_list(50)
        outcome = await _db.ar_outcomes.find_one({"ar_guidance_session_id": sid}, {"_id": 0}, sort=[("created_at", -1)])
        return {"session": s, "instructions": instructions, "anchors": anchors, "outcome": outcome}

    @r.post("/sessions/{sid}/calibrate")
    async def calibrate(sid: str, req: ConfirmReq, user: dict = Depends(get_current_user)):
        s = await _sess(sid, user["id"])
        if not req.anchor_confirmed:
            await _db.ar_sessions.update_one({"id": sid}, {"$set": {"status": "failed"}})
            await _db.ar_outcomes.insert_one({"id": _nid(), "ar_guidance_session_id": sid,
                                              "result": "insufficient_tracking", "user_feedback": None, "created_at": _now()})
            _sentry("tracking_lost", sid)
            return {"status": "failed", "fallback": "2d"}
        await _db.ar_sessions.update_one({"id": sid}, {"$set": {"status": "active"}})
        return {"status": "active"}

    @r.post("/sessions/{sid}/instructions/{iid}/confirm")
    async def confirm_instruction(sid: str, iid: str, user: dict = Depends(get_current_user)):
        await _sess(sid, user["id"])
        instr = await _db.ar_instructions.find_one({"id": iid, "ar_guidance_session_id": sid}, {"_id": 0})
        if not instr:
            raise HTTPException(status_code=404, detail="Instruction not found.")
        await _db.ar_instructions.update_one({"id": iid}, {"$set": {"status": "confirmed"}})
        await _cap(user, "ar_instruction_confirmed", {"overlay_type": instr["overlay_type"]})
        remaining = await _db.ar_instructions.count_documents({"ar_guidance_session_id": sid, "status": {"$in": ["pending", "shown"]}})
        return {"ok": True, "remaining": remaining, "all_confirmed": remaining == 0}

    @r.post("/sessions/{sid}/instructions/{iid}/skip")
    async def skip_instruction(sid: str, iid: str, user: dict = Depends(get_current_user)):
        await _sess(sid, user["id"])
        res = await _db.ar_instructions.update_one({"id": iid, "ar_guidance_session_id": sid}, {"$set": {"status": "skipped"}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Instruction not found.")
        return {"ok": True}

    @r.post("/sessions/{sid}/pause")
    async def pause(sid: str, user: dict = Depends(get_current_user)):
        await _sess(sid, user["id"])
        await _db.ar_sessions.update_one({"id": sid}, {"$set": {"status": "paused"}})
        return {"status": "paused"}

    @r.post("/sessions/{sid}/resume")
    async def resume(sid: str, user: dict = Depends(get_current_user)):
        await _sess(sid, user["id"])
        await _db.ar_sessions.update_one({"id": sid}, {"$set": {"status": "active"}})
        return {"status": "active"}

    @r.post("/sessions/{sid}/recenter")
    async def recenter(sid: str, user: dict = Depends(get_current_user)):
        await _sess(sid, user["id"])
        return {"ok": True}

    @r.post("/sessions/{sid}/report-tracking")
    async def report_tracking(sid: str, req: TrackingReq, user: dict = Depends(get_current_user)):
        await _sess(sid, user["id"])
        await _db.ar_anchors.update_many({"ar_guidance_session_id": sid, "status": "active"}, {"$set": {"status": "lost"}})
        await _db.ar_sessions.update_one({"id": sid}, {"$set": {"status": "paused"}})
        _sentry("tracking_lost", f"{sid}: {req.reason}")
        return {"ok": True, "fallback": "2d", "message": "No problem — switch to 2D or text guidance to keep going."}

    @r.post("/sessions/{sid}/fallback")
    async def fallback(sid: str, req: FallbackReq, user: dict = Depends(get_current_user)):
        await _sess(sid, user["id"])
        await _cap(user, "ar_fallback_used", {"to": req.to})
        return {"ok": True, "to": req.to}

    @r.post("/sessions/{sid}/complete")
    async def complete(sid: str, req: CompleteReq, user: dict = Depends(get_current_user)):
        s = await _sess(sid, user["id"])
        await _db.ar_sessions.update_one({"id": sid}, {"$set": {"status": "completed", "completed_at": _now()}})
        await _db.ar_outcomes.insert_one({"id": _nid(), "ar_guidance_session_id": sid, "result": "completed",
                                          "user_feedback": (req.user_feedback or "").strip()[:1000] or None, "created_at": _now()})
        # progress updates ONLY on explicit user confirmation of the work item
        step_updated = False
        if req.work_item_confirmed and s.get("project_work_item_id"):
            res = await _db.hi_project_steps.update_one(
                {"id": s["project_work_item_id"], "project_id": s.get("project_id"), "status": {"$ne": "completed"}},
                {"$set": {"status": "completed", "completed_at": _now()}})
            step_updated = bool(res.modified_count)
        await _cap(user, "ar_session_completed", {"work_item_confirmed": req.work_item_confirmed})
        return {"ok": True, "work_item_updated": step_updated,
                "note": "Nice work. AR completing didn't auto-mark your task — we only updated it because you confirmed." if step_updated
                        else "AR session saved. Your task status is unchanged unless you confirm it yourself."}

    @r.post("/sessions/{sid}/cancel")
    async def cancel(sid: str, req: OutcomeReq, user: dict = Depends(get_current_user)):
        await _sess(sid, user["id"])
        result = req.result if req.result in OUTCOME_RESULTS else "user_cancelled"
        await _db.ar_sessions.update_one({"id": sid}, {"$set": {"status": "cancelled"}})
        await _db.ar_outcomes.insert_one({"id": _nid(), "ar_guidance_session_id": sid, "result": result,
                                          "user_feedback": (req.user_feedback or "").strip()[:1000] or None, "created_at": _now()})
        await _cap(user, "ar_session_abandoned", {"result": result})
        return {"ok": True}

    return r


# ============================================================= admin router
class SettingsReq(BaseModel):
    feature_enabled: Optional[bool] = None
    category_default_enabled: Optional[bool] = None
    min_confidence: Optional[str] = None
    fallback_behavior: Optional[str] = None


class CategoryReq(BaseModel):
    category: str
    enabled: bool


class PlatformReq(BaseModel):
    platform: str
    enabled: bool


class GuidanceTypeReq(BaseModel):
    guidance_type: str
    disabled: bool


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/ar", dependencies=[Depends(require_admin)])

    @r.get("/settings")
    async def get_settings(admin: dict = Depends(require_admin)):
        return await _settings()

    @r.put("/settings")
    async def put_settings(req: SettingsReq, admin: dict = Depends(require_admin)):
        upd = {k: v for k, v in req.dict().items() if v is not None}
        if upd.get("min_confidence") and upd["min_confidence"] not in ("low", "medium", "high"):
            raise HTTPException(status_code=400, detail="Invalid confidence level.")
        if upd:
            upd["updated_at"] = _now()
            await _db.ar_settings.update_one({"id": "singleton"}, {"$set": upd}, upsert=True)
        return await _settings()

    @r.put("/categories")
    async def set_category(req: CategoryReq, admin: dict = Depends(require_admin)):
        s = await _settings()
        cats = s.get("categories", {}); cats[req.category] = req.enabled
        await _db.ar_settings.update_one({"id": "singleton"}, {"$set": {"categories": cats, "updated_at": _now()}})
        return {"categories": cats}

    @r.put("/platforms")
    async def set_platform(req: PlatformReq, admin: dict = Depends(require_admin)):
        if req.platform not in ("ios", "android", "web"):
            raise HTTPException(status_code=400, detail="Invalid platform.")
        s = await _settings()
        plats = s.get("platforms", {}); plats[req.platform] = req.enabled
        await _db.ar_settings.update_one({"id": "singleton"}, {"$set": {"platforms": plats, "updated_at": _now()}})
        return {"platforms": plats}

    @r.put("/guidance-types")
    async def set_guidance_type(req: GuidanceTypeReq, admin: dict = Depends(require_admin)):
        if req.guidance_type not in GUIDANCE_TYPES:
            raise HTTPException(status_code=400, detail="Unknown guidance type.")
        s = await _settings()
        disabled = set(s.get("disabled_guidance_types", []))
        disabled.add(req.guidance_type) if req.disabled else disabled.discard(req.guidance_type)
        await _db.ar_settings.update_one({"id": "singleton"}, {"$set": {"disabled_guidance_types": list(disabled), "updated_at": _now()}})
        return {"disabled_guidance_types": list(disabled)}

    @r.get("/dashboard")
    async def dashboard(admin: dict = Depends(require_admin)):
        async def _c(st):
            return await _db.ar_sessions.count_documents({"status": st})
        by_status = {st: await _c(st) for st in SESSION_STATES}
        outcomes = await _db.ar_outcomes.find({}, {"_id": 0}).to_list(20000)
        by_result: dict = {}
        for o in outcomes:
            by_result[o["result"]] = by_result.get(o["result"], 0) + 1
        total = await _db.ar_sessions.count_documents({})
        completed = by_status.get("completed", 0)
        failures = {k: v for k, v in by_result.items() if k in ("insufficient_tracking", "unsupported_device", "abandoned", "safety_escalated")}
        return {"total_sessions": total, "by_status": by_status, "by_result": by_result,
                "completion_rate": round(completed / total * 100, 1) if total else 0.0,
                "tracking_failures": failures, "settings": await _settings()}

    return r


# ============================================================= seed
async def seed_ar():
    if _db is None:
        return
    try:
        await _settings()
        if _logger:
            _logger.info("ar guidance (B27) seeded")
    except Exception as e:
        if _logger:
            _logger.error(f"ar guidance seed failed: {e}")
