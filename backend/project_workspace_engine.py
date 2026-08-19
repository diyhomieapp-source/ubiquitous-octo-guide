"""
DIYhomie — Active Project Workspace, Project State & Adaptive Daily Guidance (Build Document 49).

DIYhomie manages the project state so the user never has to. This engine layers on top of
project_planner_engine (plans/steps/materials) and project_intelligence_engine (NBA/blockers):

- Daily Project Briefing ("Welcome back...") with quick/standard/detailed styles
- Time-aware "What's Next?" (25 min -> real task; 5 min -> prep micro-task)
- Doc 49 project & task state machines derived from live conditions (can move backward)
- Materials readiness check before work (I Have It / I Need It / Use Alternative / Ask Homie / Buy It)
- "Something Changed" problem reporting (9 types, photo evidence, safety-aware routing)
- Unified project evidence timeline (photos, notes, steps, materials, changes, blockers)
- Offline bundle for caching + queued sync (works with sync_engine step_complete_event)

Collections: ws_problems, ws_prefs. Reads: hi_projects, hi_project_phases, hi_project_steps,
hi_project_materials, hi_project_media, hi_project_notes, pi_blockers, pi_change_events.
"""
import uuid
from datetime import datetime, timezone, timedelta
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

PROJECT_STATES = ["DRAFT", "ASSESSMENT", "PLANNING", "MATERIALS_READY", "READY_TO_START",
                  "IN_PROGRESS", "PAUSED", "BLOCKED", "PRO_REVIEW", "VERIFICATION", "COMPLETE", "ARCHIVED"]
TASK_STATES = ["NOT_STARTED", "READY", "ACTIVE", "USER_COMPLETED", "VERIFYING", "VERIFIED",
               "SKIPPED", "BLOCKED", "NEEDS_REWORK", "PRO_REQUIRED", "CANCELLED"]
BRIEFING_STYLES = ["quick", "standard", "detailed"]

PROBLEM_TYPES = {
    "found_obstruction": {"label": "I found an obstruction", "route": "adjust_plan", "blocker": True,
                          "message": "Let's map what's in the way before touching it — it could be plumbing, wiring, or framing.",
                          "actions": ["scan_area", "ask_homie", "bring_in_pro"], "safety_check": True},
    "missing_part": {"label": "I don't have the right part", "route": "materials", "blocker": True,
                     "message": "No problem — let's find the right part or a compatible alternative so you don't lose momentum.",
                     "actions": ["view_shopping_list", "use_alternative", "ask_homie"], "safety_check": False},
    "measurement_different": {"label": "The measurement is different", "route": "adjust_plan", "blocker": True,
                              "message": "Let's re-measure and update the plan — a small difference now prevents a bad cut later.",
                              "actions": ["remeasure", "update_plan", "ask_homie"], "safety_check": False},
    "material_does_not_fit": {"label": "The material doesn't fit", "route": "adjust_plan", "blocker": True,
                              "message": "Don't force it. Let's check the spec against what you have and adjust the plan or the part.",
                              "actions": ["remeasure", "use_alternative", "ask_homie"], "safety_check": False},
    "made_a_mistake": {"label": "I made a mistake", "route": "guidance", "blocker": False,
                       "message": "Mistakes are part of every real project. Let's look at it together — most are fixable in minutes.",
                       "actions": ["show_again", "ask_homie", "bring_in_pro"], "safety_check": False},
    "something_damaged": {"label": "Something is damaged", "route": "pro_review", "blocker": True,
                          "message": "Stop work in that area. Let's document the damage and assess whether it's DIY-fixable.",
                          "actions": ["add_photo", "ask_homie", "bring_in_pro"], "safety_check": True},
    "unsure_what_to_do": {"label": "I'm unsure what to do", "route": "guidance", "blocker": False,
                          "message": "Let's slow down and walk the next action together, one small step at a time.",
                          "actions": ["show_again", "ask_homie", "view_step"], "safety_check": False},
    "may_be_unsafe": {"label": "I think this may be unsafe", "route": "pro_review", "blocker": True,
                      "message": "Good instinct — when in doubt, stop. Let's evaluate before anyone continues.",
                      "actions": ["stop_work", "bring_in_pro", "ask_homie"], "safety_check": True},
    "other": {"label": "Something else changed", "route": "guidance", "blocker": True,
              "message": "Tell me what changed and I'll adjust the plan around it.",
              "actions": ["ask_homie", "add_photo"], "safety_check": False},
}

MATERIAL_OPTIONS = ["have_it", "need_it", "use_alternative", "ask_homie", "buy_it"]

# Doc 51 §12 — explicit override reasons; bypassing order is always recorded, never silent.
OVERRIDE_REASONS = ["not_applicable", "already_completed_outside", "professional_completed",
                    "different_method", "skip_this_step", "other"]
OVERRIDE_LABELS = {
    "not_applicable": "Not applicable", "already_completed_outside": "Already completed outside DIYhomie",
    "professional_completed": "A professional completed it", "different_method": "Using a different method",
    "skip_this_step": "I want to skip this step", "other": "Other",
}


def _safety_color(p: dict, step: Optional[dict]) -> dict:
    """Doc 51 §16 — GREEN/YELLOW/ORANGE/RED safety classification."""
    if p.get("safety_status") == "Stop and contact a professional":
        return {"color": "RED", "label": "Stop — professional assistance recommended",
                "note": p.get("safety_status")}
    risk = (p.get("risk_level") or "").lower()
    if "high" in risk or "professional" in risk:
        return {"color": "ORANGE", "label": "Higher-risk — confirm each safety check before proceeding",
                "note": p.get("risk_level")}
    if step and step.get("safety_note"):
        return {"color": "YELLOW", "label": "Proceed with preparation and safety reminders",
                "note": step["safety_note"]}
    return {"color": "GREEN", "label": "Routine DIY task", "note": None}


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


# ---------------------------------------------------------------- state derivation (Doc 49 §3-4)
def derive_task_state(step: dict) -> str:
    s = step.get("status")
    if s == "completed":
        return "VERIFIED" if step.get("verified") else "USER_COMPLETED"
    if s == "skipped":
        return "SKIPPED"
    if s == "active":
        return "ACTIVE"
    return "NOT_STARTED"


async def derive_project_state(p: dict) -> dict:
    """Doc 49 project state machine — derived from live conditions; can move backward."""
    pid = p["id"]
    status = p.get("status")
    if status == "completed":
        return {"state": "COMPLETE", "label": "Complete"}
    if status in ("unresolved", "escalated"):
        return {"state": "PRO_REVIEW", "label": "Professional review"}
    if status == "archived":
        return {"state": "ARCHIVED", "label": "Archived"}
    if status == "paused":
        return {"state": "PAUSED", "label": "Paused"}
    blocker = await _db.pi_blockers.find_one({"project_id": pid, "status": "active"}, {"_id": 0, "id": 1, "description": 1})
    if blocker:
        return {"state": "BLOCKED", "label": "Blocked", "blocker": blocker.get("description")}
    if p.get("safety_status") == "Stop and contact a professional":
        return {"state": "PRO_REVIEW", "label": "Professional review required"}
    total = await _db.hi_project_steps.count_documents({"project_id": pid})
    if total == 0:
        return {"state": "DRAFT" if status == "draft" else "ASSESSMENT", "label": "Getting started"}
    done = await _db.hi_project_steps.count_documents({"project_id": pid, "status": {"$in": ["completed", "skipped"]}})
    started = done > 0 or bool(await _db.hi_project_steps.find_one({"project_id": pid, "status": "active"}, {"_id": 0, "id": 1}))
    if done >= total:
        return {"state": "VERIFICATION", "label": "Verify & wrap up"}
    if started:
        return {"state": "IN_PROGRESS", "label": "In progress"}
    mats = await _db.hi_project_materials.find({"project_id": pid}, {"_id": 0, "user_status": 1}).to_list(200)
    missing = [m for m in mats if m.get("user_status") in ("need_it", "unsure")]
    if mats and not missing:
        return {"state": "READY_TO_START", "label": "Ready to start"}
    if mats:
        return {"state": "MATERIALS_READY", "label": "Gathering materials", "materials_missing": len(missing)}
    return {"state": "PLANNING", "label": "Planning"}


async def _project(pid: str, user_id: str) -> dict:
    p = await _db.hi_projects.find_one({"id": pid, "user_id": user_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found.")
    return p


async def _steps(pid: str) -> list:
    return await _db.hi_project_steps.find({"project_id": pid}, {"_id": 0}).sort("sequence_number", 1).to_list(300)


async def _briefing_payload(p: dict, user: dict, style: str) -> dict:
    pid = p["id"]
    steps = await _steps(pid)
    total, done_steps = len(steps), [s for s in steps if s["status"] in ("completed", "skipped")]
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
    recent = [s for s in steps if s.get("completed_at") and s["completed_at"] >= cutoff and s["status"] == "completed"]
    state = await derive_project_state(p)
    # next best action via project intelligence engine (Doc 44)
    nba = None
    try:
        from project_intelligence_engine import _compute_nba
        nba = await _compute_nba(p, user["id"])
    except Exception:
        pass
    mats = await _db.hi_project_materials.find({"project_id": pid}, {"_id": 0, "name": 1, "user_status": 1}).to_list(200)
    missing = [m["name"] for m in mats if m.get("user_status") in ("need_it", "unsure")]
    blockers = await _db.pi_blockers.find({"project_id": pid, "status": "active"}, {"_id": 0, "description": 1}).to_list(10)
    cur = next((s for s in steps if s["status"] == "active"), None) or next((s for s in steps if s["status"] == "not_started"), None)
    # spoken briefing
    lines = ["Welcome back."]
    if recent:
        lines.append(f"Last session you completed: {recent[-1]['instruction'][:90]}.")
    elif done_steps:
        lines.append(f"You've completed {len(done_steps)} of {total} steps so far.")
    if state["state"] == "BLOCKED":
        lines.append(f"We're currently blocked: {state.get('blocker')}. Let's clear that first.")
    elif nba:
        lines.append(f"Next up: {nba['title'][:110]}.")
    if missing and style != "quick":
        lines.append(f"Heads up — {len(missing)} material(s) still needed: {', '.join(missing[:3])}.")
    spoken = " ".join(lines)
    out = {
        "style": style,
        "spoken": spoken,
        "state": state,
        "progress": {"done": len(done_steps), "total": total,
                     "pct": round(len(done_steps) / total * 100) if total else 0},
        "recent_completed": [s["instruction"][:120] for s in recent[-3:]],
        "next_task": {"title": nba["title"], "why": nba["why"], "actions": nba.get("actions", []),
                      "phase": nba.get("phase")} if nba else None,
        "estimated_time": (cur or {}).get("estimated_time") or p.get("estimated_duration"),
        "safety_reminder": (cur or {}).get("safety_note") or (p.get("safety_status") if p.get("safety_status") != "Safe to continue" else None),
    }
    if style == "detailed":
        out["tools_needed"] = (cur or {}).get("tools_needed") or p.get("tools_needed") or []
        out["materials_missing"] = missing
        out["known_issues"] = [b["description"] for b in blockers]
    elif style == "standard":
        out["materials_missing"] = missing[:5]
        out["known_issues"] = [b["description"] for b in blockers][:3]
    return out


# ================================================================ models
class ProblemReq(BaseModel):
    problem_type: str
    note: Optional[str] = None
    photo_base64: Optional[str] = None


class PrefsReq(BaseModel):
    briefing_style: Optional[str] = None
    briefing_voice: Optional[bool] = None


class OverrideReq(BaseModel):
    reason: str
    note: Optional[str] = None


# ================================================================ router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/workspace", dependencies=[Depends(get_current_user)])

    @r.get("/meta")
    async def meta(user: dict = Depends(get_current_user)):
        return {"project_states": PROJECT_STATES, "task_states": TASK_STATES,
                "briefing_styles": BRIEFING_STYLES, "material_options": MATERIAL_OPTIONS,
                "problem_types": [{"code": k, "label": v["label"]} for k, v in PROBLEM_TYPES.items()]}

    @r.get("/prefs")
    async def get_prefs(user: dict = Depends(get_current_user)):
        p = await _db.ws_prefs.find_one({"user_id": user["id"]}, {"_id": 0})
        return {"prefs": p or {"user_id": user["id"], "briefing_style": "standard", "briefing_voice": True}}

    @r.put("/prefs")
    async def put_prefs(req: PrefsReq, user: dict = Depends(get_current_user)):
        updates = {"updated_at": _now()}
        if req.briefing_style in BRIEFING_STYLES:
            updates["briefing_style"] = req.briefing_style
        if req.briefing_voice is not None:
            updates["briefing_voice"] = bool(req.briefing_voice)
        await _db.ws_prefs.update_one({"user_id": user["id"]}, {"$set": updates,
                                      "$setOnInsert": {"user_id": user["id"], "created_at": _now()}}, upsert=True)
        p = await _db.ws_prefs.find_one({"user_id": user["id"]}, {"_id": 0})
        return {"prefs": p}

    @r.get("/projects/{pid}/now")
    async def now_card(pid: str, user: dict = Depends(get_current_user)):
        """Doc 51 §6-8 — the structured 'Do This Next' card. Deterministic rules first, AI explains."""
        p = await _project(pid, user["id"])
        steps = await _steps(pid)
        from project_intelligence_engine import _compute_nba
        nba = await _compute_nba(p, user["id"])
        step = next((s for s in steps if s["id"] == nba.get("step_id")), None) if nba.get("step_id") else None
        if not step:
            step = next((s for s in steps if s["status"] in ("active", "waiting")), None) or \
                   next((s for s in steps if s["status"] == "not_started"), None)
        completed = [s for s in steps if s["status"] in ("completed", "skipped")]
        waiting = [s for s in steps if s["status"] == "waiting"]
        blockers_n = await _db.pi_blockers.count_documents({"project_id": pid, "status": "active"})
        idx = steps.index(step) if step in steps else -1
        upcoming = [s for s in steps[idx + 1:] if s["status"] == "not_started"][:2] if idx >= 0 else []
        safety = _safety_color(p, step)
        room = await _db.hi_rooms.find_one({"id": p.get("room_id")}, {"_id": 0, "id": 1, "name": 1}) if p.get("room_id") else None
        visual_available = bool(await _db.guide_procedures.find_one({"category": {"$exists": True}}, {"_id": 0, "id": 1}))
        return {
            "projectId": pid,
            "taskId": (step or {}).get("id"),
            "status": "safety_stop" if safety["color"] == "RED" else ("blocked" if nba.get("phase") == "blocked" else ("waiting" if step and step.get("status") == "waiting" else "ready")),
            "actionType": nba.get("phase"),
            "title": nba["title"],
            "reason": nba["why"],
            "location": {"roomId": (room or {}).get("id"), "target": (room or {}).get("name") or "your home"},
            "requiredTools": (step or {}).get("tools_needed") or [],
            "requiredSafety": [x for x in [(step or {}).get("safety_note")] if x],
            "estimatedTime": (step or {}).get("estimated_time"),
            "visualGuidanceAvailable": visual_available,
            "arGuidanceAvailable": True,
            "verificationType": "user_confirmation",
            "nextTaskPreview": (upcoming[0]["instruction"][:120] if upcoming else None),
            "safety": safety,
            "actions": nba.get("actions", []),
            "progress": {"completed": len(completed), "current": 1 if step else 0,
                         "up_next": len(upcoming), "blocked": blockers_n, "waiting": len(waiting),
                         "remaining": max(len(steps) - len(completed) - (1 if step else 0), 0)},
        }

    @r.get("/now-summaries")
    async def now_summaries(user: dict = Depends(get_current_user)):
        """Next-action preview lines for the project list cards (Doc 51 §22)."""
        projects = await _db.hi_projects.find(
            {"user_id": user["id"], "status": {"$in": ["active", "paused", "draft", "planning"]}},
            {"_id": 0, "id": 1, "status": 1}).sort("created_at", -1).to_list(25)
        from project_intelligence_engine import _compute_nba
        out = {}
        for p in projects:
            full = await _db.hi_projects.find_one({"id": p["id"]}, {"_id": 0})
            try:
                nba = await _compute_nba(full, user["id"])
                out[p["id"]] = nba["title"][:100]
            except Exception:
                pass
        return {"summaries": out}

    @r.post("/projects/{pid}/steps/{sid}/skip-override")
    async def skip_override(pid: str, sid: str, req: OverrideReq, user: dict = Depends(get_current_user)):
        """Doc 51 §12 — skipping/bypassing requires an explicit recorded reason."""
        await _project(pid, user["id"])
        if req.reason not in OVERRIDE_REASONS:
            raise HTTPException(status_code=400, detail={"error": "Unknown override reason.",
                                                         "reasons": [{"code": k, "label": OVERRIDE_LABELS[k]} for k in OVERRIDE_REASONS]})
        step = await _db.hi_project_steps.find_one({"id": sid, "project_id": pid}, {"_id": 0})
        if not step:
            raise HTTPException(status_code=404, detail="Step not found.")
        await _db.hi_project_steps.update_one({"id": sid}, {"$set": {
            "status": "skipped", "completed_at": _now(),
            "override_reason": req.reason, "override_note": (req.note or "").strip()[:500] or None}})
        await _db.ws_overrides.insert_one({"id": _nid(), "project_id": pid, "step_id": sid,
                                           "user_id": user["id"], "reason": req.reason,
                                           "label": OVERRIDE_LABELS[req.reason],
                                           "note": (req.note or "").strip()[:500] or None, "created_at": _now()})
        return {"ok": True, "step_id": sid, "status": "skipped", "override": OVERRIDE_LABELS[req.reason]}

    @r.get("/override-reasons")
    async def override_reasons(user: dict = Depends(get_current_user)):
        return {"reasons": [{"code": k, "label": OVERRIDE_LABELS[k]} for k in OVERRIDE_REASONS]}

    @r.get("/projects/{pid}/briefing")
    async def briefing(pid: str, style: Optional[str] = None, user: dict = Depends(get_current_user)):
        p = await _project(pid, user["id"])
        if style not in BRIEFING_STYLES:
            prefs = await _db.ws_prefs.find_one({"user_id": user["id"]}, {"_id": 0, "briefing_style": 1})
            style = (prefs or {}).get("briefing_style") or "standard"
        out = await _briefing_payload(p, user, style)
        await _cap(user, "project.opened", {"project_id": pid})
        await _cap(user, "project.briefing.viewed", {"project_id": pid, "style": style})
        return out

    @r.get("/projects/{pid}/whats-next")
    async def whats_next(pid: str, minutes_available: Optional[int] = None, user: dict = Depends(get_current_user)):
        """Doc 49 §5 — next best action, adapted to the time the user actually has."""
        p = await _project(pid, user["id"])
        from project_intelligence_engine import _compute_nba
        nba = await _compute_nba(p, user["id"])
        out = {"recommendation": nba, "minutes_available": minutes_available}
        if minutes_available is not None and nba.get("phase") == "execute":
            step = await _db.hi_project_steps.find_one({"id": nba.get("step_id")}, {"_id": 0}) if nba.get("step_id") else None
            est_txt = str((step or {}).get("estimated_time") or "")
            digits = "".join(c for c in est_txt.split("-")[0] if c.isdigit())
            est_min = int(digits) if digits else 20
            if "hour" in est_txt.lower() and digits:
                est_min = int(digits) * 60
            out["estimated_minutes"] = est_min
            if minutes_available < min(est_min, 15):
                out["recommendation"] = {
                    "title": "Prep your tools and stage the next work area",
                    "why": f"You have about {minutes_available} minutes — not enough to finish the next step well. A short prep session makes the next session faster.",
                    "actions": ["review_step", "stage_tools", "check_materials"], "phase": "prep",
                    "full_step": nba["title"]}
            else:
                out["recommendation"]["why"] = f"You have {minutes_available} minutes and this step fits. " + nba["why"]
        return out

    @r.get("/projects/{pid}/readiness")
    async def readiness(pid: str, user: dict = Depends(get_current_user)):
        """Doc 49 §11 — verify materials readiness before work starts."""
        await _project(pid, user["id"])
        mats = await _db.hi_project_materials.find({"project_id": pid}, {"_id": 0}).to_list(200)
        missing = [m for m in mats if m.get("user_status") in ("need_it", "unsure")]
        alternatives = [m for m in mats if m.get("user_status") == "use_alternative"]
        ready = len(missing) == 0
        await _cap(user, "materials.checked", {"project_id": pid, "ready": ready})
        if not ready:
            await _cap(user, "materials.missing", {"project_id": pid, "missing_count": len(missing)})
        return {"ready": ready, "materials": mats, "missing": missing, "alternatives": alternatives,
                "options": MATERIAL_OPTIONS,
                "message": "Everything you need is on hand — ready to start." if ready
                else f"{len(missing)} item(s) still needed. You can buy them, use an alternative, or ask Homie."}

    @r.post("/projects/{pid}/problem")
    async def report_problem(pid: str, req: ProblemReq, user: dict = Depends(get_current_user)):
        """Doc 49 §7 — 'Something Changed' flow. Evaluates, routes, updates project state."""
        p = await _project(pid, user["id"])
        spec = PROBLEM_TYPES.get(req.problem_type)
        if not spec:
            raise HTTPException(status_code=400, detail="Unknown problem type.")
        note = (req.note or "").strip()[:1000]
        route, message, actions = spec["route"], spec["message"], list(spec["actions"])
        safety = None
        if spec["safety_check"]:
            try:
                from safety_engine import evaluate_action
                safety = evaluate_action(f"{spec['label']}. {note}", None)
                if safety.get("verdict") in ("block_action", "escalate_to_professional"):
                    route = "pro_review"
                    message = ("I'm not confident this is safe to continue without verification. "
                               "Let's stop this area and bring in a qualified professional.")
                    actions = ["stop_work", "bring_in_pro"]
                    await _db.hi_projects.update_one({"id": pid}, {"$set": {
                        "safety_status": "Stop and contact a professional", "updated_at": _now()}})
            except Exception:
                pass
        media_id = None
        if req.photo_base64:
            media = {"id": _nid(), "project_id": pid, "user_id": user["id"], "media_type": "photo",
                     "file_base64": req.photo_base64, "caption": f"Problem report: {spec['label']}",
                     "project_step_id": None, "created_at": _now()}
            await _db.hi_project_media.insert_one(media)
            media_id = media["id"]
        blocker_id = None
        if spec["blocker"] or route == "pro_review":
            blocker = {"id": _nid(), "project_id": pid, "user_id": user["id"],
                       "blocker_type": req.problem_type, "description": note or spec["label"],
                       "status": "active", "source": "problem_report", "media_id": media_id, "created_at": _now()}
            await _db.pi_blockers.insert_one(blocker)
            blocker_id = blocker["id"]
        doc = {"id": _nid(), "project_id": pid, "user_id": user["id"], "problem_type": req.problem_type,
               "note": note or None, "media_id": media_id, "blocker_id": blocker_id,
               "route": route, "safety_verdict": (safety or {}).get("verdict"), "created_at": _now()}
        await _db.ws_problems.insert_one(dict(doc)); doc.pop("_id", None)
        await _cap(user, "project.problem.reported", {"project_id": pid, "problem_type": req.problem_type, "route": route})
        state = await derive_project_state(await _db.hi_projects.find_one({"id": pid}, {"_id": 0}) or p)
        return {"problem": doc, "route": route, "message": message, "actions": actions,
                "state": state, "safety": safety}

    @r.get("/projects/{pid}/timeline")
    async def timeline(pid: str, user: dict = Depends(get_current_user)):
        """Doc 49 §8 — unified project evidence timeline (project memory & handoff record)."""
        p = await _project(pid, user["id"])
        items = []
        for s in await _steps(pid):
            if s.get("completed_at"):
                items.append({"type": "task_completed" if s["status"] == "completed" else "task_skipped",
                              "at": s["completed_at"], "title": s["instruction"][:120],
                              "detail": "Completed offline, synced later" if s.get("completed_offline") else None})
        for m in await _db.hi_project_media.find({"project_id": pid}, {"_id": 0, "file_base64": 0}).to_list(100):
            items.append({"type": "photo" if m.get("media_type") == "photo" else "media", "at": m["created_at"],
                          "title": m.get("caption") or "Photo added", "media_id": m["id"]})
        for n in await _db.hi_project_notes.find({"project_id": pid}, {"_id": 0}).to_list(100):
            items.append({"type": "note", "at": n["created_at"], "title": (n.get("note") or "")[:140]})
        for mt in await _db.hi_project_materials.find({"project_id": pid, "user_status": "have_it"}, {"_id": 0}).to_list(100):
            items.append({"type": "material_ready", "at": mt["created_at"], "title": f"Material on hand: {mt['name']}"})
        for b in await _db.pi_blockers.find({"project_id": pid}, {"_id": 0}).to_list(50):
            items.append({"type": "blocker", "at": b["created_at"], "title": f"Blocker: {b['description'][:120]}",
                          "detail": f"Status: {b.get('status')}"})
        for c in await _db.pi_change_events.find({"project_id": pid}, {"_id": 0}).to_list(50):
            items.append({"type": "plan_change", "at": c["created_at"],
                          "title": f"Plan change: {c.get('change_type', 'update')}",
                          "detail": str(c.get("new_value") or "")[:140]})
        for pr in await _db.ws_problems.find({"project_id": pid}, {"_id": 0}).to_list(50):
            spec = PROBLEM_TYPES.get(pr["problem_type"], {})
            items.append({"type": "problem", "at": pr["created_at"],
                          "title": f"Reported: {spec.get('label', pr['problem_type'])}",
                          "detail": pr.get("note")})
        for ov in await _db.ws_overrides.find({"project_id": pid}, {"_id": 0}).to_list(50):
            items.append({"type": "plan_change", "at": ov["created_at"],
                          "title": f"Step skipped with override: {ov.get('label')}", "detail": ov.get("note")})
        if p.get("completed_at"):
            items.append({"type": "project_complete", "at": p["completed_at"], "title": "Project completed"})
        items.sort(key=lambda x: x["at"], reverse=True)
        state = await derive_project_state(p)
        return {"items": items[:150], "state": state, "project": {"id": p["id"], "title": p["title"]}}

    @r.get("/projects/{pid}/offline-bundle")
    async def offline_bundle(pid: str, user: dict = Depends(get_current_user)):
        """Doc 49 §13 — everything needed to keep working in a basement with no signal."""
        p = await _project(pid, user["id"])
        phases = await _db.hi_project_phases.find({"project_id": pid}, {"_id": 0}).sort("sequence_number", 1).to_list(20)
        for ph in phases:
            ph["steps"] = await _db.hi_project_steps.find({"project_phase_id": ph["id"]}, {"_id": 0}).sort("sequence_number", 1).to_list(50)
        mats = await _db.hi_project_materials.find({"project_id": pid}, {"_id": 0}).to_list(200)
        briefing_data = await _briefing_payload(p, user, "standard")
        return {"project": p, "phases": phases, "materials": mats, "briefing": briefing_data,
                "cached_at": _now(),
                "offline_note": "Safety checks that need live data can't run offline — re-verify risky steps when back online."}

    return r
