"""
DIYhomie — Maintenance Reminders (in-app feed + preferences + push dispatch).

In-app: a friendly reminders feed (overdue / due today / this week) computed from
the user's maintenance tasks, plus a badge count and per-user reminder preferences.
Push: a once-daily scheduler dispatches a summary push to opted-in users who have
overdue/due tasks (works only after deploy + native build).

Collections: hi_reminder_prefs   Shares: hi_maintenance_tasks
"""
import asyncio
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, Callable

from fastapi import APIRouter, Depends
from pydantic import BaseModel

import push_engine

_db = None
_logger = None
DIGEST_FREQ = ["off", "daily", "weekly"]


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


def _now():
    return datetime.now(timezone.utc).isoformat()


def _today():
    return datetime.now(timezone.utc).date()


def _new_id():
    return str(uuid.uuid4())


def _parse(d: str):
    try:
        return datetime.fromisoformat(d[:10]).date()
    except Exception:
        return None


def _status(task: dict) -> str:
    if task.get("status") in ("completed", "skipped", "paused", "archived"):
        return task.get("status")
    due = _parse(task.get("due_date", ""))
    if not due:
        return "upcoming"
    today = _today()
    if due < today:
        return "overdue"
    if due == today:
        return "due_today"
    if due <= today + timedelta(days=7):
        return "this_week"
    return "upcoming"


async def _prefs(user_id: str) -> dict:
    p = await _db.hi_reminder_prefs.find_one({"user_id": user_id}, {"_id": 0})
    if not p:
        p = {"user_id": user_id, "push_enabled": False, "digest_frequency": "weekly",
             "last_push_date": None, "created_at": _now(), "updated_at": _now()}
        await _db.hi_reminder_prefs.insert_one(dict(p))
        p.pop("_id", None)
    return p


async def _compute_feed(user_id: str) -> dict:
    tasks = await _db.hi_maintenance_tasks.find(
        {"user_id": user_id, "status": {"$nin": ["archived", "completed"]}}, {"_id": 0}).to_list(1000)
    aids = list({t["asset_id"] for t in tasks if t.get("asset_id")})
    amap = {a["id"]: a["name"] for a in await _db.hi_assets.find({"id": {"$in": aids}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)} if aids else {}
    overdue, due_today, this_week = [], [], []
    for t in tasks:
        s = _status(t)
        t["asset_name"] = amap.get(t.get("asset_id"))
        row = {"id": t["id"], "title": t["title"], "category": t.get("category"),
               "priority": t.get("priority"), "due_date": t.get("due_date"), "asset_name": t.get("asset_name")}
        if s == "overdue":
            overdue.append(row)
        elif s == "due_today":
            due_today.append(row)
        elif s == "this_week":
            this_week.append(row)
    overdue.sort(key=lambda x: x.get("due_date") or "")
    this_week.sort(key=lambda x: x.get("due_date") or "")
    return {"overdue": overdue, "due_today": due_today, "this_week": this_week,
            "counts": {"overdue": len(overdue), "due_today": len(due_today),
                       "this_week": len(this_week), "badge": len(overdue) + len(due_today)}}


# =============================================================== models
class PrefsReq(BaseModel):
    push_enabled: Optional[bool] = None
    digest_frequency: Optional[str] = None


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/reminders", dependencies=[Depends(get_current_user)])

    @r.get("/feed")
    async def feed(user: dict = Depends(get_current_user)):
        data = await _compute_feed(user["id"])
        c = data["counts"]
        if c["overdue"] == 0 and c["due_today"] == 0 and c["this_week"] == 0:
            data["headline"] = "You're all caught up — nothing needs attention this week. 🎉"
        elif c["overdue"] > 0:
            data["headline"] = f"{c['overdue']} task{'s' if c['overdue'] != 1 else ''} overdue — let's knock them out."
        else:
            data["headline"] = f"{c['due_today'] + c['this_week']} task{'s' if (c['due_today'] + c['this_week']) != 1 else ''} coming up this week."
        return data

    @r.get("/badge")
    async def badge(user: dict = Depends(get_current_user)):
        data = await _compute_feed(user["id"])
        return {"count": data["counts"]["badge"]}

    @r.get("/preferences")
    async def get_prefs(user: dict = Depends(get_current_user)):
        return await _prefs(user["id"])

    @r.put("/preferences")
    async def set_prefs(req: PrefsReq, user: dict = Depends(get_current_user)):
        await _prefs(user["id"])
        upd = {"updated_at": _now()}
        if req.push_enabled is not None:
            upd["push_enabled"] = bool(req.push_enabled)
        if req.digest_frequency in DIGEST_FREQ:
            upd["digest_frequency"] = req.digest_frequency
        await _db.hi_reminder_prefs.update_one({"user_id": user["id"]}, {"$set": upd})
        return await _db.hi_reminder_prefs.find_one({"user_id": user["id"]}, {"_id": 0})

    @r.post("/test-push")
    async def test_push(user: dict = Depends(get_current_user)):
        """Send a test push to the current user (works only on a native build)."""
        try:
            await push_engine.send_push(
                recipients=[user["id"]],
                data={"title": "DIYhomie test 🔔", "message": "Push notifications are working! You'll get home-care reminders here.",
                      "action_url": "/home-intel/maintenance/reminders"},
                idempotency_key=f"test-{user['id']}-{_today().isoformat()}")
            return {"ok": True, "sent": True}
        except Exception as e:
            if _logger:
                _logger.warning(f"test push failed: {e}")
            return {"ok": True, "sent": False, "note": "Push only works after you deploy and generate a native build."}

    return r


# =============================================================== daily scheduler
async def scheduler_loop():
    """Once-daily push digest to opted-in users with overdue/due tasks."""
    await asyncio.sleep(20)
    if _logger:
        _logger.info("maintenance reminder scheduler loop started")
    while True:
        try:
            today = _today().isoformat()
            weekday = _today().weekday()  # Monday=0
            prefs = await _db.hi_reminder_prefs.find({"push_enabled": True}, {"_id": 0}).to_list(5000)
            for p in prefs:
                freq = p.get("digest_frequency", "weekly")
                if freq == "off":
                    continue
                if freq == "weekly" and weekday != 0:
                    continue
                if p.get("last_push_date") == today:
                    continue
                data = await _compute_feed(p["user_id"])
                badge = data["counts"]["badge"]
                if badge <= 0:
                    continue
                msg = (f"{data['counts']['overdue']} overdue and {data['counts']['due_today']} due today."
                       if data["counts"]["overdue"] else "You have home-care tasks coming up.")
                try:
                    await push_engine.send_push(
                        recipients=[p["user_id"]],
                        data={"title": "Home care reminder 🏠", "message": msg,
                              "action_url": "/home-intel/maintenance/reminders"},
                        idempotency_key=f"digest-{p['user_id']}-{today}")
                    await _db.hi_reminder_prefs.update_one({"user_id": p["user_id"]}, {"$set": {"last_push_date": today}})
                except Exception as e:
                    if _logger:
                        _logger.warning(f"reminder push failed for {p['user_id']}: {e}")
        except Exception as e:
            if _logger:
                _logger.warning(f"reminder scheduler tick failed: {e}")
        await asyncio.sleep(3600)  # re-check hourly; per-user daily guard prevents dupes
