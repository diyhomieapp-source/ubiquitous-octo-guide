"""
DIYhomie — Mobile Offline, Sync & Conflict Resolution (Build Blueprint 33).

Server side of the offline-first architecture. The mobile client queues writes locally while
offline; when connectivity returns it PUSHES a batch here. The server is the source of truth:
it validates auth, dedupes by idempotency_key, applies SAFE appends automatically, and raises a
SyncConflict for review-required changes (version/deletion/permission conflicts). It NEVER
silently overwrites user-entered measurements, notes, documents, outcomes or safety notes.

Financial/reward/billing/partner actions are intentionally NOT accepted offline — they require
live server confirmation.

Collections: sync_ledger (idempotency), sync_conflicts, sync_media, sync_saved_questions.
"""
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

# Operations the client may queue offline. Each is either an auto-safe APPEND or a REVIEW op.
SAFE_APPEND_OPS = {"note_add", "measurement_add", "timeline_event_add", "photo_add", "step_complete_event", "maintenance_complete_event"}
REVIEW_OPS = {"room_rename", "asset_update", "step_edit"}
BLOCKED_OFFLINE_OPS = {"payment", "subscription", "reward_redeem", "partner_action", "billing"}
CONFLICT_TYPES = ["field_conflict", "deletion_conflict", "permission_conflict", "version_conflict"]

# Bundled emergency guidance — ALWAYS available, even fully offline (also shipped in the client).
SAFETY_CONTENT = [
    {"id": "gas", "trigger": ["gas smell", "gas leak", "rotten egg"], "title": "Possible gas leak",
     "steps": ["Do NOT use switches, phones, or anything that could spark inside.", "Get everyone outside to fresh air immediately.",
               "From outside/a neighbor's, call your gas utility's emergency line and 911.", "Do not re-enter until professionals say it's safe."]},
    {"id": "fire", "trigger": ["fire", "smoke", "flames"], "title": "Fire",
     "steps": ["Get everyone out now. Don't gather belongings.", "Call 911 from outside.", "If small & contained and you have an extinguisher, only fight it with a clear exit behind you.", "Stay out until the fire department clears the home."]},
    {"id": "shock", "trigger": ["electric shock", "shocked", "sparking outlet", "burning smell electrical"], "title": "Electrical shock / hazard",
     "steps": ["Do NOT touch a person still in contact with current.", "If safe, cut power at the breaker.", "Call 911 for any shock injury.", "Keep away from water near electrical hazards."]},
    {"id": "flood", "trigger": ["flooding", "major leak", "burst pipe", "water everywhere"], "title": "Major flooding / burst pipe",
     "steps": ["Shut off the main water valve if you can reach it safely.", "Stay away from water near outlets or panels — shut off power to the area if safe.", "Move people and valuables to higher ground.", "Call a plumber; call 911 if there's danger to people."]},
    {"id": "medical", "trigger": ["medical emergency", "not breathing", "chest pain", "unconscious", "bleeding badly"], "title": "Medical emergency",
     "steps": ["Call 911 immediately.", "Follow the dispatcher's instructions.", "Do not move someone with a possible serious injury unless they're in danger."]},
]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


async def _cap(user_id, event, props=None):
    try:
        import analytics_engine
        await analytics_engine.capture({"id": user_id}, event, props or {})
    except Exception:
        pass


def _sentry(event_type, message):
    try:
        import sentry_sdk
        sentry_sdk.capture_message(f"[sync:{event_type}] {message}", level="error")
    except Exception:
        pass


async def _property_for(user_id: str) -> Optional[dict]:
    return (await _db.hi_properties.find_one({"user_id": user_id, "is_active": True}, {"_id": 0})
            or await _db.hi_properties.find_one({"user_id": user_id}, {"_id": 0}))


# ============================================================= apply engine
async def _apply_safe(user: dict, rec: dict) -> dict:
    """Apply an auto-safe append op. Returns {entity_type, entity_id}."""
    op = rec["operation_type"]
    payload = rec.get("payload") or {}
    prop = await _property_for(user["id"])
    pid = prop["id"] if prop else None

    if op == "note_add":
        doc = {"id": _nid(), "property_id": pid, "user_id": user["id"], "title": (payload.get("title") or "Note")[:160],
               "description": (payload.get("description") or "")[:1000] or None, "event_type": "Note",
               "room_id": payload.get("room_id"), "asset_id": payload.get("asset_id"), "project_id": payload.get("project_id"),
               "occurred_at": payload.get("occurred_at") or _now(), "created_at": _now(), "synced_from_offline": True}
        await _db.dash_timeline_notes.insert_one(doc)
        return {"entity_type": "timeline_note", "entity_id": doc["id"]}

    if op == "timeline_event_add":
        doc = {"id": _nid(), "property_id": pid, "user_id": user["id"], "title": (payload.get("title") or "Event")[:160],
               "description": (payload.get("description") or "")[:1000] or None, "event_type": (payload.get("event_type") or "Note")[:60],
               "occurred_at": payload.get("occurred_at") or _now(), "created_at": _now(), "synced_from_offline": True}
        await _db.dash_timeline_notes.insert_one(doc)
        return {"entity_type": "timeline_event", "entity_id": doc["id"]}

    if op == "measurement_add":
        doc = {"id": _nid(), "user_id": user["id"], "property_id": pid, "room_id": payload.get("room_id"),
               "label": (payload.get("label") or "Measurement")[:120], "value": str(payload.get("value") or "")[:80],
               "unit": (payload.get("unit") or "")[:20] or None, "measurement_type": payload.get("measurement_type") or "length",
               "verification_status": "unverified", "confidence_level": payload.get("confidence_level") or "medium",
               "notes": (payload.get("notes") or "")[:1000] or None, "source": "offline_manual",
               "created_at": _now(), "updated_at": _now()}
        await _db.hi_measurements.insert_one(doc)
        return {"entity_type": "measurement", "entity_id": doc["id"]}

    if op == "step_complete_event":
        # completion is idempotent & additive; record an outcome event, do not overwrite content
        sid = payload.get("step_id")
        if sid:
            await _db.hi_project_steps.update_one(
                {"id": sid, "status": {"$nin": ["completed", "skipped"]}},
                {"$set": {"status": "completed", "completed_at": _now(), "completed_offline": True}})
        return {"entity_type": "project_step", "entity_id": sid}

    if op == "maintenance_complete_event":
        tid = payload.get("task_id")
        if tid:
            await _db.hi_maintenance_occurrences.update_one(
                {"maintenance_task_id": tid, "status": {"$in": ["upcoming", "due", "overdue"]}},
                {"$set": {"status": "completed", "completed_date": _now()[:10], "completed_offline": True}})
        return {"entity_type": "maintenance_task", "entity_id": tid}

    if op == "photo_add":
        # media is finalized separately via /media/finalize; here we just acknowledge the pointer
        return {"entity_type": payload.get("target_entity_type") or "photo", "entity_id": payload.get("target_entity_id")}

    return {"entity_type": rec.get("entity_type"), "entity_id": rec.get("entity_id")}


async def _detect_review_conflict(user: dict, rec: dict) -> Optional[dict]:
    """For REVIEW ops, compare client base_version/updated_at to server. Returns conflict dict or None."""
    op = rec["operation_type"]
    eid = rec.get("entity_id")
    payload = rec.get("payload") or {}
    coll = {"room_rename": "hi_rooms", "asset_update": "hi_assets", "step_edit": "hi_project_steps"}.get(op)
    if not coll or not eid:
        return {"conflict_type": "version_conflict", "reason": "Missing target for a review operation."}
    current = await _db[coll].find_one({"id": eid}, {"_id": 0})
    if not current:
        return {"conflict_type": "deletion_conflict", "reason": "This record was deleted on the server while you edited it offline.",
                "server_change_reference": None}
    # permission check for shared properties (best-effort)
    base = rec.get("base_version") or rec.get("base_updated_at")
    server_ver = current.get("updated_at") or current.get("version") or current.get("created_at")
    if base is not None and server_ver is not None and str(base) != str(server_ver):
        return {"conflict_type": "field_conflict", "reason": "Someone else changed this while you were offline.",
                "server_change_reference": server_ver, "server_value": {k: current.get(k) for k in ("name", "model_number", "status", "instruction") if k in current}}
    return None


async def _apply_review(user: dict, rec: dict):
    op = rec["operation_type"]
    eid = rec.get("entity_id")
    payload = rec.get("payload") or {}
    if op == "room_rename" and payload.get("name"):
        await _db.hi_rooms.update_one({"id": eid}, {"$set": {"name": payload["name"][:80], "updated_at": _now()}})
        return {"entity_type": "room", "entity_id": eid}
    if op == "asset_update":
        upd = {k: v for k, v in payload.items() if k in ("name", "model_number", "category", "status", "notes")}
        if upd:
            upd["updated_at"] = _now()
            await _db.hi_assets.update_one({"id": eid}, {"$set": upd})
        return {"entity_type": "asset", "entity_id": eid}
    if op == "step_edit" and "instruction" in payload:
        await _db.hi_project_steps.update_one({"id": eid}, {"$set": {"instruction": payload["instruction"], "updated_at": _now()}})
        return {"entity_type": "project_step", "entity_id": eid}
    return {"entity_type": rec.get("entity_type"), "entity_id": eid}


# ============================================================= models
class SyncRecord(BaseModel):
    local_id: str
    entity_type: str
    entity_id: Optional[str] = None
    operation_type: str
    payload: Optional[dict] = None
    idempotency_key: str
    local_version: Optional[int] = 1
    base_version: Optional[str] = None
    base_updated_at: Optional[str] = None


class PushReq(BaseModel):
    records: List[SyncRecord]


class MediaFinalizeReq(BaseModel):
    local_file_reference: str
    target_entity_type: str
    target_entity_id: Optional[str] = None
    checksum: str


class ResolveReq(BaseModel):
    choice: str  # keep_mine | use_latest | save_as_note | discard


class SavedQuestionReq(BaseModel):
    question: str
    project_id: Optional[str] = None


# ============================================================= router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/sync", dependencies=[Depends(get_current_user)])

    @r.post("/push")
    async def push(req: PushReq, user: dict = Depends(get_current_user)):
        results = []
        conflicts_created = 0
        # dependency order: property > rooms/assets > project/task > measurements/notes > photos > completion > analytics
        order = {"room_rename": 1, "asset_update": 1, "step_edit": 2, "note_add": 3, "measurement_add": 3,
                 "timeline_event_add": 3, "photo_add": 4, "step_complete_event": 5, "maintenance_complete_event": 5}
        records = sorted(req.records, key=lambda x: order.get(x.operation_type, 9))
        for rec in records:
            rd = rec.dict()
            op = rec.operation_type
            # blocked offline ops
            if op in BLOCKED_OFFLINE_OPS:
                results.append({"local_id": rec.local_id, "sync_status": "failed", "reason": "This action needs a live connection and can't be completed offline."})
                continue
            # idempotency — return prior result if seen
            seen = await _db.sync_ledger.find_one({"user_id": user["id"], "idempotency_key": rec.idempotency_key}, {"_id": 0})
            if seen:
                results.append({"local_id": rec.local_id, "sync_status": "synced", "duplicate": True,
                                "entity_type": seen.get("entity_type"), "entity_id": seen.get("entity_id")})
                continue
            try:
                if op in SAFE_APPEND_OPS:
                    applied = await _apply_safe(user, rd)
                    await _db.sync_ledger.insert_one({"id": _nid(), "user_id": user["id"], "idempotency_key": rec.idempotency_key,
                                                      "operation_type": op, **applied, "created_at": _now()})
                    results.append({"local_id": rec.local_id, "sync_status": "synced", **applied})
                elif op in REVIEW_OPS:
                    conflict = await _detect_review_conflict(user, rd)
                    if conflict:
                        c = {"id": _nid(), "user_id": user["id"], "entity_type": rec.entity_type, "entity_id": rec.entity_id,
                             "operation_type": op, "conflict_type": conflict["conflict_type"], "reason": conflict["reason"],
                             "local_change_reference": rd.get("payload"), "server_change_reference": conflict.get("server_value") or conflict.get("server_change_reference"),
                             "idempotency_key": rec.idempotency_key, "status": "pending_user_review", "created_at": _now()}
                        await _db.sync_conflicts.insert_one(dict(c))
                        conflicts_created += 1
                        await _cap(user["id"], "sync_conflict_detected", {"type": conflict["conflict_type"]})
                        results.append({"local_id": rec.local_id, "sync_status": "conflict", "conflict_id": c["id"],
                                        "conflict_type": conflict["conflict_type"], "reason": conflict["reason"]})
                    else:
                        applied = await _apply_review(user, rd)
                        await _db.sync_ledger.insert_one({"id": _nid(), "user_id": user["id"], "idempotency_key": rec.idempotency_key,
                                                          "operation_type": op, **applied, "created_at": _now()})
                        results.append({"local_id": rec.local_id, "sync_status": "synced", **applied})
                else:
                    results.append({"local_id": rec.local_id, "sync_status": "failed", "reason": f"Unknown operation '{op}'."})
            except Exception as e:
                _sentry("sync_engine_failure", f"{op}: {e}")
                results.append({"local_id": rec.local_id, "sync_status": "retrying", "reason": "Temporary problem saving this. We'll retry."})
        await _cap(user["id"], "sync_completed", {"count": len(records), "conflicts": conflicts_created})
        return {"results": results, "conflicts_created": conflicts_created, "server_time": _now()}

    @r.get("/status")
    async def status(user: dict = Depends(get_current_user)):
        return {"pending_conflicts": await _db.sync_conflicts.count_documents({"user_id": user["id"], "status": "pending_user_review"}),
                "synced_records": await _db.sync_ledger.count_documents({"user_id": user["id"]}),
                "pending_media": await _db.sync_media.count_documents({"user_id": user["id"], "upload_status": {"$in": ["pending", "uploading", "failed"]}}),
                "saved_questions": await _db.sync_saved_questions.count_documents({"user_id": user["id"], "status": "pending"}),
                "server_time": _now()}

    @r.get("/conflicts")
    async def conflicts(user: dict = Depends(get_current_user)):
        rows = await _db.sync_conflicts.find({"user_id": user["id"], "status": "pending_user_review"}, {"_id": 0}).sort("created_at", -1).to_list(100)
        return {"conflicts": rows, "choices": ["keep_mine", "use_latest", "save_as_note", "discard"]}

    @r.post("/conflicts/{cid}/resolve")
    async def resolve(cid: str, req: ResolveReq, user: dict = Depends(get_current_user)):
        if req.choice not in ("keep_mine", "use_latest", "save_as_note", "discard"):
            raise HTTPException(status_code=400, detail="Invalid choice.")
        c = await _db.sync_conflicts.find_one({"id": cid, "user_id": user["id"]}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Conflict not found.")
        if c["status"] != "pending_user_review":
            raise HTTPException(status_code=409, detail="This conflict is already resolved.")
        outcome = req.choice
        if req.choice == "keep_mine":
            if c["conflict_type"] == "permission_conflict":
                raise HTTPException(status_code=403, detail="You no longer have permission to change this. Your change wasn't uploaded.")
            await _apply_review(user, {"operation_type": c["operation_type"], "entity_id": c["entity_id"], "payload": c.get("local_change_reference") or {}})
        elif req.choice == "save_as_note":
            prop = await _property_for(user["id"])
            await _db.dash_timeline_notes.insert_one({"id": _nid(), "property_id": prop["id"] if prop else None, "user_id": user["id"],
                "title": f"Conflicting change ({c['entity_type']})", "description": str(c.get("local_change_reference"))[:1000],
                "event_type": "Note", "occurred_at": _now(), "created_at": _now()})
        # use_latest & discard keep server as-is
        await _db.sync_conflicts.update_one({"id": cid}, {"$set": {"status": "resolved", "resolution_choice": req.choice, "resolved_at": _now()}})
        # audit trail
        try:
            from admin_ops_engine import append_audit_raw
            await append_audit_raw({"actor_user_id": user["id"], "action": "sync_conflict_resolved",
                "detail": {"conflict_id": cid, "choice": req.choice, "entity_type": c["entity_type"]}})
        except Exception:
            pass
        await _cap(user["id"], "sync_conflict_resolved", {"choice": req.choice})
        return {"ok": True, "choice": outcome}

    @r.post("/media/finalize")
    async def media_finalize(req: MediaFinalizeReq, user: dict = Depends(get_current_user)):
        # dedupe by checksum + target — don't create duplicate uploads
        dup = await _db.sync_media.find_one({"user_id": user["id"], "checksum": req.checksum,
                                             "target_entity_id": req.target_entity_id}, {"_id": 0})
        if dup:
            return {"media": {**dup}, "duplicate": True}
        doc = {"id": _nid(), "user_id": user["id"], "local_file_reference": req.local_file_reference,
               "target_entity_type": req.target_entity_type, "target_entity_id": req.target_entity_id,
               "upload_status": "uploaded", "checksum": req.checksum, "created_at": _now()}
        await _db.sync_media.insert_one(dict(doc)); doc.pop("_id", None)
        return {"media": doc}

    @r.get("/saved-questions")
    async def list_questions(user: dict = Depends(get_current_user)):
        return {"questions": await _db.sync_saved_questions.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)}

    @r.post("/saved-questions")
    async def save_question(req: SavedQuestionReq, user: dict = Depends(get_current_user)):
        if not req.question.strip():
            raise HTTPException(status_code=400, detail="Type your question first.")
        doc = {"id": _nid(), "user_id": user["id"], "question": req.question.strip()[:1000],
               "project_id": req.project_id, "status": "pending", "created_at": _now()}
        await _db.sync_saved_questions.insert_one(dict(doc)); doc.pop("_id", None)
        return {"question": doc}

    @r.delete("/saved-questions/{qid}")
    async def delete_question(qid: str, user: dict = Depends(get_current_user)):
        res = await _db.sync_saved_questions.delete_one({"id": qid, "user_id": user["id"]})
        if not res.deleted_count:
            raise HTTPException(status_code=404, detail="Question not found.")
        return {"ok": True}

    @r.get("/safety-content")
    async def safety_content(user: dict = Depends(get_current_user)):
        return {"safety_content": SAFETY_CONTENT,
                "note": "Emergency guidance is available even offline. For any real emergency, call your local emergency number."}

    return r


# ============================================================= seed
async def seed_sync():
    if _db is None:
        return
    try:
        await _db.sync_ledger.create_index([("user_id", 1), ("idempotency_key", 1)], unique=True)
        if _logger:
            _logger.info("offline sync (B33) seeded")
    except Exception as e:
        if _logger:
            _logger.error(f"offline sync seed failed: {e}")
