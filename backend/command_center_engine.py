"""
Build Doc 12 — Home Command Center & Project Portfolio Engine.
Namespace /api/hi/command/*.

The homeowner's central operating view: one clear Do-next, top priorities with reason
traces, project portfolio grouped by state, resume-with-context briefings, recent home
activity, and calm personalization. Deterministic priority engine (safety always wins);
degrades gracefully with zero AI dependency.

Collections: cc_prefs, cc_item_actions. Reads gr_* (issues/plans/positions/followups/
timeline), hi_maintenance_occurrences.
"""
from datetime import datetime, timezone, timedelta
from typing import Callable, Optional, List
import uuid

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

_db = None
_logger = None

PORTFOLIO_STATES = ["needs_attention", "in_progress", "waiting_verification", "paused",
                    "professional_review", "monitoring", "completed"]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


async def _cap(user_id, event, props=None):
    try:
        from analytics_engine import capture
        await capture(user_id, event, props or {})
    except Exception:
        pass


def _issue_state(issue: dict, plan: Optional[dict]) -> str:
    """Map an issue to a portfolio state."""
    phase, status = issue.get("phase"), issue.get("status")
    if issue.get("triage", {}).get("hard_stop") or phase == "BLOCKED_ESCALATED":
        return "professional_review"
    if status == "paused":
        return "paused"
    if status == "monitoring":
        return "monitoring"
    if phase in ("DOCUMENTED", "COMPLETED") or status == "completed":
        return "completed"
    if plan:
        if any(t.get("status") == "awaiting_verification" for t in plan.get("tasks") or []):
            return "waiting_verification"
        if any(t.get("status") == "blocked" for t in plan.get("tasks") or []):
            return "needs_attention"
    if phase in ("IN_PROGRESS", "VERIFICATION"):
        return "in_progress"
    if phase in ("ISSUE_REPORTED", "ASSESSMENT", "INFORMATION_NEEDED", "SAFE_INSPECTION", "PLAN_READY"):
        return "needs_attention" if phase in ("ISSUE_REPORTED", "INFORMATION_NEEDED") else "in_progress"
    return "in_progress"


def _current_task(plan: Optional[dict]) -> Optional[dict]:
    if not plan:
        return None
    for t in plan.get("tasks") or []:
        if t.get("status") in ("available", "in_progress", "awaiting_verification", "blocked"):
            return {"id": t["id"], "title": t["title"], "status": t["status"]}
    return None


async def _hidden_keys(uid: str) -> set:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    rows = await _db.cc_item_actions.find(
        {"user_id": uid, "$or": [{"action": "dismiss"}, {"action": "defer", "created_at": {"$gte": cutoff}}]},
        {"_id": 0, "item_key": 1}).to_list(500)
    return {r["item_key"] for r in rows}


async def _build_priorities(uid: str, hidden: set) -> List[dict]:
    """Deterministic ranked priority items, each with a reason trace."""
    items: List[dict] = []
    issues = await _db.gr_issues.find({"user_id": uid, "status": {"$nin": ["archived"]}}, {"_id": 0}).to_list(300)
    plans = {p["issue_id"]: p for p in await _db.gr_plans.find(
        {"user_id": uid}, {"_id": 0, "issue_id": 1, "tasks.id": 1, "tasks.title": 1, "tasks.status": 1}).sort("version", 1).to_list(500)}

    # 1. Safety holds — always first, never hidden.
    for i in issues:
        if i.get("triage", {}).get("hard_stop") and i.get("status") not in ("completed",):
            items.append({"key": f"safety:{i['id']}", "rank": 1, "kind": "safety",
                          "title": "Safety hold — get the right help first",
                          "detail": (i.get("triage", {}).get("message") or i.get("description", ""))[:200],
                          "why": "An active safety condition overrides everything else.",
                          "route": f"/home-intel/repair/{i['id']}", "issue_id": i["id"],
                          "can_defer": False})

    # 2. Overdue / due follow-ups (verification & monitoring).
    today = _now()[:10]
    fus = await _db.gr_followups.find({"user_id": uid, "status": "open"}, {"_id": 0}).to_list(100)
    for f in fus:
        due = (f.get("due_at") or "")[:10]
        overdue = bool(due) and due <= today
        items.append({"key": f"followup:{f['id']}", "rank": 2 if overdue else 4, "kind": "follow_up",
                      "title": f.get("title") or "Follow-up check",
                      "detail": ("Due " + due) if due else "No date set — check when convenient",
                      "why": "Confirming the result protects the work you already did." if not overdue else "This check is due — small confirmations prevent bigger problems.",
                      "route": "/home-intel/record", "followup_id": f["id"], "can_defer": True})

    # 3. Projects that need attention (blocked / awaiting verification / info needed).
    for i in issues:
        state = _issue_state(i, plans.get(i["id"]))
        if state in ("needs_attention", "waiting_verification"):
            cur = _current_task(plans.get(i["id"]))
            items.append({"key": f"issue:{i['id']}", "rank": 3, "kind": "project",
                          "title": (i.get("description") or "Project")[:120],
                          "detail": (f"Next: {cur['title']}" if cur else {"ISSUE_REPORTED": "Needs an assessment",
                                     "INFORMATION_NEEDED": "Homie needs a couple of answers"}.get(i.get("phase"), "Waiting on you")),
                          "why": "A step is waiting on you — momentum is the cheapest tool you own.",
                          "route": f"/home-intel/repair/{i['id']}", "issue_id": i["id"], "can_defer": True})

    # 4. Maintenance due within 7 days (or overdue).
    week = (datetime.now(timezone.utc) + timedelta(days=7)).date().isoformat()
    occs = await _db.hi_maintenance_occurrences.find(
        {"user_id": uid, "status": {"$in": ["upcoming", "overdue", "pending"]}, "scheduled_date": {"$lte": week}},
        {"_id": 0}).sort("scheduled_date", 1).to_list(20)
    task_ids = [o["maintenance_task_id"] for o in occs]
    tasks = {t["id"]: t for t in await _db.hi_maintenance_tasks.find({"id": {"$in": task_ids}}, {"_id": 0, "id": 1, "title": 1}).to_list(50)}
    for o in occs:
        overdue = o["scheduled_date"] < today
        items.append({"key": f"maint:{o['id']}", "rank": 2 if overdue else 5, "kind": "maintenance",
                      "title": tasks.get(o["maintenance_task_id"], {}).get("title", "Maintenance task"),
                      "detail": ("Overdue since " if overdue else "Due ") + o["scheduled_date"],
                      "why": "Routine care is cheaper than the repair it prevents.",
                      "route": "/home-intel/maintenance", "occurrence_id": o["id"], "can_defer": True})

    visible = [it for it in items if it["kind"] == "safety" or it["key"] not in hidden]
    visible.sort(key=lambda x: (x["rank"], x["title"]))
    return visible


class ItemActionReq(BaseModel):
    item_key: str
    action: str  # defer | dismiss | restore


class PrefsReq(BaseModel):
    hide_completed: Optional[bool] = None
    pinned_issue_ids: Optional[List[str]] = None
    focus: Optional[str] = None  # safety | maintenance | projects | budget | balanced


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/command", tags=["command-center"])

    @r.get("/dashboard")
    async def dashboard(user: dict = Depends(get_current_user)):
        uid = user["id"]
        prefs = await _db.cc_prefs.find_one({"user_id": uid}, {"_id": 0}) or {"hide_completed": False, "pinned_issue_ids": [], "focus": "balanced"}
        hidden = await _hidden_keys(uid)
        priorities = await _build_priorities(uid, hidden)

        # Focus personalization reorders NON-safety items only.
        focus = prefs.get("focus") or "balanced"
        if focus != "balanced":
            kind_boost = {"maintenance": "maintenance", "projects": "project", "safety": "safety"}.get(focus)
            if kind_boost:
                priorities.sort(key=lambda x: (x["rank"] if x["kind"] == "safety" else (x["rank"] - 0.5 if x["kind"] == kind_boost else x["rank"]), x["title"]))

        do_next = priorities[0] if priorities else None
        urgent = [p for p in priorities if p["kind"] == "safety"]

        # Portfolio.
        issues = await _db.gr_issues.find({"user_id": uid, "status": {"$nin": ["archived"]}}, {"_id": 0}).sort("updated_at", -1).to_list(300)
        plans = {p["issue_id"]: p for p in await _db.gr_plans.find(
            {"user_id": uid}, {"_id": 0, "issue_id": 1, "tasks.id": 1, "tasks.title": 1, "tasks.status": 1}).sort("version", 1).to_list(500)}
        portfolio: dict = {s: [] for s in PORTFOLIO_STATES}
        for i in issues:
            state = _issue_state(i, plans.get(i["id"]))
            if state == "completed" and prefs.get("hide_completed"):
                continue
            cur = _current_task(plans.get(i["id"]))
            card = {"issue_id": i["id"], "title": (i.get("description") or "")[:120], "phase": i.get("phase"),
                    "state": state, "current_task": cur, "last_activity": i.get("updated_at"),
                    "room_id": i.get("room_id"), "asset_id": i.get("asset_id"),
                    "pinned": i["id"] in (prefs.get("pinned_issue_ids") or []),
                    "route": f"/home-intel/repair/{i['id']}"}
            portfolio[state].append(card)
        for s in portfolio:
            portfolio[s].sort(key=lambda c: (not c["pinned"], c["last_activity"] or ""), reverse=False)
            portfolio[s] = portfolio[s][:20]

        activity = await _db.gr_timeline.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1).to_list(8)
        active_count = sum(len(portfolio[s]) for s in PORTFOLIO_STATES if s != "completed")
        summary = {
            "urgent_count": len(urgent),
            "active_projects": active_count,
            "monitoring": len(portfolio["monitoring"]),
            "maintenance_due": len([p for p in priorities if p["kind"] == "maintenance"]),
            "open_followups": len([p for p in priorities if p["kind"] == "follow_up"]),
            "recently_completed": len(portfolio["completed"][:5]),
        }
        calm = not priorities
        await _cap(uid, "home_command_center.viewed", {"priorities": len(priorities), "calm": calm})
        return {"do_next": do_next, "top_priorities": priorities[1:4], "all_priorities_count": len(priorities),
                "urgent": urgent, "portfolio": portfolio, "summary": summary,
                "recent_activity": activity, "preferences": prefs, "calm": calm,
                "calm_message": "Nothing needs your attention right now — enjoy the quiet, your record is up to date." if calm else None}

    @r.get("/resume/{iid}")
    async def resume_context(iid: str, user: dict = Depends(get_current_user)):
        issue = await _db.gr_issues.find_one({"id": iid, "user_id": user["id"]}, {"_id": 0})
        if not issue:
            raise HTTPException(status_code=404, detail="Project not found.")
        plan = await _db.gr_plans.find_one({"issue_id": iid}, {"_id": 0}, sort=[("version", -1)])
        pos = await _db.gr_positions.find_one({"issue_id": iid}, {"_id": 0})
        cur = _current_task(plan)
        done = len([t for t in (plan.get("tasks") or []) if t.get("status") in ("complete", "superseded")]) if plan else 0
        total = len(plan.get("tasks") or []) if plan else 0
        last = issue.get("updated_at") or issue.get("created_at")
        days_idle = 0
        try:
            days_idle = (datetime.now(timezone.utc) - datetime.fromisoformat(last)).days
        except Exception:
            pass
        briefing = {
            "what_was_happening": f"{issue.get('description')} — {done}/{total} steps done." if plan else f"{issue.get('description')} — still in {issue.get('phase', 'assessment').replace('_', ' ').lower()}.",
            "what_changed": f"No activity for {days_idle} day(s)." if days_idle >= 3 else "You were here recently — pick up where you left off.",
            "still_required": (cur["title"] if cur else (pos or {}).get("next_recommended_action") or "Review the assessment and decide the next step."),
            "safety_boundary": (issue.get("triage", {}).get("message") if issue.get("triage", {}).get("hard_stop")
                                else ((pos or {}).get("safety_constraints") or [None])[0] if isinstance((pos or {}).get("safety_constraints"), list) else None),
            "current_task": cur, "long_pause": days_idle >= 7,
            "route": f"/home-intel/repair/{iid}",
        }
        await _cap(user["id"], "project_resumed", {"days_idle": days_idle})
        return {"briefing": briefing}

    @r.post("/items/action")
    async def item_action(req: ItemActionReq, user: dict = Depends(get_current_user)):
        if req.action not in ("defer", "dismiss", "restore"):
            raise HTTPException(status_code=400, detail="Invalid action.")
        if req.action == "restore":
            await _db.cc_item_actions.delete_many({"user_id": user["id"], "item_key": req.item_key})
        else:
            if req.item_key.startswith("safety:"):
                raise HTTPException(status_code=409, detail="Safety items can't be deferred or dismissed.")
            await _db.cc_item_actions.update_one(
                {"user_id": user["id"], "item_key": req.item_key},
                {"$set": {"user_id": user["id"], "item_key": req.item_key, "action": req.action, "created_at": _now()}},
                upsert=True)
        await _cap(user["id"], f"home_priority.{req.action}red" if req.action == "defer" else f"home_priority.{req.action}ed", {})
        return {"ok": True}

    @r.get("/preferences")
    async def get_prefs(user: dict = Depends(get_current_user)):
        prefs = await _db.cc_prefs.find_one({"user_id": user["id"]}, {"_id": 0})
        return {"preferences": prefs or {"hide_completed": False, "pinned_issue_ids": [], "focus": "balanced"}}

    @r.put("/preferences")
    async def put_prefs(req: PrefsReq, user: dict = Depends(get_current_user)):
        upd = {"user_id": user["id"], "updated_at": _now()}
        if req.hide_completed is not None:
            upd["hide_completed"] = bool(req.hide_completed)
        if req.pinned_issue_ids is not None:
            upd["pinned_issue_ids"] = req.pinned_issue_ids[:20]
        if req.focus is not None:
            if req.focus not in ("safety", "maintenance", "projects", "budget", "balanced"):
                raise HTTPException(status_code=400, detail="Invalid focus.")
            upd["focus"] = req.focus
        await _db.cc_prefs.update_one({"user_id": user["id"]}, {"$set": upd}, upsert=True)
        await _cap(user["id"], "dashboard_personalization.changed", {})
        prefs = await _db.cc_prefs.find_one({"user_id": user["id"]}, {"_id": 0})
        return {"preferences": prefs}

    return r
