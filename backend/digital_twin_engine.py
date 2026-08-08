"""
DIYhomie — Building Intelligence Capture Platform & Digital Twin Core (Build Blueprint 19).

ONE evolving digital twin per property, enriched over time from many capture sources
(manual, photo, document, walkthrough — plus future AR/LiDAR/MeasureAssist). Every spatial
record keeps its SOURCE, CONFIDENCE and VERIFICATION status. New evidence never silently
overwrites user-confirmed data — meaningful disagreements become CONFLICTS for user review.

This layer REFERENCES existing rooms (hi_rooms) and measurements (hi_measurements) rather
than duplicating them. It is the shared spatial context other features read from.

Collections: dt_twins, dt_floors, dt_rooms, dt_connections, dt_elements, dt_measurement_refs,
dt_capture_sessions, dt_artifacts, dt_evidence, dt_conflicts, dt_settings.
"""
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

CAPTURE_TYPES = ["manual", "photo", "document", "walkthrough",
                 "ar_future", "lidar_future", "measureassist_future", "imported_plan_future"]
ELEMENT_TYPES = ["wall", "door", "window", "fixture", "appliance", "cabinet", "outlet", "vent", "stair", "column", "other"]
CONNECTION_TYPES = ["doorway", "open_passage", "stairs", "exterior_access", "unknown"]
CONFIDENCE = ["low", "medium", "high"]

# Source reliability hierarchy (higher wins conflicts). Matches the spec ordering.
SOURCE_RANK = {
    "verified_future": 100, "professional_survey_future": 100,
    "user_confirmed": 80, "manual": 70,
    "document_imported": 60, "measureassist_future": 55,
    "ar_future": 50, "lidar_future": 50,
    "photo_detected": 30, "walkthrough": 30,
    "ai_estimate": 10, "user_entered": 70,
}
# how far two measurements may differ (fraction) before it's a conflict
DEFAULT_CONFLICT_THRESHOLD = 0.10


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


def _sentry(event_type: str, message: str):
    try:
        import sentry_sdk
        sentry_sdk.capture_message(f"[twin:{event_type}] {message}", level="error")
    except Exception:
        pass


async def _active_property(user_id: str) -> Optional[dict]:
    props = await _db.hi_properties.find({"user_id": user_id}, {"_id": 0}).to_list(50)
    if not props:
        return None
    return next((p for p in props if p.get("is_active")), props[0])


async def _settings() -> dict:
    s = await _db.dt_settings.find_one({"id": "global"}, {"_id": 0})
    if not s:
        s = {"id": "global",
             "capture_types_enabled": {t: (not t.endswith("_future")) for t in CAPTURE_TYPES},
             "max_artifacts_free": 25, "max_artifacts_pro": 500,
             "conflict_threshold": DEFAULT_CONFLICT_THRESHOLD, "updated_at": _now()}
        await _db.dt_settings.insert_one(dict(s))
        s.pop("_id", None)
    return s


async def ensure_twin(property_id: str, user_id: str) -> dict:
    t = await _db.dt_twins.find_one({"property_id": property_id}, {"_id": 0})
    if t:
        return t
    t = {"id": _nid(), "property_id": property_id, "user_id": user_id, "version_number": 1,
         "model_status": "draft", "confidence_level": "low", "last_capture_at": None,
         "created_at": _now(), "updated_at": _now()}
    await _db.dt_twins.insert_one(dict(t))
    # seed a default floor
    await _db.dt_floors.insert_one({"id": _nid(), "digital_twin_id": t["id"], "floor_id": _nid(),
                                    "label": "Main Floor", "elevation_reference": None,
                                    "sequence_number": 1, "confidence_level": "medium"})
    t.pop("_id", None)
    return t


async def _recompute_confidence(twin_id: str):
    rooms = await _db.dt_rooms.find({"digital_twin_id": twin_id}, {"_id": 0}).to_list(500)
    if not rooms:
        conf, status = "low", "draft"
    else:
        verified = [r for r in rooms if r.get("boundary_status") in ("verified_future",) or r.get("confidence_level") == "high"]
        ratio = len(verified) / len(rooms)
        conf = "high" if ratio >= 0.66 else "medium" if ratio >= 0.25 else "low"
        open_conflicts = await _db.dt_conflicts.count_documents({"digital_twin_id": twin_id, "status": "open"})
        status = "needs_review" if open_conflicts else ("active" if ratio >= 0.5 else "partial")
    await _db.dt_twins.update_one({"id": twin_id}, {"$set": {
        "confidence_level": conf, "model_status": status, "updated_at": _now(), "last_capture_at": _now()}})


# ------------------------------------------------------------- models
class CaptureStartReq(BaseModel):
    property_id: Optional[str] = None
    capture_type: str = "walkthrough"
    idempotency_key: Optional[str] = None


class RoomEvidenceReq(BaseModel):
    room_type: str = "Other"
    display_name: str
    area_estimate: Optional[float] = None
    ceiling_height_estimate: Optional[float] = None
    room_id: Optional[str] = None  # link to existing hi_room if known


class MeasurementEvidenceReq(BaseModel):
    dt_room_id: str
    element_type: str = "wall"
    label: str
    value: float
    unit: str = "feet"
    source_status: str = "manual"  # manual | photo_detected | ai_estimate | ...
    measurement_id: Optional[str] = None  # link to existing hi_measurement


class ConnectionReq(BaseModel):
    origin_room_id: str
    destination_room_id: str
    connection_type: str = "doorway"


class ResolveReq(BaseModel):
    resolution: str  # keep_existing | use_new | manual | unknown
    manual_value: Optional[float] = None


class SettingsReq(BaseModel):
    capture_types_enabled: Optional[dict] = None
    max_artifacts_free: Optional[int] = None
    max_artifacts_pro: Optional[int] = None
    conflict_threshold: Optional[float] = None


# ============================================================= user router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/twin", dependencies=[Depends(get_current_user)])

    async def _twin_for_user(user) -> dict:
        prop = await _active_property(user["id"])
        if not prop:
            raise HTTPException(status_code=400, detail="Add a property first.")
        return await ensure_twin(prop["id"], user["id"])

    async def _own_session(sid, user) -> dict:
        s = await _db.dt_capture_sessions.find_one({"id": sid, "user_id": user["id"]}, {"_id": 0})
        if not s:
            raise HTTPException(status_code=404, detail="Capture session not found.")
        return s

    async def _own_twin(twin_id, user):
        t = await _db.dt_twins.find_one({"id": twin_id, "user_id": user["id"]}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Digital twin not found.")
        return t

    @r.get("/overview")
    async def overview(user: dict = Depends(get_current_user)):
        t = await _twin_for_user(user)
        floors = await _db.dt_floors.find({"digital_twin_id": t["id"]}, {"_id": 0}).sort("sequence_number", 1).to_list(50)
        rooms = await _db.dt_rooms.find({"digital_twin_id": t["id"]}, {"_id": 0}).sort("created_at", 1).to_list(500)
        connections = await _db.dt_connections.count_documents({"digital_twin_id": t["id"]})
        elements = await _db.dt_elements.count_documents({"digital_twin_id": t["id"]})
        open_conflicts = await _db.dt_conflicts.count_documents({"digital_twin_id": t["id"], "status": "open"})
        # capture-source breakdown
        srcs = await _db.dt_evidence.find({"digital_twin_id": t["id"]}, {"_id": 0, "source_type": 1}).to_list(2000)
        by_source: dict = {}
        for e in srcs:
            by_source[e["source_type"]] = by_source.get(e["source_type"], 0) + 1
        await _cap(user, "knowledge_search_used", {})
        return {"twin": t, "floors": floors, "rooms": rooms,
                "counts": {"rooms": len(rooms), "connections": connections, "elements": elements, "open_conflicts": open_conflicts},
                "sources": by_source}

    @r.post("/capture-sessions")
    async def start_capture(req: CaptureStartReq, user: dict = Depends(get_current_user)):
        settings = await _settings()
        if req.capture_type not in CAPTURE_TYPES:
            raise HTTPException(status_code=400, detail="Unknown capture type.")
        if not settings["capture_types_enabled"].get(req.capture_type):
            raise HTTPException(status_code=400, detail="This capture type is not available yet.")
        prop = await _active_property(user["id"])
        if not prop:
            raise HTTPException(status_code=400, detail="Add a property first.")
        twin = await ensure_twin(prop["id"], user["id"])
        idem = req.idempotency_key or _nid()
        existing = await _db.dt_capture_sessions.find_one({"user_id": user["id"], "idempotency_key": idem}, {"_id": 0})
        if existing:
            return existing
        s = {"id": _nid(), "user_id": user["id"], "property_id": prop["id"], "digital_twin_id": twin["id"],
             "capture_type": req.capture_type, "status": "created", "idempotency_key": idem,
             "artifact_count": 0, "started_at": _now(), "completed_at": None, "created_at": _now()}
        await _db.dt_capture_sessions.insert_one(dict(s))
        await _cap(user, "capture_session_started", {"capture_type": req.capture_type})
        s.pop("_id", None)
        return s

    @r.get("/capture-sessions/{sid}")
    async def get_capture(sid: str, user: dict = Depends(get_current_user)):
        s = await _own_session(sid, user)
        artifacts = await _db.dt_artifacts.find({"capture_session_id": sid}, {"_id": 0}).to_list(500)
        evidence = await _db.dt_evidence.find({"capture_session_id": sid}, {"_id": 0}).to_list(500)
        rooms = await _db.dt_rooms.find({"digital_twin_id": s["digital_twin_id"]}, {"_id": 0}).to_list(500)
        return {"session": s, "artifacts": artifacts, "evidence": evidence, "rooms": rooms}

    @r.post("/capture-sessions/{sid}/rooms")
    async def add_room_evidence(sid: str, req: RoomEvidenceReq, user: dict = Depends(get_current_user)):
        s = await _own_session(sid, user)
        twin_id = s["digital_twin_id"]
        floor = await _db.dt_floors.find_one({"digital_twin_id": twin_id}, {"_id": 0}, sort=[("sequence_number", 1)])
        boundary = "manual" if s["capture_type"] == "manual" else "estimated"
        conf = "medium" if s["capture_type"] in ("manual", "walkthrough") else "low"
        room = {"id": _nid(), "digital_twin_id": twin_id, "floor_id": floor["id"] if floor else None,
                "room_id": req.room_id, "room_type": req.room_type, "display_name": req.display_name.strip()[:80],
                "boundary_status": boundary, "area_estimate": req.area_estimate,
                "ceiling_height_estimate": req.ceiling_height_estimate, "confidence_level": conf,
                "created_at": _now(), "updated_at": _now()}
        await _db.dt_rooms.insert_one(dict(room))
        await _db.dt_evidence.insert_one({
            "id": _nid(), "digital_twin_id": twin_id, "capture_session_id": sid,
            "evidence_type": "room_classification", "subject_reference": room["id"],
            "observed_value": {"room_type": req.room_type, "area_estimate": req.area_estimate},
            "source_type": ("manual" if s["capture_type"] == "manual" else s["capture_type"]),
            "confidence_level": conf, "verification_status": "unverified", "created_at": _now()})
        await _db.dt_capture_sessions.update_one({"id": sid}, {"$set": {"status": "processing"}, "$inc": {"artifact_count": 1}})
        await _recompute_confidence(twin_id)
        await _cap(user, "capture_artifact_uploaded", {"artifact_type": "room_classification"})
        room.pop("_id", None)
        return room

    @r.post("/capture-sessions/{sid}/measurements")
    async def add_measurement_evidence(sid: str, req: MeasurementEvidenceReq, user: dict = Depends(get_current_user)):
        s = await _own_session(sid, user)
        twin_id = s["digital_twin_id"]
        room = await _db.dt_rooms.find_one({"id": req.dt_room_id, "digital_twin_id": twin_id}, {"_id": 0})
        if not room:
            raise HTTPException(status_code=404, detail="Room not found in this twin.")
        settings = await _settings()
        threshold = settings["conflict_threshold"]
        # find an existing element of same type+label in this room
        elem = await _db.dt_elements.find_one({"digital_twin_id": twin_id, "room_id": req.dt_room_id,
                                               "element_type": req.element_type, "label": req.label}, {"_id": 0})
        new_rank = SOURCE_RANK.get(req.source_status, 20)
        conflict = None
        if elem and elem.get("observed_value") is not None:
            prev = elem["observed_value"]
            diff = abs(prev - req.value) / max(prev, 1e-6)
            if diff > threshold:
                prev_rank = SOURCE_RANK.get(elem.get("source_status", "ai_estimate"), 20)
                # never silently overwrite a confirmed/higher-ranked value → raise a conflict
                if elem.get("verification_status") == "user_confirmed" or prev_rank >= new_rank:
                    conflict = {"id": _nid(), "digital_twin_id": twin_id, "subject_reference": elem["id"],
                                "conflicting_evidence_ids": [], "conflict_type": "measurement",
                                "status": "open", "detail": {"label": req.label, "unit": req.unit,
                                "existing_value": prev, "existing_source": elem.get("source_status"),
                                "new_value": req.value, "new_source": req.source_status},
                                "resolution_note": None, "created_at": _now(), "resolved_at": None}
                    await _db.dt_conflicts.insert_one(dict(conflict))
                    conflict.pop("_id", None)
                    await _cap(user, "spatial_conflict_shown", {"conflict_type": "measurement"})
        if not elem:
            elem = {"id": _nid(), "digital_twin_id": twin_id, "room_id": req.dt_room_id,
                    "element_type": req.element_type if req.element_type in ELEMENT_TYPES else "other",
                    "label": req.label[:80], "source_status": req.source_status,
                    "observed_value": req.value, "unit": req.unit,
                    "confidence_level": "high" if new_rank >= 70 else "medium" if new_rank >= 40 else "low",
                    "verification_status": "user_confirmed" if req.source_status in ("manual", "user_confirmed") else "unverified",
                    "linked_asset_id": None, "created_at": _now()}
            await _db.dt_elements.insert_one(dict(elem))
            elem.pop("_id", None)
        elif not conflict:
            # no conflict → update if new source is at least as reliable
            prev_rank = SOURCE_RANK.get(elem.get("source_status", "ai_estimate"), 20)
            if new_rank >= prev_rank:
                await _db.dt_elements.update_one({"id": elem["id"]}, {"$set": {
                    "observed_value": req.value, "unit": req.unit, "source_status": req.source_status,
                    "verification_status": "user_confirmed" if req.source_status in ("manual", "user_confirmed") else elem.get("verification_status")}})
        # measurement reference (link to hi_measurements when provided)
        await _db.dt_measurement_refs.insert_one({
            "id": _nid(), "digital_twin_id": twin_id, "measurement_id": req.measurement_id,
            "linked_element_type": req.element_type, "linked_element_id": elem["id"],
            "source": req.source_status, "verification_status": elem.get("verification_status", "unverified"),
            "created_at": _now()})
        await _db.dt_evidence.insert_one({
            "id": _nid(), "digital_twin_id": twin_id, "capture_session_id": sid,
            "evidence_type": "measurement", "subject_reference": elem["id"],
            "observed_value": {"label": req.label, "value": req.value, "unit": req.unit},
            "source_type": req.source_status, "confidence_level": elem.get("confidence_level", "low"),
            "verification_status": elem.get("verification_status", "unverified"), "created_at": _now()})
        await _db.dt_capture_sessions.update_one({"id": sid}, {"$inc": {"artifact_count": 1}})
        await _recompute_confidence(twin_id)
        return {"element": elem, "conflict": conflict}

    @r.post("/capture-sessions/{sid}/connections")
    async def add_connection(sid: str, req: ConnectionReq, user: dict = Depends(get_current_user)):
        s = await _own_session(sid, user)
        twin_id = s["digital_twin_id"]
        if req.connection_type not in CONNECTION_TYPES:
            raise HTTPException(status_code=400, detail="Invalid connection type.")
        doc = {"id": _nid(), "digital_twin_id": twin_id, "origin_room_id": req.origin_room_id,
               "destination_room_id": req.destination_room_id, "connection_type": req.connection_type,
               "confidence_level": "medium", "source_reference": sid, "created_at": _now()}
        await _db.dt_connections.insert_one(dict(doc))
        doc.pop("_id", None)
        return doc

    @r.post("/capture-sessions/{sid}/complete")
    async def complete_capture(sid: str, user: dict = Depends(get_current_user)):
        s = await _own_session(sid, user)
        twin_id = s["digital_twin_id"]
        open_conflicts = await _db.dt_conflicts.count_documents({"digital_twin_id": twin_id, "status": "open"})
        status = "ready_for_review" if open_conflicts else "completed"
        await _db.dt_capture_sessions.update_one({"id": sid}, {"$set": {"status": status, "completed_at": _now()}})
        await _recompute_confidence(twin_id)
        await _cap(user, "capture_processing_completed", {"capture_type": s["capture_type"], "open_conflicts": open_conflicts})
        return {"session_id": sid, "status": status, "open_conflicts": open_conflicts}

    # ---- conflicts
    @r.get("/conflicts")
    async def list_conflicts(user: dict = Depends(get_current_user)):
        t = await _twin_for_user(user)
        rows = await _db.dt_conflicts.find({"digital_twin_id": t["id"], "status": "open"}, {"_id": 0}).sort("created_at", 1).to_list(200)
        await _cap(user, "capture_review_opened", {})
        return {"conflicts": rows}

    @r.post("/conflicts/{cid}/resolve")
    async def resolve_conflict(cid: str, req: ResolveReq, user: dict = Depends(get_current_user)):
        c = await _db.dt_conflicts.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Conflict not found.")
        await _own_twin(c["digital_twin_id"], user)
        elem = await _db.dt_elements.find_one({"id": c["subject_reference"]}, {"_id": 0})
        detail = c.get("detail", {})
        note = None
        if req.resolution == "use_new" and elem:
            await _db.dt_elements.update_one({"id": elem["id"]}, {"$set": {
                "observed_value": detail.get("new_value"), "source_status": detail.get("new_source"),
                "verification_status": "user_confirmed"}})
            note = f"User chose new value {detail.get('new_value')}."
        elif req.resolution == "manual" and elem and req.manual_value is not None:
            await _db.dt_elements.update_one({"id": elem["id"]}, {"$set": {
                "observed_value": req.manual_value, "source_status": "manual", "verification_status": "user_confirmed"}})
            note = f"User entered {req.manual_value}."
        elif req.resolution == "unknown" and elem:
            await _db.dt_elements.update_one({"id": elem["id"]}, {"$set": {"verification_status": "unverified"}})
            note = "Marked unknown."
        else:  # keep_existing (default) — confirm the existing value
            if elem:
                await _db.dt_elements.update_one({"id": elem["id"]}, {"$set": {"verification_status": "user_confirmed"}})
            note = "User kept existing value."
        await _db.dt_conflicts.update_one({"id": cid}, {"$set": {
            "status": "resolved", "resolution_note": note, "resolved_at": _now()}})
        await _recompute_confidence(c["digital_twin_id"])
        await _cap(user, "spatial_conflict_resolved", {"resolution": req.resolution})
        return {"ok": True, "note": note}

    # ---- Digital Twin API (read context for other features)
    @r.get("/room-context/{dt_room_id}")
    async def room_context(dt_room_id: str, user: dict = Depends(get_current_user)):
        room = await _db.dt_rooms.find_one({"id": dt_room_id}, {"_id": 0})
        if not room:
            raise HTTPException(status_code=404, detail="Room not found.")
        await _own_twin(room["digital_twin_id"], user)
        elements = await _db.dt_elements.find({"room_id": dt_room_id}, {"_id": 0}).to_list(200)
        connections = await _db.dt_connections.find({"$or": [{"origin_room_id": dt_room_id}, {"destination_room_id": dt_room_id}]}, {"_id": 0}).to_list(50)
        await _cap(user, "room_context_used_in_project", {})
        return {"room": room, "elements": elements, "connections": connections,
                "confidence_level": room.get("confidence_level"),
                "note": "Early geometry is approximate unless explicitly verified."}

    return r


# ============================================================= admin router
def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/twin", dependencies=[Depends(require_admin)])

    @r.get("/settings")
    async def get_settings(admin: dict = Depends(require_admin)):
        return await _settings()

    @r.put("/settings")
    async def update_settings(req: SettingsReq, admin: dict = Depends(require_admin)):
        s = await _settings()
        upd = {"updated_at": _now()}
        if req.capture_types_enabled is not None:
            merged = dict(s["capture_types_enabled"])
            merged.update({k: bool(v) for k, v in req.capture_types_enabled.items() if k in CAPTURE_TYPES})
            upd["capture_types_enabled"] = merged
        if req.max_artifacts_free is not None:
            upd["max_artifacts_free"] = max(1, req.max_artifacts_free)
        if req.max_artifacts_pro is not None:
            upd["max_artifacts_pro"] = max(1, req.max_artifacts_pro)
        if req.conflict_threshold is not None:
            upd["conflict_threshold"] = min(0.9, max(0.01, req.conflict_threshold))
        await _db.dt_settings.update_one({"id": "global"}, {"$set": upd})
        return await _settings()

    @r.get("/queue")
    async def queue(admin: dict = Depends(require_admin)):
        processing = await _db.dt_capture_sessions.find({"status": {"$in": ["created", "uploading", "processing", "ready_for_review"]}}, {"_id": 0}).sort("created_at", -1).to_list(100)
        failed = await _db.dt_capture_sessions.find({"status": {"$in": ["failed_retryable", "failed_final"]}}, {"_id": 0}).to_list(100)
        return {"processing": processing, "failed": failed}

    @r.get("/metrics")
    async def metrics(admin: dict = Depends(require_admin)):
        total_sessions = await _db.dt_capture_sessions.count_documents({})
        completed = await _db.dt_capture_sessions.count_documents({"status": {"$in": ["completed", "ready_for_review"]}})
        twins = await _db.dt_twins.count_documents({})
        open_conflicts = await _db.dt_conflicts.count_documents({"status": "open"})
        resolved_conflicts = await _db.dt_conflicts.count_documents({"status": "resolved"})
        conf_dist = {}
        async for t in _db.dt_twins.find({}, {"_id": 0, "confidence_level": 1}):
            conf_dist[t["confidence_level"]] = conf_dist.get(t["confidence_level"], 0) + 1
        source_dist = {}
        async for e in _db.dt_evidence.find({}, {"_id": 0, "source_type": 1}):
            source_dist[e["source_type"]] = source_dist.get(e["source_type"], 0) + 1
        return {"twins": twins, "capture_sessions": total_sessions,
                "completion_rate": round(completed / total_sessions, 2) if total_sessions else 0.0,
                "open_conflicts": open_conflicts, "resolved_conflicts": resolved_conflicts,
                "twin_confidence_distribution": conf_dist, "capture_source_distribution": source_dist}

    return r
