"""
DIYhomie — Savings Intelligence & Project Funding Engine (Phase 1: Project Affordability MVP).

"Fund This Project" — a Project Savings Planner (NOT a coupon app, NOT financial advice).
Phase 1 is fully self-contained (no card/provider dependency): funding targets, a two-sided
affordability model (reduce project cost first, then find legitimate savings), strictly
separated savings classifications (confirmed/pending/expected/potential/opportunistic —
opportunistic NEVER counts toward a goal), manual savings with evidence notes, an immutable
internal ledger, a user Savings Wallet, and admin controls. Provider adapters (Kard/BenefitHub/
affiliate) are behind feature flags and inert until real agreements + server-side keys exist.

Ties into the Continuous Project Intelligence Orchestrator via its append-only event log.

Namespace: /api/hi/funding/*  &  /api/hi/admin/funding/*
Collections: fund_goals, fund_events, fund_ledger, fund_config
"""
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

CATEGORIES = ["groceries", "dining", "auto", "entertainment", "home_purchases", "travel", "everyday_shopping", "other"]
# Classifications that may count toward a funding goal (opportunistic is excluded by rule).
GOAL_CLASSES = ["confirmed", "pending", "expected", "potential"]
ALL_CLASSES = GOAL_CLASSES + ["opportunistic"]
LEDGER_STATUS = ["pending", "confirmed", "reversed", "expired", "disputed"]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _month_key():
    return datetime.now(timezone.utc).strftime("%Y-%m")


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


async def _orch_emit(project_id, user_id, etype, payload=None):
    try:
        import orchestrator_engine
        await orchestrator_engine._emit(project_id, user_id, etype, payload or {})
    except Exception:
        pass


async def _get_config() -> dict:
    cfg = await _db.fund_config.find_one({"id": "global"}, {"_id": 0})
    if not cfg:
        cfg = {"id": "global", "enabled": True, "categories": CATEGORIES, "forecast_window_days": 30,
               "min_savings_notify": 5.0, "conservative_forecast": True, "material_difference_threshold": 5.0,
               "kard_enabled": False, "benefithub_enabled": False, "affiliates_enabled": True}
        await _db.fund_config.insert_one(dict(cfg))
    return cfg


async def _owned_project(pid, uid):
    """Funding is project-scoped; the project must belong to the caller (orchestrator or hi project)."""
    p = await _db.orch_projects.find_one({"id": pid, "user_id": uid}, {"_id": 0})
    if p:
        return p
    p = await _db.hi_projects.find_one({"id": pid, "user_id": uid}, {"_id": 0})
    if p:
        return p
    raise HTTPException(status_code=404, detail="Project not found.")


def _round2(x):
    return round(float(x or 0) + 1e-9, 2)


async def _plan(project_id: str) -> dict:
    goal = await _db.fund_goals.find_one({"project_id": project_id}, {"_id": 0})
    target = _round2(goal["target_amount"]) if goal else 0.0
    budget = _round2(goal["current_budget"]) if goal else 0.0
    events = await _db.fund_events.find({"project_id": project_id}, {"_id": 0}).to_list(1000)
    sums = {c: 0.0 for c in ALL_CLASSES}
    for e in events:
        if e["classification"] in sums:
            sums[e["classification"]] += float(e.get("amount") or 0)
    sums = {k: _round2(v) for k, v in sums.items()}
    confirmed, pending, expected, potential = sums["confirmed"], sums["pending"], sums["expected"], sums["potential"]
    remaining_confirmed_gap = max(0.0, _round2(target - budget - confirmed))
    remaining_likely_gap = max(0.0, _round2(target - budget - confirmed - pending - expected))
    goal_reached = target > 0 and (budget + confirmed) >= target
    return {
        "has_goal": bool(goal), "target": target, "budget": budget, "needed_by": goal.get("needed_by") if goal else None,
        "categories": goal.get("categories", []) if goal else [],
        "confirmed": confirmed, "pending": pending, "expected": expected, "potential": potential,
        "opportunistic": sums["opportunistic"],
        "remaining_confirmed_gap": remaining_confirmed_gap, "remaining_likely_gap": remaining_likely_gap,
        "goal_reached": goal_reached,
    }


# ---- Cost-reduction engine (Reduce Project Cost side) ----

async def _cost_reduction_options(project_id: str) -> list:
    """Deterministic, honest cost-reduction options derived from the project's requirements.
    Realized savings are conservative and clearly classified. Never invents offers."""
    reqs = await _db.orch_requirements.find({"project_id": project_id}, {"_id": 0}).to_list(300)
    opts = []
    total_cost = 0.0
    for m in reqs:
        cost = float(m.get("cost_estimate") or 0)
        total_cost += cost
        if m.get("kind") in ("tool", "rental") and cost > 0:
            opts.append({"id": _nid(), "kind": "owned_or_toolshare", "label": f"Use an owned tool or ToolShare rental for {m['name']}",
                         "detail": "If you already own this or borrow via ToolShare, you can avoid buying it.",
                         "saving_estimate": _round2(cost), "classification": "expected", "requirement_id": m["id"]})
        elif m.get("kind") == "material" and cost > 0:
            opts.append({"id": _nid(), "kind": "best_value_alternative", "label": f"Choose a best-value alternative for {m['name']}",
                         "detail": "A compatible lower-cost product can reduce this line item.",
                         "saving_estimate": _round2(cost * 0.15), "classification": "expected", "requirement_id": m["id"]})
            opts.append({"id": _nid(), "kind": "community_used", "label": f"Check Homie Exchange / community for {m['name']}",
                         "detail": "A used or free compatible item may be available nearby.",
                         "saving_estimate": _round2(cost * 0.30), "classification": "potential", "requirement_id": m["id"]})
    # Generic scope/phase option.
    if total_cost > 0:
        opts.append({"id": _nid(), "kind": "phase_scope", "label": "Phase the project — defer nonessential upgrades",
                     "detail": "Split the work so you only fund the essentials now.",
                     "saving_estimate": _round2(total_cost * 0.20), "classification": "potential", "requirement_id": None})
    return opts


# ---- request models ----

class GoalReq(BaseModel):
    project_id: str
    target_amount: float
    current_budget: float = 0.0
    needed_by: Optional[str] = None
    categories: list[str] = []


class SavingsReq(BaseModel):
    project_id: str
    amount: float
    classification: str = "confirmed"
    source: str = "manual"                # project_materials | project_funding | member_savings | manual | project_cost_reduction
    note: Optional[str] = None
    evidence_ref: Optional[str] = None


class ApplyReductionReq(BaseModel):
    project_id: str
    kind: str
    label: str
    saving_estimate: float
    classification: str = "expected"
    requirement_id: Optional[str] = None


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/funding")

    @r.get("/config")
    async def config(user: dict = Depends(get_current_user)):
        cfg = await _get_config()
        return {"enabled": cfg["enabled"], "categories": cfg["categories"],
                "forecast_window_days": cfg["forecast_window_days"], "conservative_forecast": cfg["conservative_forecast"],
                "classifications": {
                    "confirmed": "Money you've actually saved, backed by a receipt or provider.",
                    "pending": "A reward detected but not yet settled.",
                    "expected": "A conservative forecast from a purchase you already plan to make.",
                    "potential": "A verified offer that's available but not used yet.",
                    "opportunistic": "An offer that needs an unplanned purchase — never counts toward your goal.",
                }}

    @r.post("/goals")
    async def set_goal(req: GoalReq, user: dict = Depends(get_current_user)):
        await _owned_project(req.project_id, user["id"])
        if req.target_amount <= 0:
            raise HTTPException(status_code=400, detail="Enter how much you'd like to cover.")
        cats = [c for c in req.categories if c in CATEGORIES]
        existing = await _db.fund_goals.find_one({"project_id": req.project_id}, {"_id": 0})
        doc = {"id": existing["id"] if existing else _nid(), "project_id": req.project_id, "user_id": user["id"],
               "target_amount": _round2(req.target_amount), "current_budget": _round2(req.current_budget),
               "needed_by": req.needed_by, "categories": cats,
               "created_at": existing["created_at"] if existing else _now(), "updated_at": _now()}
        await _db.fund_goals.update_one({"project_id": req.project_id}, {"$set": doc}, upsert=True)
        await _cap(user, "funding_goal_created", {"target": doc["target_amount"]})
        await _orch_emit(req.project_id, user["id"], "PROJECT_FUNDING_TARGET_SET", {"target": doc["target_amount"]})
        return {"goal": doc, "plan": await _plan(req.project_id)}

    @r.get("/goals/{project_id}")
    async def get_plan(project_id: str, user: dict = Depends(get_current_user)):
        await _owned_project(project_id, user["id"])
        await _cap(user, "fund_this_project_opened", {})
        return {"plan": await _plan(project_id)}

    @r.get("/savings/{project_id}")
    async def list_savings(project_id: str, user: dict = Depends(get_current_user)):
        await _owned_project(project_id, user["id"])
        rows = await _db.fund_events.find({"project_id": project_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
        return {"savings": rows}

    @r.post("/savings")
    async def add_savings(req: SavingsReq, user: dict = Depends(get_current_user)):
        await _owned_project(req.project_id, user["id"])
        if req.classification not in ALL_CLASSES:
            raise HTTPException(status_code=400, detail="Invalid savings classification.")
        if req.amount <= 0:
            raise HTTPException(status_code=400, detail="Enter a savings amount.")
        ev = {"id": _nid(), "project_id": req.project_id, "user_id": user["id"], "event_type": "manual_savings",
              "amount": _round2(req.amount), "classification": req.classification, "source": req.source,
              "note": (req.note or "")[:400] or None, "evidence_ref": req.evidence_ref, "created_at": _now(),
              "month": _month_key()}
        await _db.fund_events.insert_one(dict(ev)); ev.pop("_id", None)
        # Immutable ledger entry — status mirrors classification (no revenue in Phase 1).
        status = "confirmed" if req.classification == "confirmed" else ("pending" if req.classification == "pending" else "pending")
        await _db.fund_ledger.insert_one({
            "id": _nid(), "user_id": user["id"], "project_id": req.project_id, "merchant_master_id": None,
            "provider": "manual", "provider_offer_id": None, "purchase_amount": None,
            "customer_savings_amount": ev["amount"], "reward_amount": 0.0, "internal_revenue_amount": 0.0,
            "status": status if req.classification in ("confirmed", "pending") else "pending",
            "source": req.source, "transaction_date": _now(),
            "confirmed_at": _now() if req.classification == "confirmed" else None, "month": _month_key()})
        if req.classification == "confirmed":
            await _orch_emit(req.project_id, user["id"], "SAVINGS_REWARD_CONFIRMED", {"amount": ev["amount"]})
            await _cap(user, "reward_confirmed", {"amount": ev["amount"]})
        plan = await _plan(req.project_id)
        if plan["goal_reached"]:
            await _cap(user, "project_funding_goal_reached", {})
        return {"savings": ev, "plan": plan}

    @r.get("/cost-reduction/{project_id}")
    async def cost_reduction(project_id: str, user: dict = Depends(get_current_user)):
        await _owned_project(project_id, user["id"])
        await _cap(user, "savings_scan_started", {})
        opts = await _cost_reduction_options(project_id)
        await _cap(user, "savings_scan_completed", {"options": len(opts)})
        total_potential = _round2(sum(o["saving_estimate"] for o in opts))
        return {"options": opts, "total_potential": total_potential,
                "message": None if opts else "No verified savings opportunities were found right now."}

    @r.post("/cost-reduction/apply")
    async def apply_reduction(req: ApplyReductionReq, user: dict = Depends(get_current_user)):
        await _owned_project(req.project_id, user["id"])
        cls = req.classification if req.classification in GOAL_CLASSES else "expected"
        ev = {"id": _nid(), "project_id": req.project_id, "user_id": user["id"], "event_type": "cost_reduction",
              "amount": _round2(req.saving_estimate), "classification": cls, "source": "project_cost_reduction",
              "note": req.label[:200], "evidence_ref": None, "created_at": _now(), "month": _month_key(), "kind": req.kind}
        await _db.fund_events.insert_one(dict(ev)); ev.pop("_id", None)
        # If tied to a requirement, reduce its cost estimate (owned/alternative lowers project cost).
        if req.requirement_id and req.kind in ("owned_or_toolshare", "best_value_alternative"):
            m = await _db.orch_requirements.find_one({"id": req.requirement_id, "user_id": user["id"]}, {"_id": 0})
            if m and m.get("cost_estimate"):
                new_cost = max(0.0, _round2(m["cost_estimate"] - req.saving_estimate))
                await _db.orch_requirements.update_one({"id": req.requirement_id}, {"$set": {"cost_estimate": new_cost}})
        await _orch_emit(req.project_id, user["id"], "PROJECT_COST_ALTERNATIVE_FOUND",
                         {"label": req.label[:120], "saving": ev["amount"]})
        await _cap(user, "project_cost_reduced", {"saving": ev["amount"]})
        return {"applied": ev, "plan": await _plan(req.project_id)}

    @r.delete("/savings/{sid}")
    async def remove_savings(sid: str, user: dict = Depends(get_current_user)):
        ev = await _db.fund_events.find_one({"id": sid, "user_id": user["id"]}, {"_id": 0})
        if not ev:
            raise HTTPException(status_code=404, detail="Entry not found.")
        await _db.fund_events.delete_one({"id": sid})
        return {"ok": True, "plan": await _plan(ev["project_id"])}

    @r.get("/wallet")
    async def wallet(user: dict = Depends(get_current_user)):
        uid = user["id"]
        events = await _db.fund_events.find({"user_id": uid}, {"_id": 0}).to_list(5000)
        month = _month_key()
        month_confirmed = _round2(sum(e["amount"] for e in events if e["classification"] == "confirmed" and e.get("month") == month))
        lifetime_confirmed = _round2(sum(e["amount"] for e in events if e["classification"] == "confirmed"))
        pending = _round2(sum(e["amount"] for e in events if e["classification"] == "pending"))
        active_goals = await _db.fund_goals.count_documents({"user_id": uid})
        return {"month_confirmed": month_confirmed, "lifetime_confirmed": lifetime_confirmed,
                "pending": pending, "active_goals": active_goals}

    return r


class ConfigReq(BaseModel):
    enabled: Optional[bool] = None
    categories: Optional[list[str]] = None
    forecast_window_days: Optional[int] = None
    min_savings_notify: Optional[float] = None
    conservative_forecast: Optional[bool] = None
    material_difference_threshold: Optional[float] = None
    kard_enabled: Optional[bool] = None
    benefithub_enabled: Optional[bool] = None
    affiliates_enabled: Optional[bool] = None


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/funding", dependencies=[Depends(require_admin)])

    @r.get("/config")
    async def get_config(admin: dict = Depends(require_admin)):
        return {"config": await _get_config(), "categories": CATEGORIES,
                "providers": [{"key": "kard", "label": "Kard (card-linked)", "phase": 3},
                              {"key": "benefithub", "label": "BenefitHub (member discounts)", "phase": 4},
                              {"key": "affiliates", "label": "Affiliate routes", "phase": 2}]}

    @r.put("/config")
    async def put_config(req: ConfigReq, admin: dict = Depends(require_admin)):
        cfg = await _get_config()
        upd = {}
        for f in ("enabled", "conservative_forecast", "kard_enabled", "benefithub_enabled", "affiliates_enabled"):
            v = getattr(req, f)
            if v is not None:
                upd[f] = v
        if req.categories is not None:
            upd["categories"] = [c for c in req.categories if c in CATEGORIES]
        if req.forecast_window_days is not None:
            upd["forecast_window_days"] = max(1, min(365, req.forecast_window_days))
        if req.min_savings_notify is not None:
            upd["min_savings_notify"] = max(0.0, req.min_savings_notify)
        if req.material_difference_threshold is not None:
            upd["material_difference_threshold"] = max(0.0, req.material_difference_threshold)
        if upd:
            await _db.fund_config.update_one({"id": "global"}, {"$set": upd})
        return {"config": {**cfg, **upd}}

    @r.get("/dashboard")
    async def dashboard(admin: dict = Depends(require_admin)):
        events = await _db.fund_events.find({}, {"_id": 0}).to_list(20000)
        confirmed = _round2(sum(e["amount"] for e in events if e["classification"] == "confirmed"))
        cost_reduction = _round2(sum(e["amount"] for e in events if e.get("source") == "project_cost_reduction"))
        offer_savings = _round2(confirmed - sum(e["amount"] for e in events if e["classification"] == "confirmed" and e.get("source") == "project_cost_reduction"))
        goals = await _db.fund_goals.find({}, {"_id": 0}).to_list(5000)
        reached = 0
        for g in goals:
            plan = await _plan(g["project_id"])
            if plan["goal_reached"]:
                reached += 1
        return {"confirmed_customer_savings": confirmed, "cost_reduction_savings": cost_reduction,
                "offer_based_savings": max(0.0, offer_savings), "internal_revenue": 0.0,
                "active_goals": len(goals), "goals_reached": reached,
                "completion_rate": round(100 * reached / max(1, len(goals))), "entries": len(events)}

    @r.get("/ledger")
    async def ledger(admin: dict = Depends(require_admin)):
        rows = await _db.fund_ledger.find({}, {"_id": 0}).sort("transaction_date", -1).to_list(500)
        return {"ledger": rows, "total": await _db.fund_ledger.count_documents({})}

    return r


async def seed_funding():
    if _db is None:
        return
    try:
        await _db.fund_goals.create_index("project_id")
        await _db.fund_events.create_index("project_id")
        await _db.fund_events.create_index("user_id")
        await _db.fund_ledger.create_index("user_id")
        await _get_config()
        if _logger:
            _logger.info("savings & funding engine seeded")
    except Exception as e:
        if _logger:
            _logger.error(f"funding seed failed: {e}")
