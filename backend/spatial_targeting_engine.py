"""
DIYhomie — AR Scan, Measurement & Spatial Targeting deltas (Build Document 53).

Existing coverage: digital_twin_engine (capture sessions, rooms, measurements, conflicts),
ar_guidance_engine (AR sessions, anchors, eligibility, visual elements), sync_engine (offline
queue), media engines (photo evidence). This engine adds the Doc 53 deltas:

- SpatialTarget records (§6): typed, anchored, confidence-scored targets w/ confirm/reject
- Honest confidence system (§7): high/medium/low with rescan coaching; hidden conditions
  (e.g. stud locations) are never represented as verified facts
- Measurement edit/confirm (§5): stores BOTH captured value and user-confirmed value + method
- AR launch preflight (§11): camera/tracking/lighting/target/safety checklist w/ fallback
- Scan quality guidance meta (§13) + progressive "smallest useful scan" ladder (§1)

Collections: sp_targets. Reads/writes: hi_measurements.
"""
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

TARGET_TYPES = ["room", "wall", "floor", "ceiling", "door", "window", "cabinet", "countertop",
                "outlet", "switch", "fixture", "appliance", "pipe", "valve", "stud_location",
                "fastener_point", "cut_line", "measurement_point", "keep_out_zone", "custom"]
ANCHOR_TYPES = ["world", "surface", "edge", "corner", "point", "path", "object", "component"]
# hidden conditions can never be auto-verified (§7)
HIDDEN_CONDITION_TYPES = {"stud_location", "pipe", "valve"}
SCAN_LADDER = ["quick_photo", "guided_measurement", "surface_scan", "room_scan", "verification_scan"]

SCAN_GUIDANCE = {
    "quick_photo": {"why": "A single clear photo is often all Homie needs.",
                    "tips": ["Fill the frame with the subject", "Avoid glare", "Add light if it's dim"]},
    "guided_measurement": {"why": "Point-to-point dimensions power layout, materials and cost estimates.",
                           "tips": ["Hold the phone steady", "Mark the start point first", "Move slowly to the end point"]},
    "surface_scan": {"why": "Mapping a wall or countertop lets Homie place AR targets precisely.",
                     "tips": ["Stay 3-6 feet away", "Pan slowly left to right", "Keep the whole surface in view", "Scan from a second angle if confidence is low"]},
    "room_scan": {"why": "Room geometry builds your Home Passport progressively — no need for perfection.",
                  "tips": ["Move slowly around the room", "Keep corners in frame", "Avoid standing too close to walls"]},
    "verification_scan": {"why": "A before/after record protects your home's future knowledge.",
                          "tips": ["Match the original angle", "Capture the whole work area", "Use good lighting"]},
}
FAILURE_STATES = ["too_dark", "too_blurry", "target_too_small", "target_obstructed",
                  "tracking_lost", "surface_not_detected", "confidence_too_low"]

MEASUREMENT_MODES = ["point_to_point", "width", "height", "depth", "area", "perimeter",
                     "diagonal", "clearance", "angle", "slope", "center_point"]


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
        await analytics_engine.capture(user, event, props or {})
    except Exception:
        pass


def _confidence_level(score: float) -> dict:
    if score >= 0.8:
        return {"level": "high", "message": "Clear enough to use."}
    if score >= 0.5:
        return {"level": "medium", "message": "Likely correct — please confirm before relying on it."}
    return {"level": "low", "message": "The scan is incomplete or unclear — another scan is recommended."}


class TargetReq(BaseModel):
    target_type: str
    label: str
    anchor_type: str = "surface"
    room_id: Optional[str] = None
    project_id: Optional[str] = None
    task_id: Optional[str] = None
    dimensions: Optional[dict] = None
    position_data: Optional[dict] = None
    confidence_score: float = 0.6
    source_scan_id: Optional[str] = None


class MeasureConfirmReq(BaseModel):
    confirmed_value: Optional[float] = None
    unit: Optional[str] = None
    note: Optional[str] = None


class PreflightReq(BaseModel):
    project_id: Optional[str] = None
    room_id: Optional[str] = None
    target_id: Optional[str] = None
    device: dict = {}  # camera_permission, motion_tracking, lighting_ok, platform


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/spatial", dependencies=[Depends(get_current_user)])

    @r.get("/meta")
    async def meta(user: dict = Depends(get_current_user)):
        return {"target_types": TARGET_TYPES, "anchor_types": ANCHOR_TYPES,
                "scan_ladder": SCAN_LADDER, "measurement_modes": MEASUREMENT_MODES,
                "failure_states": FAILURE_STATES}

    @r.get("/scan-guidance")
    async def scan_guidance(scan_type: str = "surface_scan", user: dict = Depends(get_current_user)):
        g = SCAN_GUIDANCE.get(scan_type)
        if not g:
            raise HTTPException(status_code=400, detail="Unknown scan type.")
        return {"scan_type": scan_type, **g,
                "smallest_useful_scan": "Homie only asks for the smallest useful scan — start with a photo; add detail only when a task needs it."}

    # -------- spatial targets (§6-7)
    @r.post("/targets")
    async def create_target(req: TargetReq, user: dict = Depends(get_current_user)):
        if req.target_type not in TARGET_TYPES:
            raise HTTPException(status_code=400, detail="Unknown target type.")
        if req.anchor_type not in ANCHOR_TYPES:
            raise HTTPException(status_code=400, detail="Unknown anchor type.")
        score = max(0.0, min(1.0, req.confidence_score))
        conf = _confidence_level(score)
        hidden = req.target_type in HIDDEN_CONDITION_TYPES
        doc = {"id": _nid(), "user_id": user["id"], "room_id": req.room_id,
               "project_id": req.project_id, "task_id": req.task_id,
               "target_type": req.target_type, "label": (req.label or "").strip()[:120],
               "anchor_type": req.anchor_type, "dimensions": req.dimensions,
               "position_data": req.position_data, "confidence_score": score,
               "confidence": conf, "hidden_condition": hidden,
               "verification_status": "unverified",
               "source_scan_id": req.source_scan_id, "created_at": _now()}
        await _db.sp_targets.insert_one(dict(doc)); doc.pop("_id", None)
        await _cap(user, "surface_detected" if req.anchor_type == "surface" else "target_confirmed_pending",
                   {"target_type": req.target_type})
        out = {"target": doc}
        if hidden:
            out["caution"] = ("This is an estimated hidden condition, not a verified fact. "
                              "Before drilling or cutting, confirm with a stud finder or appropriate tester.")
        if conf["level"] != "high":
            out["rescan_hint"] = "Scan from another angle or improve lighting to raise confidence."
        return out

    @r.get("/targets")
    async def list_targets(project_id: Optional[str] = None, room_id: Optional[str] = None,
                           user: dict = Depends(get_current_user)):
        q: dict = {"user_id": user["id"]}
        if project_id:
            q["project_id"] = project_id
        if room_id:
            q["room_id"] = room_id
        rows = await _db.sp_targets.find(q, {"_id": 0}).sort("created_at", -1).to_list(100)
        return {"targets": rows}

    @r.post("/targets/{tid}/confirm")
    async def confirm_target(tid: str, user: dict = Depends(get_current_user)):
        t = await _db.sp_targets.find_one({"id": tid, "user_id": user["id"]}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Target not found.")
        status = "user_confirmed" if t.get("hidden_condition") else "confirmed"
        await _db.sp_targets.update_one({"id": tid}, {"$set": {"verification_status": status, "confirmed_at": _now()}})
        await _cap(user, "target_confirmed", {"target_type": t["target_type"]})
        return {"ok": True, "verification_status": status,
                "note": "Recorded as user-confirmed — Homie never treats hidden conditions as verified facts." if t.get("hidden_condition") else None}

    @r.post("/targets/{tid}/reject")
    async def reject_target(tid: str, user: dict = Depends(get_current_user)):
        res = await _db.sp_targets.update_one({"id": tid, "user_id": user["id"]},
                                              {"$set": {"verification_status": "rejected", "rejected_at": _now()}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Target not found.")
        await _cap(user, "target_rejected", {})
        return {"ok": True, "message": "Removed. Rescan the area when you're ready."}

    @r.delete("/targets/{tid}")
    async def delete_target(tid: str, user: dict = Depends(get_current_user)):
        res = await _db.sp_targets.delete_one({"id": tid, "user_id": user["id"]})
        if not res.deleted_count:
            raise HTTPException(status_code=404, detail="Target not found.")
        await _cap(user, "scan_deleted", {})
        return {"ok": True}

    # -------- measurement confirm/edit (§5)
    @r.post("/measurements/{mid}/confirm")
    async def confirm_measurement(mid: str, req: MeasureConfirmReq, user: dict = Depends(get_current_user)):
        m = await _db.hi_measurements.find_one({"id": mid, "user_id": user["id"]}, {"_id": 0})
        if not m:
            raise HTTPException(status_code=404, detail="Measurement not found.")
        # hi_measurements stores dimension-specific fields; pick the primary captured value
        value_key = next((k for k in ("value", "length_value", "width_value", "height_value", "distance_value")
                          if m.get(k) is not None), "value")
        current = m.get(value_key)
        updates = {"user_confirmed": True, "confirmed_at": _now()}
        if m.get("captured_value") is None:
            updates["captured_value"] = current
        edited = req.confirmed_value is not None and req.confirmed_value != current
        if req.confirmed_value is not None:
            updates["user_confirmed_value"] = req.confirmed_value
            updates[value_key] = req.confirmed_value
        if req.unit:
            updates["unit"] = req.unit
        if req.note:
            updates["confirm_note"] = req.note.strip()[:300]
        await _db.hi_measurements.update_one({"id": mid}, {"$set": updates})
        await _cap(user, "measurement_edited" if edited else "measurement_confirmed", {"measurement_id": mid})
        out = await _db.hi_measurements.find_one({"id": mid}, {"_id": 0})
        return {"measurement": out, "edited": edited}

    # -------- AR launch preflight (§11)
    @r.post("/ar-preflight")
    async def ar_preflight(req: PreflightReq, user: dict = Depends(get_current_user)):
        checks = []
        dev = req.device or {}

        def check(name, ok, hint):
            checks.append({"check": name, "ok": bool(ok), "hint": None if ok else hint})

        check("camera_permission", dev.get("camera_permission", False), "Grant camera access to use AR guidance.")
        check("motion_tracking", dev.get("motion_tracking", dev.get("platform") != "web"), "Motion tracking needs a real device — the web preview can't run AR.")
        check("lighting", dev.get("lighting_ok", True), "Add more light or open blinds before scanning.")
        target = None
        if req.target_id:
            target = await _db.sp_targets.find_one({"id": req.target_id, "user_id": user["id"]}, {"_id": 0})
        elif req.project_id or req.room_id:
            q: dict = {"user_id": user["id"], "verification_status": {"$ne": "rejected"}}
            if req.project_id:
                q["project_id"] = req.project_id
            if req.room_id:
                q["room_id"] = req.room_id
            target = await _db.sp_targets.find_one(q, {"_id": 0}, sort=[("created_at", -1)])
        check("target_detected", bool(target), "Scan the work surface first so Homie has a target.")
        check("target_confidence", bool(target) and target.get("confidence_score", 0) >= 0.5,
              "Target confidence is low — rescan from another angle.")
        safety_ok = True
        if req.project_id:
            p = await _db.hi_projects.find_one({"id": req.project_id, "user_id": user["id"]}, {"_id": 0, "safety_status": 1})
            safety_ok = (p or {}).get("safety_status") != "Stop and contact a professional"
        check("safety_status", safety_ok, "This project is paused for safety — resolve the safety stop before AR work.")
        ready = all(c["ok"] for c in checks)
        await _cap(user, "ar_guidance_requested", {"ready": ready})
        return {"ready": ready, "checks": checks, "target": target,
                "message": "AR guidance is ready." if ready
                else "AR Guidance needs a better view. Try moving closer, improving lighting, or scanning the surface again.",
                "fallback": None if ready else "Standard guidance is always available — nothing is blocked."}

    return r
