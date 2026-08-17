"""
DIYhomie — Proactive Home Maintenance & Priority Intelligence Engine (Build Document 6).

Turns property context, completed-project outcomes, monitoring follow-ups, asset age/history,
and deterministic seasonal rules into a SMALL set of prioritized, explainable maintenance actions.
Preventive guidance is personalized, explainable and restrained — never a generic checklist.

Principles:
  - Prioritize what matters now (max 3 primary actions).
  - Every recommendation carries a reason_trace + priority_category.
  - Deferrals/dismissals are feedback, not something to nag about.
  - A reported abnormality becomes evidence -> a new repair issue, not a dead-end.

Built on the existing MongoDB stack. Reads: hi_properties, hi_assets, gr_outcomes,
gr_followups. Writes: gr_care_feedback, gr_care_tasks, gr_care_prefs. Converts abnormal
findings into gr_issues (Guided Repair, Doc 2). Namespace: /api/hi/care/*.
"""
import uuid
from datetime import datetime, timezone
from typing import Callable, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

PRIORITY_CATEGORIES = ["urgent_review", "important_preventive", "routine_maintenance",
                       "optional_improvement", "seasonal_preparation", "monitoring_follow_up"]

# Northern-hemisphere deterministic seasons (MVP: location season only, no forecasting).
_SEASON_BY_MONTH = {12: "winter", 1: "winter", 2: "winter", 3: "spring", 4: "spring", 5: "spring",
                    6: "summer", 7: "summer", 8: "summer", 9: "fall", 10: "fall", 11: "fall"}
_SEASONAL_TASKS = {
    "winter": [("Protect outdoor faucets & exposed pipes from freezing", "Freeze damage can burst pipes and cause major water damage.", "important_preventive"),
               ("Check heating system & replace HVAC filter", "Clean filters keep heating efficient and safe through peak use.", "routine_maintenance")],
    "spring": [("Inspect roof, gutters & downspouts after winter", "Winter can loosen or clog drainage; spring rain tests it.", "important_preventive"),
               ("Test exterior drainage & grading around the foundation", "Redirecting spring water early prevents basement moisture.", "seasonal_preparation")],
    "summer": [("Service AC / cooling system & clear condenser airflow", "Cooling works hardest now — airflow keeps it reliable.", "routine_maintenance"),
               ("Inspect exterior caulking, paint & seals", "Summer is ideal for exterior upkeep before fall weather.", "optional_improvement")],
    "fall": [("Clean gutters & downspouts before fall rains", "Clogged drainage in fall is a top cause of foundation moisture.", "important_preventive"),
             ("Weatherize doors & windows before cold weather", "Fresh weatherstripping cuts drafts and heating costs.", "seasonal_preparation")],
}
# Always-on safety task (deterministic monthly cadence).
_SAFETY_TASKS = [("Test smoke & carbon-monoxide alarms", "Working alarms are the single most important home safety item.", "important_preventive")]

# Asset maintenance profiles (keyword-matched against asset name/category).
_ASSET_PROFILES = {
    "hvac": {"keywords": ["hvac", "furnace", "ac", "air condition", "heat pump", "thermostat"],
             "tasks": [("Replace HVAC air filter", "A clogged filter strains the system and worsens air quality.", "routine_maintenance", 90)],
             "safety": "Turn off power at the thermostat/breaker before opening any panel."},
    "water_heater": {"keywords": ["water heater", "boiler", "hot water"],
                     "tasks": [("Flush the water heater & check the T&P valve", "Sediment reduces efficiency and lifespan; the T&P valve is a safety device.", "important_preventive", 365)],
                     "safety": "Water heaters involve hot water, gas or electrical — stop if unsure and call a pro."},
    "gutters": {"keywords": ["gutter", "downspout", "drain"],
                "tasks": [("Clear gutters & downspouts", "Blockages send water toward the foundation.", "important_preventive", 180)],
                "safety": "Working at height is a fall risk — use a stable ladder or hire a pro."},
    "appliance": {"keywords": ["dishwasher", "washer", "dryer", "fridge", "refrigerator", "oven", "range"],
                  "tasks": [("Clean the appliance filter / trap", "Clean filters prevent clogs, odors and breakdowns.", "routine_maintenance", 120)],
                  "safety": "Unplug the appliance before cleaning internal parts."},
    "alarms": {"keywords": ["smoke", "carbon", "co detector", "alarm"],
               "tasks": [("Test & date-check the alarm", "Alarms expire; test monthly and replace per the printed date.", "important_preventive", 30)],
               "safety": None},
    "doors_windows": {"keywords": ["door", "window"],
                      "tasks": [("Check weatherstripping & seals", "Good seals cut energy loss and moisture intrusion.", "optional_improvement", 365)],
                      "safety": None},
}


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


async def _property(user_id):
    return (await _db.hi_properties.find_one({"user_id": user_id, "is_active": True}, {"_id": 0})
            or await _db.hi_properties.find_one({"user_id": user_id}, {"_id": 0}))


def _score(safety, time_sensitivity, asset_criticality, cost_of_delay, unresolved, seasonal):
    """Transparent additive priority model (0-100)."""
    return min(100, safety * 30 + time_sensitivity * 20 + asset_criticality * 15
               + cost_of_delay * 15 + unresolved * 15 + seasonal * 5)


def _match_profile(asset: dict):
    text = f"{asset.get('name', '')} {asset.get('category', '')}".lower()
    for key, prof in _ASSET_PROFILES.items():
        if any(k in text for k in prof["keywords"]):
            return key, prof
    return None, None


async def _build_recommendations(user_id: str) -> List[dict]:
    """Deterministic, explainable recommendation set. Returns ranked list."""
    recs: List[dict] = []
    now = datetime.now(timezone.utc)
    season = _SEASON_BY_MONTH[now.month]

    # Suppress recs the user deferred/dismissed recently.
    feedback = {f["rec_key"]: f for f in await _db.gr_care_feedback.find({"user_id": user_id}, {"_id": 0}).to_list(500)}
    started = {t["rec_key"]: t for t in await _db.gr_care_tasks.find({"user_id": user_id}, {"_id": 0, "rec_key": 1, "status": 1}).to_list(500)}

    def _add(rec_key, title, why, category, score, effort, difficulty, safety, consequence, reason_trace, subject=None):
        fb = feedback.get(rec_key)
        if fb and fb.get("status") == "dismissed":
            return
        st = started.get(rec_key)
        recs.append({
            "rec_key": rec_key, "title": title, "why_now": why, "priority_category": category,
            "priority_score": score, "estimated_effort": effort, "difficulty": difficulty,
            "safety_boundary": safety, "consequence_of_delay": consequence, "reason_trace": reason_trace,
            "subject": subject, "state": (fb.get("status") if fb else None) or (st.get("status") if st else "new"),
            "scheduled_date": fb.get("scheduled_date") if fb else None,
        })

    # 1) Monitoring follow-ups from completed projects (highest relevance — a real reason exists).
    for f in await _db.gr_followups.find({"user_id": user_id, "status": "open"}, {"_id": 0}).sort("created_at", -1).to_list(50):
        rk = f"followup:{f['id']}"
        _add(rk, f.get("what") or "Monitoring follow-up",
             f.get("why") or "A recent project asked you to confirm the result.",
             "monitoring_follow_up", _score(0, 1, 0, 1, 1, 0),
             "5-15 min", "beginner", None,
             "Small issues can return if not confirmed.",
             ["Created as a follow-up from a completed repair project.",
              (f"Success looks like: {f['success_criteria']}" if f.get("success_criteria") else "Confirm the area still looks good.")],
             {"type": "followup", "id": f["id"], "issue_id": f.get("issue_id")})

    # 2) Unresolved / improved outcomes -> urgent review.
    for o in await _db.gr_outcomes.find({"user_id": user_id, "outcome_status": {"$in": ["unresolved", "improved"]}}, {"_id": 0}).sort("created_at", -1).to_list(30):
        rk = f"unresolved:{o['issue_id']}"
        urgent = o.get("outcome_status") == "unresolved"
        _add(rk, f"Re-check: {(o.get('objective') or 'a past project')[:60]}",
             "This project wasn't fully resolved — worth verifying before it worsens." if urgent else "Marked improved & monitoring — confirm it's holding.",
             "urgent_review" if urgent else "monitoring_follow_up",
             _score(1 if urgent else 0, 1, 0, 1, 1, 0),
             "10-20 min", "beginner", None,
             "Unresolved conditions can escalate into larger repairs.",
             [f"Prior outcome was '{o.get('outcome_status')}'.", "Verifying now protects the earlier work."],
             {"type": "outcome", "issue_id": o["issue_id"]})

    # 3) Asset-based maintenance from profiles.
    assets = await _db.hi_assets.find({"user_id": user_id}, {"_id": 0}).to_list(200)
    for a in assets:
        key, prof = _match_profile(a)
        if not prof:
            continue
        for (title, why, category, interval_days) in prof["tasks"]:
            rk = f"asset:{a['id']}:{title[:20]}"
            crit = 1 if category == "important_preventive" else 0
            _add(rk, f"{title} — {a.get('name', 'your ' + key)}", why, category,
                 _score(0, 0, crit, 1 if crit else 0, 0, 0),
                 "15-45 min", "beginner", prof.get("safety"),
                 "Deferred upkeep shortens equipment life.",
                 [f"Based on your '{a.get('name')}' asset record.",
                  f"Recommended roughly every {interval_days} days."],
                 {"type": "asset", "asset_id": a["id"], "room_id": a.get("room_id")})

    # 4) Always-on safety task.
    for (title, why, category) in _SAFETY_TASKS:
        _add(f"safety:{title[:20]}", title, why, category, _score(1, 1, 0, 0, 0, 0),
             "5-10 min", "beginner", None, "A non-working alarm is a serious safety gap.",
             ["Recommended monthly for every home, regardless of history."],
             {"type": "safety"})

    # 5) Seasonal tasks (home-level).
    for (title, why, category) in _SEASONAL_TASKS.get(season, []):
        _add(f"seasonal:{season}:{title[:20]}", title, why, category,
             _score(0, 1 if category == "important_preventive" else 0, 0, 1 if category == "important_preventive" else 0, 0, 1),
             "20-60 min", "beginner", None, "Seasonal timing matters for effectiveness.",
             [f"It's {season} — this is the right window for this task.",
              "General seasonal guidance (location-based; not a weather forecast)."],
             {"type": "seasonal", "season": season})

    recs.sort(key=lambda x: x["priority_score"], reverse=True)
    return recs


def _steps_for(rec: dict) -> List[dict]:
    """Small guided inspection steps (reuses Doc 3 task shape) for a maintenance action."""
    base = [
        {"id": _nid(), "title": "Look before you touch", "what_to_do": f"Visually inspect the area for: {rec['title']}.",
         "why_it_matters": rec["why_now"], "safety_caution": rec.get("safety_boundary"),
         "completion_criteria": "You've observed the current condition.", "status": "available",
         "checkpoint": {"mode": "advisory", "needs": ["observation"], "description": "Note what you see."}},
        {"id": _nid(), "title": "Perform the maintenance", "what_to_do": "Carry out the task using safe, basic steps. Stop if anything looks abnormal.",
         "why_it_matters": "Doing it correctly prevents the problem it's meant to avoid.", "safety_caution": rec.get("safety_boundary"),
         "completion_criteria": "The task is done or you've found something to flag.", "status": "pending",
         "checkpoint": {"mode": "required", "needs": ["confirmation"], "description": "Confirm normal, or report an abnormal finding."}},
    ]
    return base


# ----------------------------------------------------------------- models
class RecActionReq(BaseModel):
    action: str  # start | schedule | defer | dismiss | professional | explain
    schedule_date: Optional[str] = None


class CareCompleteReq(BaseModel):
    normal: bool = True
    note: Optional[str] = None
    base64: Optional[str] = None


class PrefsReq(BaseModel):
    notify_mode: str = "reminder"  # digest | reminder | quiet


# ----------------------------------------------------------------- user router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/care")

    @r.get("/dashboard")
    async def dashboard(user: dict = Depends(get_current_user)):
        uid = user["id"]
        await _cap(uid, "maintenance_dashboard.viewed", {})
        recs = await _build_recommendations(uid)
        active = [x for x in recs if x["state"] not in ("deferred", "dismissed", "completed")]
        top = active[:3]
        monitoring = [x for x in recs if x["priority_category"] == "monitoring_follow_up"][:5]
        seasonal = [x for x in recs if x["priority_category"] == "seasonal_preparation"][:5]
        deferred = [x for x in recs if x["state"] == "deferred"][:10]
        recent = await _db.gr_care_tasks.find({"user_id": uid, "status": "completed"}, {"_id": 0}).sort("completed_at", -1).to_list(5)
        prefs = await _db.gr_care_prefs.find_one({"user_id": uid}, {"_id": 0})
        return {"top_actions": top, "due_now": active[:6], "upcoming_seasonal": seasonal,
                "monitoring": monitoring, "deferred": deferred,
                "recently_completed": recent, "total_active": len(active),
                "notify_mode": (prefs or {}).get("notify_mode", "reminder"),
                "empty": len(recs) == 0}

    @r.get("/recommendations")
    async def recommendations(user: dict = Depends(get_current_user)):
        recs = await _build_recommendations(user["id"])
        for x in recs:
            await _cap(user["id"], "maintenance_recommendation.shown", {"category": x["priority_category"]})
        return {"recommendations": recs}

    @r.post("/recommendations/action")
    async def rec_action(req: RecActionReq, rec_key: str, user: dict = Depends(get_current_user)):
        uid = user["id"]
        recs = await _build_recommendations(uid)
        rec = next((x for x in recs if x["rec_key"] == rec_key), None)
        if not rec:
            raise HTTPException(status_code=404, detail="Recommendation not found.")
        if req.action == "explain":
            await _cap(uid, "maintenance_recommendation.explained", {})
            return {"title": rec["title"], "why_now": rec["why_now"], "reason_trace": rec["reason_trace"],
                    "consequence_of_delay": rec["consequence_of_delay"], "safety_boundary": rec["safety_boundary"]}
        if req.action in ("defer", "dismiss", "schedule", "professional"):
            status = {"defer": "deferred", "dismiss": "dismissed", "schedule": "scheduled", "professional": "professionally_completed"}[req.action]
            await _db.gr_care_feedback.update_one({"user_id": uid, "rec_key": rec_key},
                                                  {"$set": {"user_id": uid, "rec_key": rec_key, "status": status,
                                                            "scheduled_date": req.schedule_date, "updated_at": _now()}}, upsert=True)
            await _cap(uid, f"maintenance_task.{'deferred' if req.action == 'defer' else req.action if req.action != 'dismiss' else 'dismissed'}", {})
            return {"ok": True, "state": status}
        if req.action == "start":
            existing = await _db.gr_care_tasks.find_one({"user_id": uid, "rec_key": rec_key, "status": {"$ne": "completed"}}, {"_id": 0})
            if existing:
                return {"task": existing}
            task = {"id": _nid(), "user_id": uid, "rec_key": rec_key, "title": rec["title"],
                    "priority_category": rec["priority_category"], "why_now": rec["why_now"],
                    "safety_boundary": rec["safety_boundary"], "subject": rec["subject"],
                    "steps": _steps_for(rec), "status": "in_progress", "created_at": _now()}
            await _db.gr_care_tasks.insert_one(dict(task)); task.pop("_id", None)
            await _cap(uid, "maintenance_task.started", {"category": rec["priority_category"]})
            return {"task": task}
        raise HTTPException(status_code=400, detail="Invalid action.")

    @r.get("/tasks/{tid}")
    async def get_task(tid: str, user: dict = Depends(get_current_user)):
        t = await _db.gr_care_tasks.find_one({"id": tid, "user_id": user["id"]}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Task not found.")
        return {"task": t}

    @r.post("/tasks/{tid}/complete")
    async def complete_task(tid: str, req: CareCompleteReq, user: dict = Depends(get_current_user)):
        uid = user["id"]
        t = await _db.gr_care_tasks.find_one({"id": tid, "user_id": uid}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Task not found.")
        if req.normal:
            await _db.gr_care_tasks.update_one({"id": tid}, {"$set": {"status": "completed", "outcome": "normal",
                                                                      "note": (req.note or "")[:500] or None, "completed_at": _now()}})
            await _cap(uid, "maintenance_task.completed", {"outcome": "normal"})
            try:
                await _db.gr_timeline.insert_one({"id": _nid(), "user_id": uid, "type": "maintenance_completed",
                                                  "provenance": "user_reported", "title": t["title"], "created_at": _now()})
            except Exception:
                pass
            return {"ok": True, "outcome": "normal"}
        # Abnormal finding -> convert to a Guided Repair issue with context preloaded.
        subject = t.get("subject") or {}
        try:
            import guided_repair_engine
            triage = guided_repair_engine._triage(t["title"], None)
        except Exception:
            triage = {"risk_level": "normal", "hard_stop": False, "soft_escalation": False, "matched": [], "code": None, "message": None, "block_plan": False}
        prop = await _property(uid)
        new_id = _nid()
        issue = {"id": new_id, "user_id": uid, "property_id": prop["id"] if prop else None,
                 "room_id": subject.get("room_id"), "asset_id": subject.get("asset_id"),
                 "description": f"Found during maintenance: {t['title']}. {req.note or ''}".strip()[:4000],
                 "category": "other_unsure", "urgency": "soon", "status": "submitted", "phase": "ISSUE_REPORTED",
                 "triage": triage, "risk_flags": triage.get("matched", []), "assessment_version": 0, "plan_version": 0,
                 "position_id": None, "from_maintenance_task": tid, "created_at": _now(), "updated_at": _now()}
        await _db.gr_issues.insert_one(dict(issue))
        if req.base64:
            await _db.gr_evidence.insert_one({"id": _nid(), "issue_id": new_id, "user_id": uid, "type": "photo",
                                              "note": f"Abnormal finding during '{t['title']}'", "value": None, "unit": None,
                                              "base64": req.base64, "_had_media": True, "created_at": _now()})
        await _db.gr_care_tasks.update_one({"id": tid}, {"$set": {"status": "completed", "outcome": "abnormal",
                                                                  "converted_issue_id": new_id, "completed_at": _now()}})
        await _cap(uid, "maintenance_task.abnormal_finding_reported", {})
        await _cap(uid, "maintenance_task.converted_to_issue", {})
        return {"ok": True, "outcome": "abnormal", "converted_issue_id": new_id}

    @r.get("/assets/profiles")
    async def asset_profiles(user: dict = Depends(get_current_user)):
        assets = await _db.hi_assets.find({"user_id": user["id"]}, {"_id": 0}).to_list(200)
        matched = []
        for a in assets:
            key, prof = _match_profile(a)
            matched.append({"asset_id": a["id"], "name": a.get("name"), "profile": key,
                            "intervals": [{"task": t[0], "days": t[3]} for t in prof["tasks"]] if prof else [],
                            "safety": prof.get("safety") if prof else None, "known": bool(prof)})
        return {"profiles_library": list(_ASSET_PROFILES.keys()), "assets": matched}

    @r.get("/calendar")
    async def calendar(user: dict = Depends(get_current_user)):
        uid = user["id"]
        scheduled = await _db.gr_care_feedback.find({"user_id": uid, "status": "scheduled"}, {"_id": 0}).to_list(100)
        followups = await _db.gr_followups.find({"user_id": uid, "status": "open"}, {"_id": 0}).sort("due_at", 1).to_list(100)
        return {"scheduled": scheduled, "follow_ups": followups}

    @r.post("/preferences")
    async def set_prefs(req: PrefsReq, user: dict = Depends(get_current_user)):
        mode = req.notify_mode if req.notify_mode in ("digest", "reminder", "quiet") else "reminder"
        await _db.gr_care_prefs.update_one({"user_id": user["id"]}, {"$set": {"user_id": user["id"], "notify_mode": mode, "updated_at": _now()}}, upsert=True)
        return {"ok": True, "notify_mode": mode}

    return r


# ----------------------------------------------------------------- admin router
def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/care", dependencies=[Depends(require_admin)])

    @r.get("/signals")
    async def signals(admin: dict = Depends(require_admin)):
        by_status = {}
        for s in ("deferred", "dismissed", "scheduled", "professionally_completed"):
            by_status[s] = await _db.gr_care_feedback.count_documents({"status": s})
        started = await _db.gr_care_tasks.count_documents({})
        completed = await _db.gr_care_tasks.count_documents({"status": "completed"})
        abnormal = await _db.gr_care_tasks.count_documents({"outcome": "abnormal"})
        # Repeatedly deferred = candidate low-value recommendations.
        low_value = await _db.gr_care_feedback.count_documents({"status": "dismissed"})
        return {"feedback_by_status": by_status, "tasks_started": started, "tasks_completed": completed,
                "abnormal_conversions": abnormal, "dismissed_low_value": low_value}

    return r


async def seed_care():
    if _db is None:
        return
    try:
        await _db.gr_care_feedback.create_index([("user_id", 1), ("rec_key", 1)])
        await _db.gr_care_tasks.create_index("user_id")
        await _db.gr_care_prefs.create_index("user_id")
        if _logger:
            _logger.info("home care / priority intelligence engine (Build Doc 6) seeded")
    except Exception as e:
        if _logger:
            _logger.error(f"home care seed failed: {e}")
