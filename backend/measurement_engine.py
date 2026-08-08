"""
DIYhomie — Guided Measurement & AR Capture Foundation (Build Blueprint 15).

Lets users record practical measurements for rooms, assets and projects with an
explicit source + confidence + verification status, so estimates are never
mistaken for survey-grade dimensions. Camera/AR/MeasureAssist are future capture
sources — this phase stores the labels and keeps the data model ready.

NOT in scope: CAD/BIM exports, permit drawings, automated structural measurement.

Collections: hi_measurements, hi_measurement_media, hi_measurement_requests,
hi_measurement_revisions.
"""
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

UNITS = ["inches", "feet", "centimeters", "meters"]
SOURCES = ["manual", "camera_estimate", "ar_future", "measureassist_future", "imported_future"]
VERIFICATION = ["unverified", "user_confirmed", "verified_future"]
CONFIDENCE = ["low", "medium", "high"]
TYPES = ["Room Length", "Wall Width", "Ceiling Height", "Door Opening", "Window Opening",
         "Furniture", "Appliance", "Exterior Area", "Other"]


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


async def _owned(mid: str, user_id: str) -> dict:
    m = await _db.hi_measurements.find_one({"id": mid, "user_id": user_id}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Measurement not found.")
    return m


# ------------------------------------------------------------- models
class CreateReq(BaseModel):
    name: str
    measurement_type: str = "Other"
    length_value: Optional[float] = None
    width_value: Optional[float] = None
    height_value: Optional[float] = None
    unit: str = "feet"
    source: str = "manual"
    confidence_level: str = "medium"
    notes: Optional[str] = None
    property_id: Optional[str] = None
    room_id: Optional[str] = None
    asset_id: Optional[str] = None
    project_id: Optional[str] = None


class UpdateReq(BaseModel):
    name: Optional[str] = None
    length_value: Optional[float] = None
    width_value: Optional[float] = None
    height_value: Optional[float] = None
    unit: Optional[str] = None
    confidence_level: Optional[str] = None
    notes: Optional[str] = None
    room_id: Optional[str] = None
    asset_id: Optional[str] = None
    project_id: Optional[str] = None
    reason: Optional[str] = None


class RequestReq(BaseModel):
    title: str
    measurement_type: str = "Other"
    instructions: Optional[str] = None
    required: bool = True
    project_id: Optional[str] = None
    room_id: Optional[str] = None


class CompleteReq(BaseModel):
    measurement_id: Optional[str] = None
    # or inline create
    create: Optional[CreateReq] = None


def _fmt(m: dict) -> str:
    parts = [f"{v}" for v in [m.get("length_value"), m.get("width_value"), m.get("height_value")] if v is not None]
    return " × ".join(parts) + f" {m.get('unit', '')}" if parts else "—"


def _bucket(m: dict) -> str:
    if m.get("verification_status") == "verified_future":
        return "verified"
    if m.get("source") == "manual":
        return "user_entered"
    if m.get("verification_status") == "user_confirmed":
        return "user_entered"
    return "estimated"


# ============================================================= router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/measurements", dependencies=[Depends(get_current_user)])

    @r.get("")
    async def list_m(room_id: Optional[str] = None, project_id: Optional[str] = None,
                     asset_id: Optional[str] = None, user: dict = Depends(get_current_user)):
        q = {"user_id": user["id"]}
        if room_id:
            q["room_id"] = room_id
        if project_id:
            q["project_id"] = project_id
        if asset_id:
            q["asset_id"] = asset_id
        rows = await _db.hi_measurements.find(q, {"_id": 0}).sort("created_at", -1).to_list(300)
        return {"measurements": rows}

    @r.get("/recent")
    async def recent(user: dict = Depends(get_current_user)):
        rows = await _db.hi_measurements.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(8)
        await _cap(user, "measurement_home_opened", {"source": "measure_home"})
        return {"measurements": rows}

    @r.post("")
    async def create_m(req: CreateReq, user: dict = Depends(get_current_user)):
        if not req.name.strip():
            raise HTTPException(status_code=400, detail="Give this measurement a name.")
        if req.unit not in UNITS:
            raise HTTPException(status_code=400, detail="Invalid unit.")
        if req.source not in SOURCES:
            raise HTTPException(status_code=400, detail="Invalid source.")
        if all(v is None for v in (req.length_value, req.width_value, req.height_value)):
            raise HTTPException(status_code=400, detail="Enter at least one dimension.")
        m = {"id": _nid(), "user_id": user["id"], "property_id": req.property_id, "room_id": req.room_id,
             "asset_id": req.asset_id, "project_id": req.project_id, "name": req.name.strip()[:120],
             "measurement_type": req.measurement_type if req.measurement_type in TYPES else "Other",
             "length_value": req.length_value, "width_value": req.width_value, "height_value": req.height_value,
             "unit": req.unit, "source": req.source,
             "verification_status": "unverified", "confidence_level": req.confidence_level if req.confidence_level in CONFIDENCE else "medium",
             "notes": (req.notes or "")[:1000] or None, "created_at": _now(), "updated_at": _now()}
        await _db.hi_measurements.insert_one(dict(m))
        await _cap(user, "measurement_started", {"source": req.source})
        if req.source == "manual":
            await _cap(user, "manual_measurement_created", {"measurement_type": m["measurement_type"], "unit": req.unit})
        elif req.source == "camera_estimate":
            await _cap(user, "camera_measurement_saved", {"measurement_type": m["measurement_type"]})
        if req.project_id:
            await _cap(user, "measurement_linked_to_project", {})
        m.pop("_id", None)
        return m

    @r.get("/{mid}")
    async def get_m(mid: str, user: dict = Depends(get_current_user)):
        m = await _owned(mid, user["id"])
        media = await _db.hi_measurement_media.find({"measurement_id": mid}, {"_id": 0}).to_list(20)
        revisions = await _db.hi_measurement_revisions.find({"measurement_id": mid}, {"_id": 0}).sort("created_at", -1).to_list(50)
        return {"measurement": m, "media": media, "revisions": revisions}

    @r.put("/{mid}")
    async def update_m(mid: str, req: UpdateReq, user: dict = Depends(get_current_user)):
        m = await _owned(mid, user["id"])
        upd = {"updated_at": _now()}
        changed = []
        for f in ("name", "unit", "confidence_level", "notes", "room_id", "asset_id", "project_id"):
            v = getattr(req, f)
            if v is not None:
                upd[f] = v
        for f in ("length_value", "width_value", "height_value"):
            v = getattr(req, f)
            if v is not None and v != m.get(f):
                changed.append((f, m.get(f), v))
                upd[f] = v
        # record a revision when any dimension changes
        for f, prev, new in changed:
            await _db.hi_measurement_revisions.insert_one({
                "id": _nid(), "measurement_id": mid, "field": f, "previous_value": prev, "new_value": new,
                "changed_by_user_id": user["id"], "reason": req.reason, "created_at": _now()})
        await _db.hi_measurements.update_one({"id": mid}, {"$set": upd})
        await _cap(user, "measurement_edited", {})
        return await _db.hi_measurements.find_one({"id": mid}, {"_id": 0})

    @r.post("/{mid}/confirm")
    async def confirm_m(mid: str, user: dict = Depends(get_current_user)):
        await _owned(mid, user["id"])
        await _db.hi_measurements.update_one({"id": mid}, {"$set": {"verification_status": "user_confirmed", "updated_at": _now()}})
        await _cap(user, "measurement_confirmed", {})
        return await _db.hi_measurements.find_one({"id": mid}, {"_id": 0})

    @r.delete("/{mid}")
    async def delete_m(mid: str, user: dict = Depends(get_current_user)):
        await _owned(mid, user["id"])
        await _db.hi_measurements.delete_one({"id": mid})
        await _db.hi_measurement_media.delete_many({"measurement_id": mid})
        return {"ok": True}

    @r.get("/room/{room_id}/summary")
    async def room_summary(room_id: str, user: dict = Depends(get_current_user)):
        rows = await _db.hi_measurements.find({"user_id": user["id"], "room_id": room_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
        buckets = {"verified": [], "user_entered": [], "estimated": []}
        for m in rows:
            buckets[_bucket(m)].append({**m, "display": _fmt(m)})
        has_estimated = len(buckets["estimated"]) > 0
        return {"room_id": room_id, "buckets": buckets,
                "warning": "Some values are camera estimates. Floor area and material quantities are not auto-calculated from estimates — verify before buying materials." if has_estimated else None}

    # ---- measurement requests (project plans ask for missing data)
    @r.get("/requests/list")
    async def list_requests(project_id: Optional[str] = None, user: dict = Depends(get_current_user)):
        q = {"user_id": user["id"]}
        if project_id:
            q["project_id"] = project_id
        rows = await _db.hi_measurement_requests.find(q, {"_id": 0}).sort("created_at", 1).to_list(100)
        return {"requests": rows}

    @r.post("/requests")
    async def create_request(req: RequestReq, user: dict = Depends(get_current_user)):
        doc = {"id": _nid(), "user_id": user["id"], "project_id": req.project_id, "room_id": req.room_id,
               "title": req.title.strip()[:120], "measurement_type": req.measurement_type,
               "instructions": req.instructions, "required": req.required, "status": "pending",
               "measurement_id": None, "created_at": _now(), "completed_at": None}
        await _db.hi_measurement_requests.insert_one(dict(doc))
        doc.pop("_id", None)
        return doc

    @r.post("/requests/{req_id}/complete")
    async def complete_request(req_id: str, body: CompleteReq, user: dict = Depends(get_current_user)):
        rq = await _db.hi_measurement_requests.find_one({"id": req_id, "user_id": user["id"]}, {"_id": 0})
        if not rq:
            raise HTTPException(status_code=404, detail="Request not found.")
        mid = body.measurement_id
        if not mid and body.create:
            created = await create_m(body.create, user)  # reuse validation
            mid = created["id"]
        if not mid:
            raise HTTPException(status_code=400, detail="Provide a measurement to complete this request.")
        await _db.hi_measurement_requests.update_one({"id": req_id}, {"$set": {
            "status": "completed", "measurement_id": mid, "completed_at": _now()}})
        await _cap(user, "measurement_request_completed", {})
        return await _db.hi_measurement_requests.find_one({"id": req_id}, {"_id": 0})

    @r.post("/requests/{req_id}/skip")
    async def skip_request(req_id: str, user: dict = Depends(get_current_user)):
        res = await _db.hi_measurement_requests.update_one({"id": req_id, "user_id": user["id"]}, {"$set": {"status": "skipped"}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Request not found.")
        return {"ok": True}

    @r.get("/project/{project_id}/summary")
    async def project_summary(project_id: str, user: dict = Depends(get_current_user)):
        measurements = await _db.hi_measurements.find({"user_id": user["id"], "project_id": project_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
        requests = await _db.hi_measurement_requests.find({"user_id": user["id"], "project_id": project_id}, {"_id": 0}).sort("created_at", 1).to_list(100)
        pending = [x for x in requests if x["status"] == "pending"]
        return {"project_id": project_id,
                "measurements": [{**m, "display": _fmt(m), "bucket": _bucket(m)} for m in measurements],
                "requests": requests, "pending_count": len(pending)}

    return r
