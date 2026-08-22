"""
DIYhomie — Project Completion, Rewards & Homie Celebration Engine
(Build Document 63).

Reusable, asset-driven celebration on verified project completion: permanent
ProjectCompletion records, achievement evaluation, one seeded original
celebration package (HOMIE_VICTORY_01 — config-driven, never AI-generated at
runtime), user preferences incl. reduced-motion fallback, skip tracking, and
automatic maintenance follow-up creation.

Collections: cel_packages, cel_prefs, cel_events, hi_project_completions,
hi_user_achievements.
Shares: hi_projects, hi_project_steps, hi_maintenance_tasks, hi_analytics.
"""
import random
import uuid
from datetime import datetime, timezone, timedelta
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

# One original, reusable package (Doc 63 MVP). Asset-driven config; media assets
# are represented as config the mobile client renders with its own primitives
# (confetti cannon + text + timed events) — no copyrighted material.
DEFAULT_PACKAGE = {
    "id": "HOMIE_VICTORY_01",
    "name": "Homie Victory 01",
    "voice_line": "Boom! You did it!",
    "subtitle": "Homie is doing the victory dance.",
    "confetti_colors": ["#FF7A00", "#FFFFFF", "#FFD700"],
    "duration_seconds": 7,
    "events": [
        {"at_ms": 0, "event": "CELEBRATION_START"},
        {"at_ms": 500, "event": "VOICE_START"},
        {"at_ms": 1000, "event": "MUSIC_START"},
        {"at_ms": 1500, "event": "CONFETTI_START"},
        {"at_ms": 5500, "event": "FINAL_POSE"},
        {"at_ms": 7000, "event": "CELEBRATION_END"},
    ],
    "weight": 1, "enabled": True, "season": None,
    "milestone_requirement": None, "platform_support": ["ios", "android", "web"],
    "version": 1,
}

ACHIEVEMENT_RULES = [
    {"type": "first_project_complete", "label": "First Project Complete"},
    {"type": "five_projects_complete", "label": "Five Projects Complete"},
    {"type": "ten_projects_complete", "label": "Ten Projects Complete"},
    {"type": "first_paint_project", "label": "First Paint Project"},
    {"type": "first_plumbing_project", "label": "First Plumbing Project"},
]

DEFAULT_PREFS = {"celebrations_enabled": True, "music_enabled": True, "voice_enabled": True,
                 "effects_enabled": True, "reduced_motion": False, "achievements_visible": True}


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


async def seed():
    try:
        await _db.cel_packages.update_one({"id": DEFAULT_PACKAGE["id"]},
                                          {"$setOnInsert": dict(DEFAULT_PACKAGE)}, upsert=True)
    except Exception as e:
        if _logger:
            _logger.warning(f"celebration seed failed: {e}")


async def _prefs(user_id: str) -> dict:
    p = await _db.cel_prefs.find_one({"user_id": user_id}, {"_id": 0})
    if not p:
        return {**DEFAULT_PREFS, "user_id": user_id}
    return {**DEFAULT_PREFS, **p}


async def _evaluate_achievements(user_id: str, project: dict) -> list:
    """Award achievements not yet held. Optional and secondary to real success."""
    awarded = []
    completed_count = await _db.hi_project_completions.count_documents({"user_id": user_id})
    have = {a["achievement_type"] for a in await _db.hi_user_achievements.find(
        {"user_id": user_id}, {"_id": 0, "achievement_type": 1}).to_list(100)}
    title = (project.get("title") or "").lower()

    def maybe(atype, label, cond):
        if cond and atype not in have:
            awarded.append({"id": _nid(), "user_id": user_id, "achievement_type": atype, "label": label,
                            "project_id": project["id"], "awarded_at": _now(), "metadata": {}})

    maybe("first_project_complete", "First Project Complete", completed_count == 1)
    maybe("five_projects_complete", "Five Projects Complete", completed_count == 5)
    maybe("ten_projects_complete", "Ten Projects Complete", completed_count == 10)
    maybe("first_paint_project", "First Paint Project", "paint" in title)
    maybe("first_plumbing_project", "First Plumbing Project",
          any(k in title for k in ("faucet", "plumb", "toilet", "sink", "drain")))
    for a in awarded:
        await _db.hi_user_achievements.insert_one(dict(a))
        a.pop("_id", None)
        await _track(user_id, "achievement_awarded", {"type": a["achievement_type"]})
    return awarded


async def _select_package(user_id: str, prefs: dict) -> Optional[dict]:
    if not prefs.get("celebrations_enabled"):
        return None
    pkgs = await _db.cel_packages.find({"enabled": True}, {"_id": 0}).to_list(20)
    if not pkgs:
        return None
    pkg = dict(random.choices(pkgs, weights=[p.get("weight", 1) for p in pkgs])[0])
    # accessibility/preferences shape what the client should actually play
    pkg["play"] = {"voice": bool(prefs.get("voice_enabled")),
                   "music": bool(prefs.get("music_enabled")),
                   "effects": bool(prefs.get("effects_enabled")) and not prefs.get("reduced_motion"),
                   "animation": not prefs.get("reduced_motion")}
    if prefs.get("reduced_motion"):
        pkg["duration_seconds"] = 2
    return pkg


class PrefsReq(BaseModel):
    celebrations_enabled: Optional[bool] = None
    music_enabled: Optional[bool] = None
    voice_enabled: Optional[bool] = None
    effects_enabled: Optional[bool] = None
    reduced_motion: Optional[bool] = None
    achievements_visible: Optional[bool] = None


class CelEventReq(BaseModel):
    event: str  # skipped | completed


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/celebration", dependencies=[Depends(get_current_user)])

    @r.get("/prefs")
    async def get_prefs(user: dict = Depends(get_current_user)):
        return await _prefs(user["id"])

    @r.put("/prefs")
    async def put_prefs(req: PrefsReq, user: dict = Depends(get_current_user)):
        upd = {k: v for k, v in req.model_dump().items() if v is not None}
        if not upd:
            raise HTTPException(status_code=400, detail="Nothing to update.")
        await _db.cel_prefs.update_one({"user_id": user["id"]},
                                       {"$set": {**upd, "updated_at": _now()},
                                        "$setOnInsert": {"id": _nid(), "user_id": user["id"]}}, upsert=True)
        return await _prefs(user["id"])

    @r.get("/achievements")
    async def achievements(user: dict = Depends(get_current_user)):
        rows = await _db.hi_user_achievements.find({"user_id": user["id"]}, {"_id": 0}) \
            .sort("awarded_at", -1).to_list(100)
        return {"achievements": rows, "catalog": ACHIEVEMENT_RULES}

    @r.post("/projects/{pid}/completed")
    async def project_completed(pid: str, user: dict = Depends(get_current_user)):
        """Called when the authoritative project state becomes COMPLETE."""
        p = await _db.hi_projects.find_one({"id": pid, "user_id": user["id"]}, {"_id": 0})
        if not p:
            raise HTTPException(status_code=404, detail="Project not found.")
        if p.get("status") != "completed":
            raise HTTPException(status_code=409, detail="This project isn't marked complete yet.")
        existing = await _db.hi_project_completions.find_one({"project_id": pid}, {"_id": 0})
        prefs = await _prefs(user["id"])
        if existing:
            return {"completion": existing, "celebration": None, "achievements": [],
                    "already_recorded": True, "prefs": prefs}
        # permanent completion record
        mats_actual = 0.0
        for m in await _db.hi_project_materials.find({"project_id": pid}, {"_id": 0, "actual_price": 1}).to_list(300):
            mats_actual += m.get("actual_price") or 0
        est_high = p.get("estimated_cost_high") or 0
        actual = p.get("actual_cost") or round(mats_actual, 2) or None
        # honest savings: only when we have a pro-cost basis (2x estimate heuristic labeled as estimate)
        est_pro = round(est_high * 2.4) if est_high else None
        savings = round(est_pro - (actual or est_high)) if est_pro else None
        completion = {"id": _nid(), "project_id": pid, "user_id": user["id"],
                      "home_id": p.get("property_id"), "completed_at": _now(),
                      "completion_method": "user_confirmed", "verification_status": "user_confirmed",
                      "estimated_cost": est_high or None, "actual_cost": actual,
                      "estimated_pro_cost": est_pro, "estimated_savings": savings,
                      "savings_note": "Estimated, not guaranteed — based on typical professional pricing.",
                      "celebration_package_id": None, "achievement_ids": [],
                      "maintenance_follow_up_ids": [], "created_at": _now()}
        await _db.hi_project_completions.insert_one(dict(completion))
        await _track(user["id"], "completion_record_created", {"project_id": pid})
        # achievements
        awarded = await _evaluate_achievements(user["id"], p)
        # maintenance follow-up (idempotent, same shape as maintenance engine post_project tasks)
        follow_ids = []
        exists_fu = await _db.hi_maintenance_tasks.find_one(
            {"user_id": user["id"], "project_id": pid, "source": "post_project"}, {"_id": 0, "id": 1})
        if not exists_fu:
            due = (datetime.now(timezone.utc).date() + timedelta(days=7)).isoformat()
            tid = _nid()
            await _db.hi_maintenance_tasks.insert_one({
                "id": tid, "user_id": user["id"], "property_id": p.get("property_id"),
                "room_id": p.get("room_id"), "asset_id": None, "project_id": pid,
                "title": f"Check up on: {p.get('title') or 'completed project'}"[:120],
                "category": "Post-project follow-up",
                "description": p.get("maintenance_followup") or "Inspect the completed work after the first week of use.",
                "priority": "medium", "frequency_type": "one_time", "custom_interval_days": None,
                "due_date": due, "status": "active", "source": "post_project",
                "source_reason": f"Created automatically after completing “{p.get('title')}”.",
                "season": None, "created_at": _now(), "updated_at": _now()})
            await _db.hi_maintenance_occurrences.insert_one({
                "id": _nid(), "maintenance_task_id": tid, "user_id": user["id"],
                "scheduled_date": due, "completed_date": None, "status": "upcoming",
                "notes": None, "cost": None, "created_at": _now()})
            follow_ids.append(tid)
            await _track(user["id"], "maintenance_follow_up_created", {"project_id": pid})
        # celebration selection
        pkg = await _select_package(user["id"], prefs)
        cel_id = None
        if pkg:
            cel_id = _nid()
            await _db.cel_events.insert_one({"id": cel_id, "user_id": user["id"], "project_id": pid,
                                             "package_id": pkg["id"], "status": "triggered", "created_at": _now()})
            await _track(user["id"], "celebration_selected", {"package_id": pkg["id"]})
            await _track(user["id"], "celebration_triggered", {"package_id": pkg["id"]})
        await _db.hi_project_completions.update_one({"id": completion["id"]}, {"$set": {
            "celebration_package_id": pkg["id"] if pkg else None,
            "achievement_ids": [a["id"] for a in awarded],
            "maintenance_follow_up_ids": follow_ids}})
        await _track(user["id"], "project_completed", {"project_id": pid})
        return {"completion": completion,
                "celebration": ({**pkg, "celebration_event_id": cel_id} if pkg else None),
                "achievements": awarded if prefs.get("achievements_visible") else [],
                "already_recorded": False, "prefs": prefs}

    @r.post("/events/{cid}/{action}")
    async def celebration_event(cid: str, action: str, user: dict = Depends(get_current_user)):
        if action not in ("skipped", "completed"):
            raise HTTPException(status_code=400, detail="Unknown action.")
        res = await _db.cel_events.update_one({"id": cid, "user_id": user["id"]},
                                              {"$set": {"status": action, "ended_at": _now()}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Celebration not found.")
        await _track(user["id"], f"celebration_{action}", {})
        return {"ok": True}

    @r.get("/projects/{pid}/completion")
    async def get_completion(pid: str, user: dict = Depends(get_current_user)):
        c = await _db.hi_project_completions.find_one({"project_id": pid, "user_id": user["id"]}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="No completion record yet.")
        return {"completion": c}

    return r


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/celebration", dependencies=[Depends(require_admin)])

    @r.get("/packages")
    async def packages(admin: dict = Depends(require_admin)):
        rows = await _db.cel_packages.find({}, {"_id": 0}).to_list(50)
        return {"packages": rows}

    @r.put("/packages/{pkg_id}/enabled")
    async def toggle(pkg_id: str, enabled: bool = True, admin: dict = Depends(require_admin)):
        res = await _db.cel_packages.update_one({"id": pkg_id}, {"$set": {"enabled": enabled}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Package not found.")
        return {"ok": True, "enabled": enabled}

    return r
