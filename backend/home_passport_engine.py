"""
DIYhomie — Home Passport (Build Document 50).

The homeowner's evolving digital record: one summary of the property, rooms,
assets, documents, measurements, projects and a unified Home Timeline.
Aggregation layer over existing collections — capture flows already live in
room_intelligence / home_intelligence / document_vault / measurement engines.

Reads: hi_properties, hi_rooms, hi_assets, hi_documents, hi_asset_documents,
       hi_projects, hi_measurements, hi_inventory_items, hi_receipts, gr_timeline
Writes: hi_properties (profile fields), hi_analytics
"""
import uuid
from datetime import datetime, timezone
from typing import Optional, Callable

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


async def _track(user_id, event, meta=None):
    try:
        await _db.hi_analytics.insert_one({"id": _nid(), "user_id": user_id, "event": event, "meta": meta or {}, "at": _now()})
    except Exception:
        pass


async def _active_property(user_id: str) -> dict:
    prop = (await _db.hi_properties.find_one({"user_id": user_id, "is_active": True}, {"_id": 0})
            or await _db.hi_properties.find_one({"user_id": user_id}, {"_id": 0}))
    if not prop:
        prop = {"id": _nid(), "user_id": user_id, "name": "My Home", "address": None,
                "property_type": None, "year_built": None, "square_footage": None,
                "stories": None, "created_at": _now()}
        await _db.hi_properties.insert_one(dict(prop))
        prop.pop("_id", None)
    return prop


def _month_label(iso: str) -> str:
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.strftime("%B %Y")
    except Exception:
        return "Earlier"


async def _timeline_events(user_id: str, prop_id: str, room_id: Optional[str] = None, limit: int = 60) -> list:
    """Unified Home Timeline: derived from what actually happened — no separate write hooks."""
    events = []

    # Completed + active projects
    pq = {"user_id": user_id}
    if room_id:
        pq["room_id"] = room_id
    for p in await _db.hi_projects.find(pq, {"_id": 0, "id": 1, "title": 1, "status": 1, "room_id": 1,
                                             "created_at": 1, "updated_at": 1}).to_list(300):
        if p.get("status") == "completed":
            events.append({"type": "project_completed", "title": f"{p.get('title') or 'Project'} completed",
                           "at": p.get("updated_at") or p.get("created_at"), "ref_id": p["id"],
                           "route": f"/home-intel/projects/{p['id']}", "icon": "check-circle-outline"})
        else:
            events.append({"type": "project_started", "title": f"Project started: {p.get('title') or 'Untitled'}",
                           "at": p.get("created_at"), "ref_id": p["id"],
                           "route": f"/home-intel/projects/{p['id']}", "icon": "hammer-wrench"})

    # Assets added
    aq = {"property_id": prop_id}
    if room_id:
        aq["room_id"] = room_id
    for a in await _db.hi_assets.find(aq, {"_id": 0, "id": 1, "name": 1, "category": 1, "created_at": 1}).to_list(300):
        events.append({"type": "asset_added", "title": f"Asset added: {a.get('name') or a.get('category') or 'Item'}",
                       "at": a.get("created_at"), "ref_id": a["id"],
                       "route": f"/home-intel/asset/{a['id']}", "icon": "cube-outline"})

    # Rooms captured
    rq = {"property_id": prop_id, "status": {"$ne": "archived"}}
    if room_id:
        rq["id"] = room_id
    for r in await _db.hi_rooms.find(rq, {"_id": 0, "id": 1, "name": 1, "created_at": 1}).to_list(200):
        events.append({"type": "room_added", "title": f"Room captured: {r.get('name')}",
                       "at": r.get("created_at"), "ref_id": r["id"],
                       "route": f"/home-intel/rooms/{r['id']}", "icon": "floor-plan"})

    # Documents (vault + asset documents)
    if not room_id:
        for d in await _db.hi_documents.find({"user_id": user_id}, {"_id": 0, "id": 1, "title": 1,
                                                                    "doc_type": 1, "created_at": 1}).to_list(200):
            events.append({"type": "document_uploaded",
                           "title": f"Document saved: {d.get('title') or d.get('doc_type') or 'Document'}",
                           "at": d.get("created_at"), "ref_id": d["id"],
                           "route": "/home-intel/documents", "icon": "file-document-outline"})

    # Measurements
    mq = {"user_id": user_id}
    if room_id:
        mq["room_id"] = room_id
    for m in await _db.hi_measurements.find(mq, {"_id": 0, "id": 1, "label": 1, "name": 1, "created_at": 1}).to_list(200):
        events.append({"type": "measurement_captured",
                       "title": f"Measurement captured: {m.get('label') or m.get('name') or 'Measurement'}",
                       "at": m.get("created_at"), "ref_id": m["id"],
                       "route": "/home-intel/measure", "icon": "ruler"})

    # Receipts (Doc 55)
    if not room_id:
        for rc in await _db.hi_receipts.find({"user_id": user_id, "status": "confirmed"},
                                             {"_id": 0, "id": 1, "merchant": 1, "total": 1, "created_at": 1}).to_list(100):
            t = f"Receipt saved: {rc.get('merchant') or 'Purchase'}"
            if rc.get("total") is not None:
                t += f" (${rc['total']})"
            events.append({"type": "receipt_saved", "title": t, "at": rc.get("created_at"),
                           "ref_id": rc["id"], "route": None, "icon": "receipt"})

    # Maintenance completed (Doc 58 — maintenance history in Home Passport)
    if not room_id:
        occ = await _db.hi_maintenance_occurrences.find(
            {"user_id": user_id, "status": "completed"},
            {"_id": 0, "id": 1, "maintenance_task_id": 1, "completed_date": 1}).to_list(200)
        tids = list({o["maintenance_task_id"] for o in occ})
        tmap = {}
        if tids:
            for t in await _db.hi_maintenance_tasks.find({"id": {"$in": tids}},
                                                         {"_id": 0, "id": 1, "title": 1}).to_list(200):
                tmap[t["id"]] = t.get("title")
        for o in occ:
            events.append({"type": "maintenance_completed",
                           "title": f"Maintenance done: {tmap.get(o['maintenance_task_id'], 'Task')}",
                           "at": (o.get("completed_date") or "") + "T12:00:00+00:00" if o.get("completed_date") and "T" not in o["completed_date"] else o.get("completed_date"),
                           "ref_id": o["maintenance_task_id"],
                           "route": f"/home-intel/maintenance/{o['maintenance_task_id']}", "icon": "wrench-check"})

    # Repair/issue timeline (gr_timeline) — completed repairs & pro work
    gq = {"user_id": user_id}
    if room_id:
        gq["room_id"] = room_id
    try:
        for g in await _db.gr_timeline.find(gq, {"_id": 0, "id": 1, "title": 1, "summary": 1,
                                                 "created_at": 1, "at": 1}).to_list(200):
            events.append({"type": "repair_record", "title": g.get("title") or g.get("summary") or "Home record",
                           "at": g.get("created_at") or g.get("at"), "ref_id": g.get("id"),
                           "route": "/home-intel/record", "icon": "history"})
    except Exception:
        pass

    events = [e for e in events if e.get("at")]
    events.sort(key=lambda e: e["at"], reverse=True)
    return events[:limit]


class ProfileReq(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    property_type: Optional[str] = None
    year_built: Optional[int] = None
    square_footage: Optional[int] = None
    stories: Optional[int] = None


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/passport", dependencies=[Depends(get_current_user)])

    @r.get("")
    async def passport(user: dict = Depends(get_current_user)):
        prop = await _active_property(user["id"])
        pid = prop["id"]
        rooms = await _db.hi_rooms.count_documents({"property_id": pid, "status": {"$ne": "archived"}})
        assets = await _db.hi_assets.count_documents({"property_id": pid})
        docs = await _db.hi_documents.count_documents({"user_id": user["id"]})
        docs += await _db.hi_asset_documents.count_documents({"user_id": user["id"]})
        projects_total = await _db.hi_projects.count_documents({"user_id": user["id"]})
        projects_done = await _db.hi_projects.count_documents({"user_id": user["id"], "status": "completed"})
        measurements = await _db.hi_measurements.count_documents({"user_id": user["id"]})
        tools = await _db.hi_inventory_items.count_documents(
            {"user_id": user["id"], "category": "Tool", "status": {"$ne": "archived"}})
        active_projects = await _db.hi_projects.find(
            {"user_id": user["id"], "status": {"$in": ["active", "planned", "draft", "paused"]}},
            {"_id": 0, "id": 1, "title": 1, "status": 1, "room_id": 1}).sort("created_at", -1).to_list(3)
        recent = await _timeline_events(user["id"], pid, limit=5)
        await _track(user["id"], "home_passport_opened", {})
        return {"property": prop,
                "counts": {"rooms": rooms, "assets": assets, "documents": docs,
                           "projects_total": projects_total, "projects_completed": projects_done,
                           "measurements": measurements, "tools": tools},
                "active_projects": active_projects, "recent_events": recent}

    @r.put("/profile")
    async def update_profile(req: ProfileReq, user: dict = Depends(get_current_user)):
        prop = await _active_property(user["id"])
        upd = {"updated_at": _now()}
        for f in ("name", "address", "property_type", "year_built", "square_footage", "stories"):
            v = getattr(req, f)
            if v is not None:
                upd[f] = v
        if len(upd) == 1:
            raise HTTPException(status_code=400, detail="Nothing to update.")
        await _db.hi_properties.update_one({"id": prop["id"]}, {"$set": upd})
        await _track(user["id"], "home_profile_updated", {"fields": [k for k in upd if k != "updated_at"]})
        return await _db.hi_properties.find_one({"id": prop["id"]}, {"_id": 0})

    @r.get("/timeline")
    async def timeline(room_id: Optional[str] = None, limit: int = 60, user: dict = Depends(get_current_user)):
        prop = await _active_property(user["id"])
        events = await _timeline_events(user["id"], prop["id"], room_id=room_id, limit=min(limit, 120))
        # group by month for the Home Timeline UI
        groups, order = {}, []
        for e in events:
            lbl = _month_label(e["at"])
            if lbl not in groups:
                groups[lbl] = []
                order.append(lbl)
            groups[lbl].append(e)
        return {"events": events, "groups": [{"month": m, "events": groups[m]} for m in order],
                "total": len(events)}

    return r
