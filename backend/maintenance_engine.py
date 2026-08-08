"""
DIYhomie — Maintenance Intelligence & Home Care Scheduler (Build Blueprint 04).

Turns assets, rooms, projects and manual entries into a simple recurring
home-care plan. Each recurrence is a separate MaintenanceOccurrence (history is
never overwritten). AI suggestions are grounded on the user's real assets /
manuals / season and can be accepted, edited or dismissed.

NOTE: reminder *sending* (push/email) needs a native build + notification infra;
this phase computes in-app due/overdue/upcoming and stores reminder preferences,
but does not dispatch push/email.

Collections: hi_maintenance_tasks, hi_maintenance_checklist,
             hi_maintenance_occurrences, hi_maintenance_suggestions
Shares: hi_properties, hi_rooms, hi_assets, hi_asset_documents, hi_analytics
"""
import uuid
from datetime import datetime, timezone, date, timedelta
from typing import Optional, Callable, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None
_llm_json: Callable = None

FREQ = {"one_time": None, "monthly": 30, "quarterly": 91, "biannual": 182, "annual": 365, "custom": None}
PRIORITIES = ["low", "medium", "high"]
SEASONS = ["Spring", "Summer", "Fall", "Winter"]


def configure(db, logger, llm_json: Callable):
    global _db, _logger, _llm_json
    _db, _logger, _llm_json = db, logger, llm_json


def _now():
    return datetime.now(timezone.utc).isoformat()


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _new_id():
    return str(uuid.uuid4())


async def _track(user_id, event, meta=None):
    try:
        await _db.hi_analytics.insert_one({"id": _new_id(), "user_id": user_id, "event": event, "meta": meta or {}, "at": _now()})
    except Exception:
        pass


async def _get_or_create_property(user_id):
    prop = (await _db.hi_properties.find_one({"user_id": user_id, "is_active": True}, {"_id": 0})
            or await _db.hi_properties.find_one({"user_id": user_id}, {"_id": 0}))
    if not prop:
        prop = {"id": _new_id(), "user_id": user_id, "name": "My Home", "address": None,
                "property_type": None, "created_at": _now()}
        await _db.hi_properties.insert_one(dict(prop))
    return prop


def _parse(d: str) -> Optional[date]:
    try:
        return datetime.fromisoformat(d[:10]).date()
    except Exception:
        return None


def _compute_status(task: dict) -> str:
    if task.get("status") in ("completed", "skipped", "paused"):
        return task["status"]
    due = _parse(task.get("due_date", ""))
    if not due:
        return "upcoming"
    today = _today()
    if due < today:
        return "overdue"
    if due <= today + timedelta(days=7):
        return "due"
    return "upcoming"


def _next_due(freq: str, custom_days: Optional[int], from_date: date) -> Optional[str]:
    if freq == "custom" and custom_days:
        return (from_date + timedelta(days=int(custom_days))).isoformat()
    days = FREQ.get(freq)
    if not days:
        return None
    return (from_date + timedelta(days=days)).isoformat()


def _season_now() -> str:
    m = _today().month
    return {12: "Winter", 1: "Winter", 2: "Winter", 3: "Spring", 4: "Spring", 5: "Spring",
            6: "Summer", 7: "Summer", 8: "Summer", 9: "Fall", 10: "Fall", 11: "Fall"}[m]


# =============================================================== models
class TaskReq(BaseModel):
    title: str
    category: str = "General"
    description: Optional[str] = None
    room_id: Optional[str] = None
    asset_id: Optional[str] = None
    project_id: Optional[str] = None
    priority: str = "medium"
    frequency_type: str = "one_time"
    custom_interval_days: Optional[int] = None
    due_date: str
    notes: Optional[str] = None
    season: Optional[str] = None


class TaskEditReq(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    priority: Optional[str] = None
    notes: Optional[str] = None
    frequency_type: Optional[str] = None
    custom_interval_days: Optional[int] = None


class CompleteReq(BaseModel):
    notes: Optional[str] = None
    cost: Optional[str] = None
    material_used: Optional[str] = None
    completion_photo_base64: Optional[str] = None
    next_recommended_date: Optional[str] = None


class RescheduleReq(BaseModel):
    due_date: str


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/maintenance", dependencies=[Depends(get_current_user)])

    async def _owned(task_id, user_id):
        t = await _db.hi_maintenance_tasks.find_one({"id": task_id, "user_id": user_id}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Task not found.")
        return t

    async def _decorate(tasks: list) -> list:
        aids = list({t["asset_id"] for t in tasks if t.get("asset_id")})
        rids = list({t["room_id"] for t in tasks if t.get("room_id")})
        amap = {a["id"]: a["name"] for a in await _db.hi_assets.find({"id": {"$in": aids}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)} if aids else {}
        rmap = {rm["id"]: rm["name"] for rm in await _db.hi_rooms.find({"id": {"$in": rids}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)} if rids else {}
        for t in tasks:
            t["computed_status"] = _compute_status(t)
            t["asset_name"] = amap.get(t.get("asset_id"))
            t["room_name"] = rmap.get(t.get("room_id"))
        return tasks

    # -------------------------------------------------- home
    @r.get("/home")
    async def home(user: dict = Depends(get_current_user)):
        await _track(user["id"], "maintenance_home_opened", {})
        tasks = await _db.hi_maintenance_tasks.find(
            {"user_id": user["id"], "status": {"$ne": "archived"}}, {"_id": 0}).to_list(1000)
        await _decorate(tasks)
        due_now = [t for t in tasks if t["computed_status"] in ("due", "overdue")]
        due_soon = [t for t in tasks if t["computed_status"] == "upcoming"]
        completed = await _db.hi_maintenance_occurrences.find(
            {"user_id": user["id"], "status": "completed"}, {"_id": 0}).sort("completed_date", -1).limit(6).to_list(6)
        season = _season_now()
        seasonal = [t for t in tasks if (t.get("season") == season)]
        # Home Care Score: completed vs (completed+overdue) among recurring-ish activity
        done_ct = await _db.hi_maintenance_occurrences.count_documents({"user_id": user["id"], "status": "completed"})
        overdue_ct = len([t for t in tasks if t["computed_status"] == "overdue"])
        score = round(done_ct / (done_ct + overdue_ct) * 100) if (done_ct + overdue_ct) else 100
        return {"due_now": due_now, "due_soon": due_soon[:10], "completed_recently": completed,
                "seasonal": seasonal[:10], "season": season, "home_care_score": score,
                "score_note": "Based only on your completed vs overdue tasks — not a property-value or inspection score."}

    # -------------------------------------------------- list
    @r.get("/tasks")
    async def list_tasks(tab: Optional[str] = None, room_id: Optional[str] = None,
                         asset_id: Optional[str] = None, category: Optional[str] = None,
                         season: Optional[str] = None, user: dict = Depends(get_current_user)):
        q = {"user_id": user["id"], "status": {"$ne": "archived"}}
        if room_id:
            q["room_id"] = room_id
        if asset_id:
            q["asset_id"] = asset_id
        if category:
            q["category"] = category
        if season:
            q["season"] = season
        tasks = await _db.hi_maintenance_tasks.find(q, {"_id": 0}).sort("due_date", 1).to_list(1000)
        await _decorate(tasks)
        if tab == "due":
            tasks = [t for t in tasks if t["computed_status"] in ("due", "overdue")]
        elif tab == "upcoming":
            tasks = [t for t in tasks if t["computed_status"] == "upcoming"]
        elif tab == "completed":
            tasks = [t for t in tasks if t["computed_status"] == "completed"]
        return {"tasks": tasks}

    # -------------------------------------------------- create
    @r.post("/tasks")
    async def create_task(req: TaskReq, user: dict = Depends(get_current_user)):
        if not req.title.strip():
            raise HTTPException(status_code=400, detail="Task title is required.")
        prop = await _get_or_create_property(user["id"])
        freq = req.frequency_type if req.frequency_type in FREQ else "one_time"
        tid = _new_id()
        doc = {
            "id": tid, "user_id": user["id"], "property_id": prop["id"],
            "room_id": req.room_id, "asset_id": req.asset_id, "project_id": req.project_id,
            "title": req.title.strip()[:120], "category": (req.category or "General")[:50],
            "description": req.description, "priority": req.priority if req.priority in PRIORITIES else "medium",
            "frequency_type": freq, "custom_interval_days": req.custom_interval_days,
            "due_date": req.due_date[:10], "status": "active", "source": "user_created",
            "source_reason": None, "season": req.season if req.season in SEASONS else None,
            "created_at": _now(), "updated_at": _now(),
        }
        await _db.hi_maintenance_tasks.insert_one(dict(doc))
        await _db.hi_maintenance_occurrences.insert_one({
            "id": _new_id(), "maintenance_task_id": tid, "user_id": user["id"],
            "scheduled_date": doc["due_date"], "completed_date": None, "status": "upcoming",
            "notes": None, "cost": None, "created_at": _now()})
        await _track(user["id"], "maintenance_task_created", {"task_id": tid})
        doc.pop("_id", None)
        doc["computed_status"] = _compute_status(doc)
        return doc

    # -------------------------------------------------- detail
    @r.get("/tasks/{task_id}")
    async def task_detail(task_id: str, user: dict = Depends(get_current_user)):
        t = await _owned(task_id, user["id"])
        await _decorate([t])
        checklist = await _db.hi_maintenance_checklist.find({"maintenance_task_id": task_id}, {"_id": 0}).sort("sequence_number", 1).to_list(50)
        occurrences = await _db.hi_maintenance_occurrences.find({"maintenance_task_id": task_id}, {"_id": 0, "completion_photo_base64": 0}).sort("scheduled_date", -1).to_list(100)
        return {"task": t, "checklist": checklist, "occurrences": occurrences}

    @r.put("/tasks/{task_id}")
    async def edit_task(task_id: str, req: TaskEditReq, user: dict = Depends(get_current_user)):
        await _owned(task_id, user["id"])
        upd = {"updated_at": _now()}
        for f in ("title", "category", "notes"):
            v = getattr(req, f)
            if v is not None:
                upd[f] = v
        if req.priority in PRIORITIES:
            upd["priority"] = req.priority
        if req.frequency_type in FREQ:
            upd["frequency_type"] = req.frequency_type
        if req.custom_interval_days is not None:
            upd["custom_interval_days"] = req.custom_interval_days
        await _db.hi_maintenance_tasks.update_one({"id": task_id}, {"$set": upd})
        return await _db.hi_maintenance_tasks.find_one({"id": task_id}, {"_id": 0})

    # -------------------------------------------------- complete (creates next occurrence)
    @r.post("/tasks/{task_id}/complete")
    async def complete_task(task_id: str, req: CompleteReq, user: dict = Depends(get_current_user)):
        t = await _owned(task_id, user["id"])
        # close the open occurrence
        await _db.hi_maintenance_occurrences.update_one(
            {"maintenance_task_id": task_id, "status": {"$in": ["upcoming", "due", "overdue"]}},
            {"$set": {"status": "completed", "completed_date": _today().isoformat(),
                      "notes": req.notes, "cost": req.cost, "material_used": req.material_used,
                      "completion_photo_base64": req.completion_photo_base64}})
        await _track(user["id"], "maintenance_task_completed", {"task_id": task_id})
        freq = t.get("frequency_type", "one_time")
        base = _parse(req.next_recommended_date) if req.next_recommended_date else _today()
        nxt = req.next_recommended_date[:10] if req.next_recommended_date else _next_due(freq, t.get("custom_interval_days"), base or _today())
        if nxt:
            await _db.hi_maintenance_tasks.update_one({"id": task_id}, {"$set": {"due_date": nxt, "status": "active", "updated_at": _now()}})
            await _db.hi_maintenance_occurrences.insert_one({
                "id": _new_id(), "maintenance_task_id": task_id, "user_id": user["id"],
                "scheduled_date": nxt, "completed_date": None, "status": "upcoming", "notes": None, "cost": None, "created_at": _now()})
            return {"ok": True, "recurring": True, "next_due": nxt}
        await _db.hi_maintenance_tasks.update_one({"id": task_id}, {"$set": {"status": "completed", "updated_at": _now()}})
        return {"ok": True, "recurring": False}

    @r.post("/tasks/{task_id}/skip")
    async def skip_task(task_id: str, user: dict = Depends(get_current_user)):
        t = await _owned(task_id, user["id"])
        await _db.hi_maintenance_occurrences.update_one(
            {"maintenance_task_id": task_id, "status": {"$in": ["upcoming", "due", "overdue"]}},
            {"$set": {"status": "skipped", "completed_date": _today().isoformat()}})
        await _track(user["id"], "maintenance_task_skipped", {"task_id": task_id})
        nxt = _next_due(t.get("frequency_type", "one_time"), t.get("custom_interval_days"), _today())
        if nxt:
            await _db.hi_maintenance_tasks.update_one({"id": task_id}, {"$set": {"due_date": nxt, "updated_at": _now()}})
            await _db.hi_maintenance_occurrences.insert_one({
                "id": _new_id(), "maintenance_task_id": task_id, "user_id": user["id"],
                "scheduled_date": nxt, "completed_date": None, "status": "upcoming", "notes": None, "cost": None, "created_at": _now()})
        return {"ok": True, "next_due": nxt}

    @r.post("/tasks/{task_id}/reschedule")
    async def reschedule(task_id: str, req: RescheduleReq, user: dict = Depends(get_current_user)):
        await _owned(task_id, user["id"])
        await _db.hi_maintenance_tasks.update_one({"id": task_id}, {"$set": {"due_date": req.due_date[:10], "updated_at": _now()}})
        await _db.hi_maintenance_occurrences.update_one(
            {"maintenance_task_id": task_id, "status": {"$in": ["upcoming", "due", "overdue"]}},
            {"$set": {"scheduled_date": req.due_date[:10], "status": "upcoming"}})
        await _track(user["id"], "maintenance_task_rescheduled", {"task_id": task_id})
        return {"ok": True, "due_date": req.due_date[:10]}

    @r.put("/tasks/{task_id}/pause")
    async def pause(task_id: str, resume: bool = False, user: dict = Depends(get_current_user)):
        await _owned(task_id, user["id"])
        await _db.hi_maintenance_tasks.update_one({"id": task_id}, {"$set": {"status": "active" if resume else "paused", "updated_at": _now()}})
        return {"ok": True}

    @r.delete("/tasks/{task_id}")
    async def archive(task_id: str, user: dict = Depends(get_current_user)):
        await _owned(task_id, user["id"])
        await _db.hi_maintenance_tasks.update_one({"id": task_id}, {"$set": {"status": "archived", "updated_at": _now()}})
        await _track(user["id"], "maintenance_task_archived", {"task_id": task_id})
        return {"ok": True}

    # -------------------------------------------------- calendar
    @r.get("/calendar")
    async def calendar(month: Optional[str] = None, user: dict = Depends(get_current_user)):
        occ = await _db.hi_maintenance_occurrences.find(
            {"user_id": user["id"], "status": {"$in": ["upcoming", "due", "overdue"]}},
            {"_id": 0, "completion_photo_base64": 0}).to_list(1000)
        by_day: dict = {}
        for o in occ:
            d = (o.get("scheduled_date") or "")[:10]
            by_day.setdefault(d, 0)
            by_day[d] += 1
        return {"counts_by_day": by_day, "occurrences": occ}

    # -------------------------------------------------- seasonal
    @r.get("/seasonal")
    async def seasonal(user: dict = Depends(get_current_user)):
        await _track(user["id"], "seasonal_checklist_opened", {})
        tasks = await _db.hi_maintenance_tasks.find(
            {"user_id": user["id"], "status": {"$ne": "archived"}, "season": {"$in": SEASONS}}, {"_id": 0}).to_list(500)
        await _decorate(tasks)
        groups = {s: [t for t in tasks if t.get("season") == s] for s in SEASONS}
        return {"season_now": _season_now(), "groups": groups}

    # -------------------------------------------------- AI suggestions
    @r.post("/suggestions/generate")
    async def generate_suggestions(user: dict = Depends(get_current_user)):
        prop = await _get_or_create_property(user["id"])
        assets = await _db.hi_assets.find({"property_id": prop["id"]}, {"_id": 0}).to_list(200)
        # dismissed/accepted titles to avoid repeats
        prior = await _db.hi_maintenance_suggestions.find(
            {"user_id": user["id"], "status": {"$in": ["dismissed", "accepted"]}}, {"_id": 0, "suggested_title": 1}).to_list(500)
        avoid = {p["suggested_title"].lower() for p in prior}
        asset_lines = "\n".join(f"- {a['name']} ({a.get('category')}), installed {a.get('installation_date') or 'unknown'}" for a in assets[:30]) or "No assets recorded."
        season = _season_now()
        system = (
            "You suggest practical recurring home-maintenance tasks. Base each suggestion on the "
            "user's real assets and the current season. Be honest and concise. Never imply skipped "
            "maintenance will definitely cause failure, and never claim it ensures safety, warranty, "
            "insurance or code compliance. Return STRICT JSON: {\"suggestions\": [{\"suggested_title\": "
            "string, \"reason\": string (state it's based on the asset/season/general guidance), "
            "\"recommended_frequency\": one of [monthly, quarterly, biannual, annual], "
            "\"asset_name\": string|null, \"confidence_level\": one of [Likely, General]}]}. "
            "Return at most 6 suggestions.")
        try:
            data = await _llm_json(system, f"Season: {season}\nAssets:\n{asset_lines}", max_tokens=900)
        except Exception as e:
            if _logger:
                _logger.warning(f"maint suggest failed: {e}")
            data = {}
        created = []
        for s in (data.get("suggestions", []) if isinstance(data, dict) else []):
            title = str(s.get("suggested_title", "")).strip()
            if not title or title.lower() in avoid:
                continue
            aid = None
            an = s.get("asset_name")
            if an:
                match = next((a for a in assets if a["name"].lower() == str(an).lower()), None)
                aid = match["id"] if match else None
            doc = {"id": _new_id(), "user_id": user["id"], "property_id": prop["id"], "room_id": None,
                   "asset_id": aid, "suggested_title": title[:120], "reason": str(s.get("reason", ""))[:400],
                   "recommended_frequency": s.get("recommended_frequency") if s.get("recommended_frequency") in FREQ else "annual",
                   "confidence_level": s.get("confidence_level") if s.get("confidence_level") in ("Likely", "General") else "General",
                   "status": "pending", "created_at": _now()}
            await _db.hi_maintenance_suggestions.insert_one(dict(doc))
            avoid.add(title.lower())
            doc.pop("_id", None)
            created.append(doc)
            await _track(user["id"], "maintenance_suggestion_shown", {"suggestion_id": doc["id"]})
        pending = await _db.hi_maintenance_suggestions.find({"user_id": user["id"], "status": "pending"}, {"_id": 0}).sort("created_at", -1).to_list(50)
        return {"generated": len(created), "suggestions": pending}

    @r.get("/suggestions")
    async def list_suggestions(user: dict = Depends(get_current_user)):
        return {"suggestions": await _db.hi_maintenance_suggestions.find({"user_id": user["id"], "status": "pending"}, {"_id": 0}).sort("created_at", -1).to_list(50)}

    @r.post("/suggestions/{sug_id}/accept")
    async def accept_suggestion(sug_id: str, user: dict = Depends(get_current_user)):
        s = await _db.hi_maintenance_suggestions.find_one({"id": sug_id, "user_id": user["id"]}, {"_id": 0})
        if not s:
            raise HTTPException(status_code=404, detail="Suggestion not found.")
        freq = s.get("recommended_frequency", "annual")
        due = _next_due(freq, None, _today()) or (_today() + timedelta(days=30)).isoformat()
        tid = _new_id()
        await _db.hi_maintenance_tasks.insert_one({
            "id": tid, "user_id": user["id"], "property_id": s["property_id"], "room_id": s.get("room_id"),
            "asset_id": s.get("asset_id"), "project_id": None, "title": s["suggested_title"],
            "category": "General", "description": s.get("reason"), "priority": "medium",
            "frequency_type": freq, "custom_interval_days": None, "due_date": due, "status": "active",
            "source": "ai_suggested", "source_reason": s.get("reason"), "season": None,
            "created_at": _now(), "updated_at": _now()})
        await _db.hi_maintenance_occurrences.insert_one({
            "id": _new_id(), "maintenance_task_id": tid, "user_id": user["id"], "scheduled_date": due,
            "completed_date": None, "status": "upcoming", "notes": None, "cost": None, "created_at": _now()})
        await _db.hi_maintenance_suggestions.update_one({"id": sug_id}, {"$set": {"status": "accepted"}})
        await _track(user["id"], "maintenance_suggestion_accepted", {"suggestion_id": sug_id, "task_id": tid})
        return {"ok": True, "task_id": tid}

    @r.post("/suggestions/{sug_id}/dismiss")
    async def dismiss_suggestion(sug_id: str, user: dict = Depends(get_current_user)):
        res = await _db.hi_maintenance_suggestions.update_one({"id": sug_id, "user_id": user["id"]}, {"$set": {"status": "dismissed"}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Suggestion not found.")
        await _track(user["id"], "maintenance_suggestion_dismissed", {"suggestion_id": sug_id})
        return {"ok": True}

    return r
