"""
DIYhomie — Home Intelligence Dashboard & Property Health Timeline (Build Blueprint 32).

Consumer-facing property intelligence. Turns rooms, assets, projects, maintenance, documents,
measurements, risks & upcoming work into ONE actionable home view. Additive & read-mostly:
aggregates live from existing collections (never duplicates them). Stores only lightweight
overrides (snooze/dismiss), user timeline notes, and a dashboard AI-summary preference.

This is NOT a home-value estimate, inspection, insurance score, or safety certification.
Attention ranking never exaggerates risk; normal maintenance is never labeled urgent. Safety
alerts cannot be silently dismissed without acknowledgement.

Collections: dash_overrides, dash_timeline_notes, dash_prefs.
"""
import uuid
import hashlib
from datetime import datetime, timezone, date, timedelta
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None
_llm_json: Optional[Callable] = None

ATTENTION_TYPES = ["safety", "maintenance", "project", "document", "measurement", "professional_job", "suggestion"]
STATUS = ["active", "snoozed", "dismissed", "completed"]
DUE_SOON_DAYS = 14


def _now():
    return datetime.now(timezone.utc).isoformat()


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _nid():
    return str(uuid.uuid4())


def _sid(*parts) -> str:
    return hashlib.sha1((":".join(str(p) for p in parts)).encode()).hexdigest()[:20]


def configure(db, logger, llm_json: Callable):
    global _db, _logger, _llm_json
    _db, _logger, _llm_json = db, logger, llm_json


async def _cap(user_id, event, props=None):
    try:
        import analytics_engine
        await analytics_engine.capture({"id": user_id}, event, props or {})
    except Exception:
        pass


def _sentry(event_type, message):
    try:
        import sentry_sdk
        sentry_sdk.capture_message(f"[dashboard:{event_type}] {message}", level="error")
    except Exception:
        pass


async def _active_property(user_id: str) -> Optional[dict]:
    return (await _db.hi_properties.find_one({"user_id": user_id, "is_active": True}, {"_id": 0})
            or await _db.hi_properties.find_one({"user_id": user_id}, {"_id": 0}))


def _maint_status(due_date: Optional[str]) -> str:
    if not due_date:
        return "upcoming"
    try:
        d = date.fromisoformat(due_date[:10])
    except Exception:
        return "upcoming"
    today = _today()
    if d < today:
        return "overdue"
    if (d - today).days <= DUE_SOON_DAYS:
        return "due_soon"
    return "upcoming"


async def _overrides(user_id: str) -> dict:
    rows = await _db.dash_overrides.find({"user_id": user_id}, {"_id": 0}).to_list(500)
    out = {}
    for r in rows:
        out[r["item_id"]] = r
    return out


# ============================================================= attention engine
async def _build_attention(user: dict, prop: dict) -> list:
    uid, pid = user["id"], prop["id"]
    items = []

    def add(source_type, source_id, atype, priority, status_label, title, desc, action_label, action_route, safety=False):
        items.append({
            "id": _sid(source_type, source_id, atype), "property_id": pid,
            "source_entity_type": source_type, "source_entity_id": source_id,
            "attention_type": atype, "priority": priority, "attention_status": status_label,
            "title": title, "description": desc, "action_label": action_label,
            "action_route": action_route, "is_safety": safety, "status": "active", "created_at": _now()})

    # 1) SAFETY — active emergency/high issues
    try:
        issues = await _db.hi_issues.find({"user_id": uid, "risk_level": {"$in": ["emergency", "high"]},
                                           "status": {"$in": ["active", "unresolved", "escalated"]}},
                                          {"_id": 0, "image_base64": 0}).sort("created_at", -1).to_list(20)
        for iss in issues:
            urgent = iss.get("risk_level") == "emergency"
            add("issue", iss["id"], "safety", 100 if urgent else 90, "Urgent",
                ("Safety: " + (iss.get("user_description") or "Review this issue")[:60]),
                "An active safety concern needs your attention." if urgent else "A high-priority issue is open.",
                "Review guidance", f"/home-intel/guidance?issueId={iss['id']}", safety=True)
    except Exception as e:
        _sentry("attention_ranking_failure", f"issues: {e}")

    # 2) MAINTENANCE — overdue / due soon
    try:
        tasks = await _db.hi_maintenance_tasks.find({"user_id": uid, "status": "active"}, {"_id": 0}).to_list(500)
        for t in tasks:
            st = _maint_status(t.get("due_date"))
            if st == "overdue":
                add("maintenance_task", t["id"], "maintenance", 70, "Needs Attention",
                    t.get("title") or "Maintenance due", "This maintenance task is overdue.",
                    "Open task", f"/home-intel/maintenance/{t['id']}")
            elif st == "due_soon":
                add("maintenance_task", t["id"], "maintenance", 40, "Upcoming",
                    t.get("title") or "Maintenance due soon", f"Due {t.get('due_date','')[:10]}.",
                    "Open task", f"/home-intel/maintenance/{t['id']}")
    except Exception as e:
        _sentry("attention_ranking_failure", f"maintenance: {e}")

    # 3) PROJECTS — blockers + active next step
    try:
        projects = await _db.hi_projects.find({"user_id": uid, "property_id": pid,
                                               "status": {"$in": ["active", "paused", "draft"]}}, {"_id": 0}).sort("updated_at", -1).to_list(50)
        for p in projects:
            blocker = None
            try:
                blocker = await _db.pi_blockers.find_one({"project_id": p["id"], "status": "active"}, {"_id": 0})
            except Exception:
                blocker = None
            if blocker:
                add("project", p["id"], "project", 75, "Needs Attention",
                    f"{p.get('title','Project')} is blocked", (blocker.get("description") or "Resolve the blocker to continue.")[:120],
                    "View blockers", f"/home-intel/projects/{p['id']}")
            elif p.get("status") == "active":
                add("project", p["id"], "project", 55, "Needs Attention",
                    f"Continue {p.get('title','your project')}", "Pick up the next step in this project.",
                    "Open project", f"/home-intel/projects/{p['id']}")
    except Exception as e:
        _sentry("attention_ranking_failure", f"projects: {e}")

    # 4) PROFESSIONAL JOBS — open
    try:
        jobs = await _db.hi_professional_jobs.find({"user_id": uid, "status": {"$nin": ["completed", "closed", "cancelled"]}}, {"_id": 0}).to_list(50)
        for j in jobs:
            add("professional_job", j["id"], "professional_job", 60, "Needs Attention",
                f"Open job: {j.get('title','Professional job')}", "You have an open professional job.",
                "View job", f"/home-intel/jobs")
    except Exception as e:
        _sentry("attention_ranking_failure", f"jobs: {e}")

    # 5) DOCUMENTS — pending review
    try:
        pending_docs = await _db.hi_document_extractions.distinct("document_id", {"status": "pending_review"})
        if pending_docs:
            owned = await _db.hi_documents.find({"user_id": uid, "id": {"$in": pending_docs}}, {"_id": 0, "id": 1}).to_list(50)
            if owned:
                add("document_review", "queue", "document", 35, "Suggested",
                    f"Review {len(owned)} extracted document{'s' if len(owned) != 1 else ''}", "Confirm the details Homie pulled from your documents.",
                    "Review documents", "/home-intel/documents/review")
    except Exception as e:
        _sentry("attention_ranking_failure", f"documents: {e}")

    # 6) SUGGESTIONS — light setup nudges (never guilt-based)
    try:
        room_ct = await _db.hi_rooms.count_documents({"property_id": pid})
        asset_ct = await _db.hi_assets.count_documents({"property_id": pid})
        if room_ct == 0:
            add("setup", "rooms", "suggestion", 20, "Suggested", "Map a room", "Add your first room so guidance fits your home.", "Map my home", "/home-intel/rooms")
        if asset_ct == 0:
            add("setup", "assets", "suggestion", 18, "Suggested", "Add an appliance", "Add an asset to get tailored, asset-aware help.", "Add an asset", "/home-intel/assets")
    except Exception:
        pass

    return items


async def _apply_overrides(user_id: str, items: list) -> list:
    ov = await _overrides(user_id)
    today = _today()
    out = []
    for it in items:
        o = ov.get(it["id"])
        if o:
            if o.get("status") == "dismissed":
                continue
            if o.get("status") == "snoozed":
                su = o.get("snooze_until")
                if su:
                    try:
                        if date.fromisoformat(su[:10]) > today:
                            continue
                    except Exception:
                        pass
        out.append(it)
    out.sort(key=lambda x: x["priority"], reverse=True)
    return out


async def _profile_completion(prop: dict) -> dict:
    pid = prop["id"]
    room_ct = await _db.hi_rooms.count_documents({"property_id": pid})
    asset_ct = await _db.hi_assets.count_documents({"property_id": pid})
    doc_ct = await _db.hi_documents.count_documents({"user_id": prop["user_id"]})
    meas_ct = await _db.hi_measurements.count_documents({"user_id": prop["user_id"]})
    maint_ct = await _db.hi_maintenance_tasks.count_documents({"user_id": prop["user_id"], "status": "active"})
    proj_ct = await _db.hi_projects.count_documents({"property_id": pid})
    areas = [
        {"key": "property", "label": "Property basics", "done": bool(prop.get("home_type") or prop.get("name"))},
        {"key": "rooms", "label": "Rooms mapped", "done": room_ct > 0, "count": room_ct},
        {"key": "assets", "label": "Assets documented", "done": asset_ct > 0, "count": asset_ct},
        {"key": "measurements", "label": "Measurements", "done": meas_ct > 0, "count": meas_ct},
        {"key": "maintenance", "label": "Maintenance schedule", "done": maint_ct > 0, "count": maint_ct},
        {"key": "documents", "label": "Documents", "done": doc_ct > 0, "count": doc_ct},
        {"key": "projects", "label": "Projects", "done": proj_ct > 0, "count": proj_ct},
    ]
    done = len([a for a in areas if a["done"]])
    return {"areas": areas, "completed": done, "total": len(areas),
            "coverage_pct": round(done / len(areas) * 100)}


# ============================================================= timeline
async def _build_timeline(user: dict, prop: dict, filters: dict) -> list:
    uid, pid = user["id"], prop["id"]
    events = []

    def ev(etype, title, desc, occurred_at, source_type, source_id, room_id=None, asset_id=None, project_id=None):
        events.append({"id": _sid(source_type, source_id, etype), "property_id": pid, "event_type": etype,
                       "title": title, "description": desc, "related_entity_type": source_type,
                       "related_entity_id": source_id, "room_id": room_id, "asset_id": asset_id,
                       "project_id": project_id, "visibility": "private", "occurred_at": occurred_at})

    # projects
    for p in await _db.hi_projects.find({"user_id": uid, "property_id": pid}, {"_id": 0}).to_list(200):
        ev("Project started", p.get("title", "Project"), "You started this project.", p.get("created_at", _now()), "project", p["id"], project_id=p["id"])
        if p.get("status") == "completed" and p.get("completed_at"):
            ev("Project completed", p.get("title", "Project"), "You completed this project.", p["completed_at"], "project", p["id"], project_id=p["id"])
    # assets
    for a in await _db.hi_assets.find({"property_id": pid}, {"_id": 0, "photo_base64": 0}).to_list(300):
        ev("Asset installed", a.get("name", "Asset"), f"Added {a.get('category','asset')}.", a.get("created_at", _now()), "asset", a["id"], room_id=a.get("room_id"), asset_id=a["id"])
    # documents
    for d in await _db.hi_documents.find({"user_id": uid}, {"_id": 0, "file_base64": 0, "image_base64": 0}).to_list(300):
        ev("Document uploaded", d.get("title") or d.get("filename") or "Document", "Saved to your Document Vault.", d.get("created_at", _now()), "document", d["id"])
    # measurements
    for m in await _db.hi_measurements.find({"user_id": uid}, {"_id": 0}).to_list(300):
        ev("Measurement recorded", m.get("label") or "Measurement", str(m.get("value") or "") + (f" {m.get('unit','')}" if m.get("unit") else ""), m.get("created_at", _now()), "measurement", m["id"], room_id=m.get("room_id"))
        if m.get("verification_status") == "user_confirmed":
            ev("Measurement confirmed", m.get("label") or "Measurement", "You confirmed this measurement.", m.get("updated_at", m.get("created_at", _now())), "measurement", m["id"], room_id=m.get("room_id"))
    # maintenance completed occurrences
    try:
        for o in await _db.hi_maintenance_occurrences.find({"user_id": uid, "status": "completed"}, {"_id": 0}).sort("completed_date", -1).to_list(200):
            ev("Maintenance completed", o.get("title") or "Maintenance", "Completed a maintenance task.", o.get("completed_date") or o.get("created_at", _now()), "maintenance_occurrence", o["id"])
    except Exception:
        pass
    # professional jobs completed
    try:
        for j in await _db.hi_professional_jobs.find({"user_id": uid, "status": "completed"}, {"_id": 0}).to_list(100):
            ev("Professional work completed", j.get("title", "Professional job"), "A professional job was completed.", j.get("updated_at") or j.get("created_at", _now()), "professional_job", j["id"])
    except Exception:
        pass
    # user notes
    for n in await _db.dash_timeline_notes.find({"property_id": pid}, {"_id": 0}).to_list(300):
        events.append({"id": n["id"], "property_id": pid, "event_type": n.get("event_type", "Note"),
                       "title": n["title"], "description": n.get("description"), "related_entity_type": "note",
                       "related_entity_id": n["id"], "room_id": n.get("room_id"), "asset_id": n.get("asset_id"),
                       "project_id": n.get("project_id"), "visibility": "private", "occurred_at": n["occurred_at"], "is_note": True})

    # filters
    if filters.get("event_type"):
        events = [e for e in events if e["event_type"] == filters["event_type"]]
    if filters.get("room_id"):
        events = [e for e in events if e.get("room_id") == filters["room_id"]]
    if filters.get("asset_id"):
        events = [e for e in events if e.get("asset_id") == filters["asset_id"]]
    if filters.get("project_id"):
        events = [e for e in events if e.get("project_id") == filters["project_id"]]
    if filters.get("date_from"):
        events = [e for e in events if (e.get("occurred_at") or "") >= filters["date_from"]]
    if filters.get("date_to"):
        events = [e for e in events if (e.get("occurred_at") or "") <= filters["date_to"] + "T23:59:59"]

    events.sort(key=lambda x: x.get("occurred_at") or "", reverse=True)
    return events[:200]


# ============================================================= models
class SnoozeReq(BaseModel):
    days: int = 7


class DismissReq(BaseModel):
    acknowledge: bool = False


class NoteReq(BaseModel):
    title: str
    description: Optional[str] = None
    event_type: str = "Note"
    room_id: Optional[str] = None
    asset_id: Optional[str] = None
    project_id: Optional[str] = None
    occurred_at: Optional[str] = None


class SummaryPrefReq(BaseModel):
    ai_summary_enabled: bool


# ============================================================= router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/home-dashboard", dependencies=[Depends(get_current_user)])

    @r.get("/snapshot")
    async def snapshot(user: dict = Depends(get_current_user)):
        prop = await _active_property(user["id"])
        if not prop:
            return {"is_new_user": True, "setup_actions": [
                {"label": "Ask Homie", "route": "/home-intel/chat"},
                {"label": "Add a Room", "route": "/home-intel/rooms"},
                {"label": "Add an Asset", "route": "/home-intel/assets"},
                {"label": "Start a Project", "route": "/home-intel/projects"}]}
        degraded = False
        try:
            items = await _build_attention(user, prop)
            items = await _apply_overrides(user["id"], items)
        except Exception as e:
            _sentry("dashboard_snapshot_failure", str(e)); items = []; degraded = True
        try:
            completion = await _profile_completion(prop)
        except Exception:
            completion = None
        room_ct = await _db.hi_rooms.count_documents({"property_id": prop["id"]})
        asset_ct = await _db.hi_assets.count_documents({"property_id": prop["id"]})
        doc_ct = await _db.hi_documents.count_documents({"user_id": user["id"]})
        active_projects = await _db.hi_projects.count_documents({"user_id": user["id"], "property_id": prop["id"], "status": "active"})
        urgent = [i for i in items if i["attention_status"] == "Urgent"]
        due_maint = [i for i in items if i["attention_type"] == "maintenance"]
        prof_jobs = [i for i in items if i["attention_type"] == "professional_job"]
        prefs = await _db.dash_prefs.find_one({"user_id": user["id"]}, {"_id": 0}) or {}
        return {
            "is_new_user": (room_ct == 0 and asset_ct == 0 and active_projects == 0),
            "degraded": degraded,
            "property": {"id": prop["id"], "name": prop.get("name") or "My Home"},
            "snapshot": {"active_project_count": active_projects, "due_maintenance_count": len(due_maint),
                         "urgent_alert_count": len(urgent), "open_professional_job_count": len(prof_jobs),
                         "room_count": room_ct, "asset_count": asset_ct, "document_count": doc_ct,
                         "generated_at": _now()},
            "top_actions": items[:3],
            "attention": items,
            "profile_completion": completion,
            "ai_summary_enabled": prefs.get("ai_summary_enabled", True),
            "degraded_note": "Some home insights are temporarily unavailable. Your projects and records are still available." if degraded else None,
        }

    @r.get("/attention")
    async def attention(status: Optional[str] = None, user: dict = Depends(get_current_user)):
        prop = await _active_property(user["id"])
        if not prop:
            return {"items": []}
        items = await _apply_overrides(user["id"], await _build_attention(user, prop))
        await _cap(user["id"], "property_dashboard_opened", {})
        return {"items": items}

    @r.post("/attention/{item_id}/snooze")
    async def snooze(item_id: str, req: SnoozeReq, user: dict = Depends(get_current_user)):
        prop = await _active_property(user["id"])
        items = await _build_attention(user, prop) if prop else []
        it = next((i for i in items if i["id"] == item_id), None)
        if not it:
            raise HTTPException(status_code=404, detail="Item not found.")
        if it["is_safety"]:
            raise HTTPException(status_code=409, detail="Safety alerts can't be snoozed. Please review and acknowledge it.")
        until = (_today() + timedelta(days=max(1, min(req.days, 90)))).isoformat()
        await _db.dash_overrides.update_one({"user_id": user["id"], "item_id": item_id},
            {"$set": {"status": "snoozed", "snooze_until": until, "updated_at": _now()},
             "$setOnInsert": {"id": _nid(), "user_id": user["id"], "item_id": item_id}}, upsert=True)
        await _cap(user["id"], "attention_item_snoozed", {"item": item_id})
        return {"ok": True, "snooze_until": until}

    @r.post("/attention/{item_id}/dismiss")
    async def dismiss(item_id: str, req: DismissReq, user: dict = Depends(get_current_user)):
        prop = await _active_property(user["id"])
        items = await _build_attention(user, prop) if prop else []
        it = next((i for i in items if i["id"] == item_id), None)
        if not it:
            raise HTTPException(status_code=404, detail="Item not found.")
        if it["is_safety"] and not req.acknowledge:
            raise HTTPException(status_code=409, detail="This is a safety alert. Please acknowledge that you've reviewed it before dismissing.")
        await _db.dash_overrides.update_one({"user_id": user["id"], "item_id": item_id},
            {"$set": {"status": "dismissed", "acknowledged": bool(req.acknowledge), "updated_at": _now()},
             "$setOnInsert": {"id": _nid(), "user_id": user["id"], "item_id": item_id}}, upsert=True)
        await _cap(user["id"], "attention_item_dismissed", {"item": item_id, "safety": it["is_safety"]})
        return {"ok": True}

    @r.get("/timeline")
    async def timeline(event_type: Optional[str] = None, room_id: Optional[str] = None,
                       asset_id: Optional[str] = None, project_id: Optional[str] = None,
                       date_from: Optional[str] = None, date_to: Optional[str] = None,
                       user: dict = Depends(get_current_user)):
        prop = await _active_property(user["id"])
        if not prop:
            return {"events": [], "event_types": []}
        try:
            events = await _build_timeline(user, prop, {"event_type": event_type, "room_id": room_id,
                     "asset_id": asset_id, "project_id": project_id, "date_from": date_from, "date_to": date_to})
        except Exception as e:
            _sentry("timeline_query_failure", str(e))
            raise HTTPException(status_code=502, detail="Couldn't load your home timeline. Try again.")
        if any([event_type, room_id, asset_id, project_id, date_from, date_to]):
            await _cap(user["id"], "timeline_filtered", {})
        types = sorted({e["event_type"] for e in await _build_timeline(user, prop, {})})
        return {"events": events, "event_types": types}

    @r.post("/timeline/note")
    async def add_note(req: NoteReq, user: dict = Depends(get_current_user)):
        prop = await _active_property(user["id"])
        if not prop:
            raise HTTPException(status_code=400, detail="Set up a home first.")
        if not req.title.strip():
            raise HTTPException(status_code=400, detail="Give your note a title.")
        doc = {"id": _nid(), "property_id": prop["id"], "user_id": user["id"], "title": req.title.strip()[:160],
               "description": (req.description or "").strip()[:1000] or None, "event_type": req.event_type[:60] or "Note",
               "room_id": req.room_id, "asset_id": req.asset_id, "project_id": req.project_id,
               "occurred_at": req.occurred_at or _now(), "created_at": _now()}
        await _db.dash_timeline_notes.insert_one(dict(doc)); doc.pop("_id", None)
        return {"note": doc}

    @r.delete("/timeline/note/{nid}")
    async def delete_note(nid: str, user: dict = Depends(get_current_user)):
        res = await _db.dash_timeline_notes.delete_one({"id": nid, "user_id": user["id"]})
        if not res.deleted_count:
            raise HTTPException(status_code=404, detail="Note not found.")
        return {"ok": True}

    @r.put("/ai-summary/pref")
    async def set_summary_pref(req: SummaryPrefReq, user: dict = Depends(get_current_user)):
        await _db.dash_prefs.update_one({"user_id": user["id"]},
            {"$set": {"ai_summary_enabled": req.ai_summary_enabled, "updated_at": _now()},
             "$setOnInsert": {"user_id": user["id"]}}, upsert=True)
        return {"ok": True, "ai_summary_enabled": req.ai_summary_enabled}

    @r.get("/ai-summary")
    async def ai_summary(user: dict = Depends(get_current_user)):
        prefs = await _db.dash_prefs.find_one({"user_id": user["id"]}, {"_id": 0}) or {}
        if not prefs.get("ai_summary_enabled", True):
            return {"enabled": False, "summary": None}
        prop = await _active_property(user["id"])
        if not prop:
            return {"enabled": True, "summary": "Add a room, asset, or start a project and Homie will summarize what's next."}
        items = await _apply_overrides(user["id"], await _build_attention(user, prop))
        if not items:
            return {"enabled": True, "summary": "You're all caught up — nothing needs your attention right now."}
        facts = "; ".join(f"{i['attention_status']}: {i['title']}" for i in items[:6])
        try:
            system = ("You are Homie, a friendly home assistant. Write ONE short, practical sentence (max 30 words) "
                      "summarizing what the homeowner should focus on, using ONLY the provided items. Do NOT invent "
                      "anything. Do NOT make safety, insurance or financial claims or scores. Return STRICT JSON "
                      '{"summary": string}.')
            data = await _llm_json(system, f"Current items for this home: {facts}", max_tokens=200, feature_area="dashboard_summary")
            summary = (data.get("summary") if isinstance(data, dict) else None) or facts
        except Exception as e:
            _sentry("dashboard_snapshot_failure", f"ai_summary: {e}")
            summary = "Here's what needs attention: " + "; ".join(i["title"] for i in items[:3]) + "."
        await _cap(user["id"], "dashboard_ai_summary_opened", {})
        return {"enabled": True, "summary": summary, "sources": [{"title": i["title"], "route": i["action_route"]} for i in items[:6]]}

    return r


# ============================================================= seed
async def seed_dashboard():
    if _db is None:
        return
    try:
        await _db.dash_overrides.create_index([("user_id", 1), ("item_id", 1)])
        if _logger:
            _logger.info("home dashboard (B32) seeded")
    except Exception as e:
        if _logger:
            _logger.error(f"home dashboard seed failed: {e}")
