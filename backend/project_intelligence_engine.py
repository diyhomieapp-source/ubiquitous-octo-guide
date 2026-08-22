"""
DIYhomie — Adaptive Project Intelligence & Execution Engine (Build Blueprint 21).

ENHANCES Blueprint 03 (Project Planner). Turns a project from a static checklist into a
stateful, dependency-aware workflow: a single clear "next best step", visible blockers,
decisions, budget snapshots, and change-impact review — WITHOUT rewriting the existing
planner. Reads existing hi_projects / hi_project_phases / hi_project_steps /
hi_project_materials; adds pi_blockers, pi_decisions, pi_change_events, pi_budget_snapshots.

Safety rule: safety-critical steps are never silently removed; skipped prerequisites surface
as visible blockers; scope/measurement/material/budget changes trigger an impact review that
the user approves. Completed history is preserved (changes append ProjectChangeEvents).
"""
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

BLOCKER_TYPES = ["missing_measurement", "missing_material", "missing_tool", "weather", "safety",
                 "budget", "user_question", "professional_required", "other"]
CHANGE_TYPES = ["scope", "measurement", "budget", "material", "schedule", "safety", "user_preference"]
SAFETY_STOP = "Stop and contact a professional"


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


def _sentry(event_type, message):
    try:
        import sentry_sdk
        sentry_sdk.capture_message(f"[pi:{event_type}] {message}", level="error")
    except Exception:
        pass


async def _project(pid: str, user_id: str) -> dict:
    p = await _db.hi_projects.find_one({"id": pid, "user_id": user_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found.")
    return p


async def _budget_snapshot(p: dict) -> dict:
    est_low = p.get("estimated_cost_low") or 0
    est_high = p.get("estimated_cost_high") or 0
    est_required = est_low
    est_optional = max(0, est_high - est_low)
    actual = p.get("actual_cost") or 0
    limit = p.get("budget_limit")
    variance = (limit - actual) if limit is not None else None
    return {"estimated_required_cost": est_required, "estimated_optional_cost": est_optional,
            "estimated_cost_low": est_low, "estimated_cost_high": est_high,
            "actual_spend": actual, "budget_limit": limit, "variance": variance,
            "over_budget": (limit is not None and actual > limit)}


# ------------------------------------------------------------- next best action
async def _compute_nba(p: dict, user_id: str) -> dict:
    pid = p["id"]
    # 1. active blockers first
    blocker = await _db.pi_blockers.find_one({"project_id": pid, "status": "active"}, {"_id": 0}, sort=[("created_at", 1)])
    if blocker:
        return {"title": f"Resolve: {blocker['description']}", "why": "A blocker is stopping safe progress on this project.",
                "actions": ["resolve_blocker", "ask_homie"], "phase": "blocked", "blocker_id": blocker["id"]}
    # 2. hard safety stop
    if p.get("safety_status") == SAFETY_STOP or p.get("risk_level") in ("Professional Recommended", "High Risk"):
        return {"title": "Talk to a professional before continuing", "why": "This work carries a high safety risk. Homie recommends a licensed pro for the risky part.",
                "actions": ["contact_pro", "ask_homie", "prepare_safely"], "phase": "safety"}
    # 3. materials not acquired
    mats = await _db.hi_project_materials.find({"project_id": pid}, {"_id": 0}).to_list(200)
    need = [m for m in mats if m.get("user_status") in ("need_it", "unsure")]
    active_step = await _db.hi_project_steps.find_one({"project_id": pid, "status": "active"}, {"_id": 0})
    if not active_step:
        # fall through to the next not-started step in plan order
        active_step = await _db.hi_project_steps.find_one({"project_id": pid, "status": "not_started"}, {"_id": 0}, sort=[("sequence_number", 1)])
    # 4. current active step
    if active_step:
        # if a required material for progress is missing, surface acquire first
        if need and p.get("status") in ("draft", "planning", "active"):
            return {"title": "Get the materials you still need", "why": f"{len(need)} item(s) are not marked as owned yet — line them up before you start the work.",
                    "actions": ["view_shopping_list", "match_toolbox", "skip_use_have"], "phase": "acquire", "step_id": active_step["id"]}
        return {"title": active_step["instruction"][:140], "why": "This is your current step in the plan.",
                "actions": ["view_step", "complete_step", "ask_homie"], "phase": "execute", "step_id": active_step["id"]}
    # 5. no active step → planning / completion
    total = await _db.hi_project_steps.count_documents({"project_id": pid})
    done = await _db.hi_project_steps.count_documents({"project_id": pid, "status": {"$in": ["completed", "skipped"]}})
    if total == 0:
        return {"title": "Build your step-by-step plan", "why": "Homie hasn't generated a plan for this project yet.",
                "actions": ["generate_plan", "ask_homie"], "phase": "plan"}
    if done >= total:
        return {"title": "Mark this project complete", "why": "All steps are done — capture your results and any savings.",
                "actions": ["complete_project"], "phase": "complete"}
    return {"title": "Continue your project", "why": "Pick up where you left off.", "actions": ["view_step", "ask_homie"], "phase": "execute"}


# ============================================================= models
class BlockerReq(BaseModel):
    blocker_type: str = "other"
    description: str
    work_item_id: Optional[str] = None


class DecisionReq(BaseModel):
    decision_type: str = "scope"
    question: str
    alternatives: Optional[list] = None
    work_item_id: Optional[str] = None


class AnswerReq(BaseModel):
    selected_option: str


class ChangeReq(BaseModel):
    change_type: str
    new_value: str
    old_value: Optional[str] = None


class BudgetReq(BaseModel):
    budget_limit: Optional[float] = None
    actual_cost: Optional[float] = None


EXPENSE_CATEGORIES = ["materials", "tools", "tool_rental", "delivery", "permits",
                      "professional_services", "disposal", "custom_manufacturing", "contingency", "other"]


class ExpenseReq(BaseModel):
    label: str
    amount: float
    category: str = "other"
    note: Optional[str] = None


class StuckReq(BaseModel):
    reason_code: str
    note: Optional[str] = None


class SafeCompleteReq(BaseModel):
    confirm: bool = False


def _change_impact(change_type: str, new_value: str) -> dict:
    """Produce a plain-language impact summary + recommendations. Never removes safety."""
    recs = []
    nv = (new_value or "").lower()
    if change_type == "budget":
        if nv in ("low", "tight", "minimal"):
            recs = ["Keep all required safety materials.", "Prioritize repair over replacement where safe.",
                    "Defer optional upgrades (e.g. extra lighting or finishes).", "Reuse leftovers from your Toolbox where possible."]
            summary = "Lowering the budget: Homie will favour essential, safe work and flag optional upgrades to defer."
        else:
            recs = ["Optional upgrades can be reconsidered.", "Higher-quality materials are now in range."]
            summary = "More budget headroom: optional upgrades and better materials become viable."
    elif change_type == "measurement":
        recs = ["Recheck material quantities against the new measurement.", "Confirm any cut lists or coverage estimates."]
        summary = "Measurement changed: material quantities and cut lists may need to be recalculated."
    elif change_type == "material":
        recs = ["Confirm the substitute is compatible.", "Avoid safety-sensitive substitutions without verification."]
        summary = "Material change: Homie will re-check compatibility. Substitutions need your confirmation."
    elif change_type == "scope":
        recs = ["Review which steps are added or removed.", "Required safety and inspection steps stay in place."]
        summary = "Scope changed: affected steps are re-evaluated; safety steps are always preserved."
    else:
        recs = ["Review recommendations before applying."]
        summary = f"{change_type.capitalize()} changed: review the impact before applying."
    return {"impact_summary": summary, "recommendations": recs}


# ============================================================= router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/pi", dependencies=[Depends(get_current_user)])

    # ---------------- Doc 44 §15 — "I'm stuck" recovery flow
    STUCK_REASONS = {
        "cant_find_part": {"label": "I cannot find the part", "route": "marketplace",
                           "guidance": "Let's find an alternative. Snap a photo of the part or its label and I'll identify compatible replacements.",
                           "next_action": "Photograph the part or its packaging label."},
        "measurement_mismatch": {"label": "The measurement does not match", "route": "measurement",
                                 "guidance": "A mismatch changes downstream cuts, quantities and cost. Let's re-measure before anything else.",
                                 "next_action": "Re-measure the area and update the project measurement — I'll recalculate what's affected."},
        "route_blocked": {"label": "Something is blocking the route", "route": "replan",
                          "guidance": "Blockers are normal. Photograph the obstruction so I can propose an alternate route or method.",
                          "next_action": "Take a clear photo of what's in the way."},
        "doesnt_fit": {"label": "The product does not fit", "route": "product",
                       "guidance": "Before forcing anything, let's verify the dimensions and check return or alternative options.",
                       "next_action": "Measure the product and the opening, then tell me both numbers."},
        "dont_understand": {"label": "I do not understand the step", "route": "guidance",
                            "guidance": "No problem — I'll break this step into smaller pieces and show it a different way.",
                            "next_action": "Open the guided view and I'll walk you through it slowly."},
        "found_utility": {"label": "I found plumbing / electrical / HVAC", "route": "safety",
                          "guidance": "Stop work in that spot. Do not cut or drill further until we verify what you found.",
                          "next_action": "Step back and photograph what you found — I'll assess it before you continue."},
        "feel_unsafe": {"label": "I do not feel safe continuing", "route": "safety",
                        "guidance": "Trust that instinct — stopping is the right call. Nothing here is worth getting hurt.",
                        "next_action": "Pause the project. Tell me what feels wrong and I'll figure out the safe path, including professional help if needed."},
        "other": {"label": "Something else", "route": "homie",
                  "guidance": "Tell me what happened in your own words and I'll figure out where we stand.",
                  "next_action": "Describe the problem to Homie."},
    }

    @r.get("/stuck/options")
    async def stuck_options(user: dict = Depends(get_current_user)):
        return {"options": [{"code": k, "label": v["label"]} for k, v in STUCK_REASONS.items()]}

    @r.post("/projects/{pid}/stuck")
    async def report_stuck(pid: str, req: StuckReq, user: dict = Depends(get_current_user)):
        p = await _project(pid, user["id"])
        reason = STUCK_REASONS.get(req.reason_code)
        if not reason:
            raise HTTPException(status_code=400, detail="Unknown reason.")
        result = dict(reason)
        # Safety-routed reasons get a real safety evaluation + event record.
        if reason["route"] == "safety":
            try:
                import safety_engine
                ev = safety_engine.evaluate_action(req.note or reason["label"])
                await safety_engine.record_event(user["id"], req.note or reason["label"], ev, source="stuck_flow")
                if ev["verdict"] != "allow":
                    result["safety"] = {k: ev[k] for k in ("verdict", "risk_level", "message", "next_action")}
            except Exception:
                pass
            await _db.hi_projects.update_one({"id": pid}, {"$set": {"status": "blocked"}})
        await _db.pi_stuck_reports.insert_one({
            "id": _nid(), "project_id": pid, "user_id": user["id"], "reason_code": req.reason_code,
            "note": (req.note or "")[:500], "route": reason["route"], "created_at": _now()})
        return {"reason_code": req.reason_code, **{k: result[k] for k in ("route", "guidance", "next_action")},
                "safety": result.get("safety"),
                "project_status": "blocked" if reason["route"] == "safety" else p.get("status")}


    @r.get("/projects/{pid}/next-best-action")
    async def next_best_action(pid: str, user: dict = Depends(get_current_user)):
        p = await _project(pid, user["id"])
        nba = await _compute_nba(p, user["id"])
        await _cap(user, "next_best_action_shown", {"phase": nba.get("phase")})
        return {"project_id": pid, "next_best_action": nba, "project_status": p.get("status")}

    @r.get("/projects/{pid}/workspace")
    async def workspace(pid: str, user: dict = Depends(get_current_user)):
        p = await _project(pid, user["id"])
        nba = await _compute_nba(p, user["id"])
        blockers = await _db.pi_blockers.find({"project_id": pid, "status": "active"}, {"_id": 0}).sort("created_at", 1).to_list(50)
        decisions = await _db.pi_decisions.find({"project_id": pid, "status": "pending"}, {"_id": 0}).to_list(50)
        mats = await _db.hi_project_materials.find({"project_id": pid}, {"_id": 0}).to_list(200)
        total = await _db.hi_project_steps.count_documents({"project_id": pid})
        done = await _db.hi_project_steps.count_documents({"project_id": pid, "status": {"$in": ["completed", "skipped"]}})
        return {"project": {"id": p["id"], "title": p.get("title"), "status": p.get("status"),
                            "safety_status": p.get("safety_status"), "risk_level": p.get("risk_level")},
                "next_best_action": nba,
                "progress": {"total": total, "done": done, "pct": round(done / total * 100) if total else 0},
                "blockers": blockers, "decisions": decisions,
                "needed_now": [{"name": m["name"], "user_status": m.get("user_status")} for m in mats if m.get("user_status") in ("need_it", "unsure")],
                "budget": await _budget_snapshot(p)}

    # ---- blockers
    @r.get("/projects/{pid}/blockers")
    async def list_blockers(pid: str, user: dict = Depends(get_current_user)):
        await _project(pid, user["id"])
        rows = await _db.pi_blockers.find({"project_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(100)
        return {"blockers": rows}

    @r.post("/projects/{pid}/blockers")
    async def add_blocker(pid: str, req: BlockerReq, user: dict = Depends(get_current_user)):
        await _project(pid, user["id"])
        if not req.description.strip():
            raise HTTPException(status_code=400, detail="Describe the blocker.")
        b = {"id": _nid(), "project_id": pid, "work_item_id": req.work_item_id,
             "blocker_type": req.blocker_type if req.blocker_type in BLOCKER_TYPES else "other",
             "description": req.description.strip()[:400], "status": "active",
             "created_at": _now(), "resolved_at": None}
        await _db.pi_blockers.insert_one(dict(b))
        if req.blocker_type in ("safety", "professional_required"):
            await _db.hi_projects.update_one({"id": pid}, {"$set": {"status": "blocked"}})
        await _cap(user, "blocker_created", {"blocker_type": b["blocker_type"]})
        b.pop("_id", None)
        return b

    @r.post("/blockers/{bid}/resolve")
    async def resolve_blocker(bid: str, user: dict = Depends(get_current_user)):
        b = await _db.pi_blockers.find_one({"id": bid}, {"_id": 0})
        if not b or not await _db.hi_projects.find_one({"id": b["project_id"], "user_id": user["id"]}):
            raise HTTPException(status_code=404, detail="Blocker not found.")
        await _db.pi_blockers.update_one({"id": bid}, {"$set": {"status": "resolved", "resolved_at": _now()}})
        # if no more active blockers, unblock the project
        remaining = await _db.pi_blockers.count_documents({"project_id": b["project_id"], "status": "active"})
        if remaining == 0:
            proj = await _db.hi_projects.find_one({"id": b["project_id"]}, {"_id": 0})
            if proj and proj.get("status") == "blocked":
                await _db.hi_projects.update_one({"id": b["project_id"]}, {"$set": {"status": "active"}})
        await _cap(user, "blocker_resolved", {})
        return {"ok": True, "remaining_active": remaining}

    # ---- decisions
    @r.post("/projects/{pid}/decisions")
    async def add_decision(pid: str, req: DecisionReq, user: dict = Depends(get_current_user)):
        await _project(pid, user["id"])
        d = {"id": _nid(), "project_id": pid, "work_item_id": req.work_item_id,
             "decision_type": req.decision_type, "question": req.question.strip()[:400],
             "selected_option": None, "alternatives": req.alternatives or [], "status": "pending",
             "created_at": _now(), "answered_at": None}
        await _db.pi_decisions.insert_one(dict(d))
        d.pop("_id", None)
        return d

    @r.post("/decisions/{did}/answer")
    async def answer_decision(did: str, req: AnswerReq, user: dict = Depends(get_current_user)):
        d = await _db.pi_decisions.find_one({"id": did}, {"_id": 0})
        if not d or not await _db.hi_projects.find_one({"id": d["project_id"], "user_id": user["id"]}):
            raise HTTPException(status_code=404, detail="Decision not found.")
        await _db.pi_decisions.update_one({"id": did}, {"$set": {
            "selected_option": req.selected_option, "status": "answered", "answered_at": _now()}})
        return await _db.pi_decisions.find_one({"id": did}, {"_id": 0})

    # ---- change impact
    @r.post("/projects/{pid}/change")
    async def change(pid: str, req: ChangeReq, user: dict = Depends(get_current_user)):
        p = await _project(pid, user["id"])
        if req.change_type not in CHANGE_TYPES:
            raise HTTPException(status_code=400, detail="Invalid change type.")
        impact = _change_impact(req.change_type, req.new_value)
        ev = {"id": _nid(), "project_id": pid, "change_type": req.change_type,
              "old_value": req.old_value, "new_value": req.new_value,
              "impact_summary": impact["impact_summary"], "recommendations": impact["recommendations"],
              "status": "pending_review", "created_at": _now()}
        await _db.pi_change_events.insert_one(dict(ev))
        await _cap(user, "project_scope_changed" if req.change_type == "scope" else
                   ("project_budget_changed" if req.change_type == "budget" else "project_scope_changed"), {"change_type": req.change_type})
        ev.pop("_id", None)
        return ev

    @r.post("/change-events/{eid}/apply")
    async def apply_change(eid: str, user: dict = Depends(get_current_user)):
        ev = await _db.pi_change_events.find_one({"id": eid}, {"_id": 0})
        if not ev or not await _db.hi_projects.find_one({"id": ev["project_id"], "user_id": user["id"]}):
            raise HTTPException(status_code=404, detail="Change not found.")
        # apply lightweight side-effects (budget preference recorded); history preserved
        if ev["change_type"] == "budget":
            await _db.hi_projects.update_one({"id": ev["project_id"]}, {"$set": {"budget_preference": ev["new_value"]}})
        await _db.pi_change_events.update_one({"id": eid}, {"$set": {"status": "applied", "user_decision": "approved", "applied_at": _now()}})
        await _cap(user, "project_change_approved", {"change_id": eid, "change_type": ev["change_type"]})
        return {"ok": True}

    @r.post("/change-events/{eid}/reject")
    async def reject_change(eid: str, user: dict = Depends(get_current_user)):
        ev = await _db.pi_change_events.find_one({"id": eid}, {"_id": 0})
        if not ev or not await _db.hi_projects.find_one({"id": ev["project_id"], "user_id": user["id"]}):
            raise HTTPException(status_code=404, detail="Change not found.")
        if ev.get("status") == "applied":
            raise HTTPException(status_code=409, detail="This change was already applied.")
        await _db.pi_change_events.update_one({"id": eid}, {"$set": {"status": "rejected", "user_decision": "rejected", "rejected_at": _now()}})
        await _cap(user, "project_change_rejected", {"change_id": eid, "change_type": ev["change_type"]})
        return {"ok": True}

    @r.get("/projects/{pid}/changes")
    async def change_history(pid: str, user: dict = Depends(get_current_user)):
        await _project(pid, user["id"])
        rows = await _db.pi_change_events.find({"project_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(100)
        return {"changes": rows}

    # ---- budget
    @r.get("/projects/{pid}/budget")
    async def get_budget(pid: str, user: dict = Depends(get_current_user)):
        p = await _project(pid, user["id"])
        return await _budget_snapshot(p)

    @r.put("/projects/{pid}/budget")
    async def set_budget(pid: str, req: BudgetReq, user: dict = Depends(get_current_user)):
        p = await _project(pid, user["id"])
        upd = {}
        if req.budget_limit is not None:
            upd["budget_limit"] = max(0, req.budget_limit)
        if req.actual_cost is not None:
            upd["actual_cost"] = max(0, req.actual_cost)
        if upd:
            await _db.hi_projects.update_one({"id": pid}, {"$set": upd})
        p = await _db.hi_projects.find_one({"id": pid}, {"_id": 0})
        snap = await _budget_snapshot(p)
        await _db.pi_budget_snapshots.insert_one({"id": _nid(), "project_id": pid, **snap, "created_at": _now()})
        return snap

    # ---- Doc 59: expenses + budget workspace
    @r.post("/projects/{pid}/expenses")
    async def add_expense(pid: str, req: ExpenseReq, user: dict = Depends(get_current_user)):
        await _project(pid, user["id"])
        if not req.label.strip():
            raise HTTPException(status_code=400, detail="A short label is required.")
        if req.amount is None or req.amount < 0:
            raise HTTPException(status_code=400, detail="Amount must be zero or more.")
        doc = {"id": _nid(), "project_id": pid, "user_id": user["id"],
               "label": req.label.strip()[:120],
               "category": req.category if req.category in EXPENSE_CATEGORIES else "other",
               "amount": round(float(req.amount), 2), "note": req.note,
               "created_at": _now()}
        await _db.pi_expenses.insert_one(dict(doc))
        doc.pop("_id", None)
        await _cap(user, "project_expense_added", {"project_id": pid, "category": doc["category"]})
        return doc

    @r.get("/projects/{pid}/expenses")
    async def list_expenses(pid: str, user: dict = Depends(get_current_user)):
        await _project(pid, user["id"])
        rows = await _db.pi_expenses.find({"project_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(200)
        return {"expenses": rows, "categories": EXPENSE_CATEGORIES,
                "total": round(sum(e.get("amount") or 0 for e in rows), 2)}

    @r.get("/projects/{pid}/budget-workspace")
    async def budget_workspace(pid: str, user: dict = Depends(get_current_user)):
        """Doc 59 — summary-first budget view with honest estimate confidence."""
        p = await _project(pid, user["id"])
        snap = await _budget_snapshot(p)
        mats = await _db.hi_project_materials.find({"project_id": pid}, {"_id": 0}).to_list(300)
        expenses = await _db.pi_expenses.find({"project_id": pid}, {"_id": 0}).to_list(200)
        mat_actual = round(sum((m.get("actual_price") or 0) for m in mats), 2)
        exp_total = round(sum((e.get("amount") or 0) for e in expenses), 2)
        purchased = round(mat_actual + exp_total, 2)
        est_high = snap.get("estimated_cost_high") or snap.get("estimated_cost_low") or 0
        remaining = round(max(0, est_high - purchased), 2)
        target = snap.get("budget_limit")
        if target is None:
            status = "no_target"
        elif purchased > target:
            status = "over_budget"
        elif est_high > target:
            status = "at_risk"
        else:
            status = "on_track"
        # estimate confidence (honest, derived — never asserted)
        meas = await _db.hi_measurements.find({"user_id": user["id"], "project_id": pid},
                                              {"_id": 0, "verification_status": 1}).to_list(100)
        confirmed_meas = any(m.get("verification_status") in ("user_confirmed", "verified", "verified_future") for m in meas)
        qty_based = [m for m in mats if m.get("quantity_basis") in ("measured", "user_entered")]
        priced = [m for m in mats if m.get("actual_price") is not None or m.get("estimated_price") is not None]
        if confirmed_meas and (qty_based or priced):
            confidence, reason = "high", "Based on confirmed measurements and known product quantities."
        elif meas or qty_based or priced:
            confidence, reason = "medium", "Based on estimated quantities or pricing assumptions — confirm measurements to improve this."
        else:
            confidence, reason = "low", "Important project details (measurements, quantities) are still unknown."
        return {"project": {"id": pid, "title": p.get("title")},
                "estimated_total": est_high, "estimated_low": snap.get("estimated_cost_low") or 0,
                "purchased_total": purchased,
                "breakdown": {"materials_actual": mat_actual, "expenses": exp_total},
                "remaining_estimate": remaining, "budget_target": target, "status": status,
                "confidence": confidence, "confidence_reason": reason,
                "expense_count": len(expenses)}

    # ---- safety-gated completion
    @r.post("/projects/{pid}/steps/{step_id}/safe-complete")
    async def safe_complete(pid: str, step_id: str, req: SafeCompleteReq, user: dict = Depends(get_current_user)):
        p = await _project(pid, user["id"])
        step = await _db.hi_project_steps.find_one({"id": step_id, "project_id": pid}, {"_id": 0})
        if not step:
            raise HTTPException(status_code=404, detail="Step not found.")
        risky = bool(step.get("safety_note")) or p.get("risk_level") in ("High Risk", "Professional Recommended")
        if risky and not req.confirm:
            raise HTTPException(status_code=428, detail="This step involves safety — confirm you completed it safely.")
        await _db.hi_project_steps.update_one({"id": step_id}, {"$set": {"status": "completed", "completed_at": _now()}})
        await _cap(user, "work_item_completed", {"required": True})
        return {"ok": True}

    return r
