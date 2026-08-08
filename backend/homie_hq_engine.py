"""
DIYhomie — Homie HQ Operations, Growth & AI Cost Intelligence (Build Blueprint 25).

Admin-only operational intelligence layer. Does NOT replace PostHog (behavioral analytics)
or Sentry (errors/perf). It NORMALIZES internal + external signals into standardized metrics,
detects insights (anomaly/trend/correlation/opportunity/risk) WITH evidence + confidence +
impact, and produces explainable recommendations gated by an automation level & approval center.

Answers one question: "What needs attention today?" — connecting
Technical Event -> User Behavior Impact -> Business Impact -> Recommendation -> Confidence
-> Human Approval or Safe Automation.

External connectors (PostHog / Sentry / Paddle / ad platforms) run DORMANT until keys exist;
all metrics below are computed from internal Mongo data + AI usage records + monitoring events.

Collections: op_metrics, op_alerts, op_insights, op_recommendations, op_approvals,
ai_usage_records, op_experiments, op_settings.
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None
_plan_tiers = {}

DOMAINS = ["app_health", "user_experience", "revenue", "ai_cost", "growth"]
SEVERITY = ["info", "low", "medium", "high", "critical"]
AUTOMATION_LEVELS = ["observe", "recommend", "prepare", "approval_required", "automated"]

# Actions that may execute automatically (low-risk, non-financial, reversible).
AUTO_SAFE_ACTIONS = {"create_alert", "open_support_ticket", "retry_integration_job", "pause_noncritical_connector"}
# High-impact actions ALWAYS require explicit admin approval.
HIGH_IMPACT_ACTIONS = {"change_pricing", "change_ad_budget", "send_bulk_email", "publish_content",
                       "change_entitlements", "disable_core_feature", "change_partner_ranking",
                       "change_reward_economics"}

# Rough token/cost estimation (internal estimates only, never user-facing billing).
GPT4O_MINI_IN = 0.15 / 1_000_000
GPT4O_MINI_OUT = 0.60 / 1_000_000
SONAR_PRO_IN = 3.0 / 1_000_000
SONAR_PRO_OUT = 15.0 / 1_000_000


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


def _dt(days=0, hours=0):
    return (datetime.now(timezone.utc) - timedelta(days=days, hours=hours)).isoformat()


def configure(db, logger, plan_tiers=None):
    global _db, _logger, _plan_tiers
    _db, _logger, _plan_tiers = db, logger, plan_tiers or {}


async def _cap(user, event, props=None):
    try:
        import analytics_engine
        await analytics_engine.capture(user, event, props or {})
    except Exception:
        pass


def _sentry(event_type, message):
    try:
        import sentry_sdk
        sentry_sdk.capture_message(f"[homie_hq:{event_type}] {message}", level="error")
    except Exception:
        pass


# ============================================================= AI Cost Intelligence (public helper)
def estimate_cost(provider: str, in_chars: int, out_chars: int) -> tuple:
    """Rough internal cost estimate from char counts (~4 chars/token). Returns (in_tok, out_tok, cost)."""
    in_tok = max(0, in_chars // 4)
    out_tok = max(0, out_chars // 4)
    if provider == "perplexity":
        cost = in_tok * SONAR_PRO_IN + out_tok * SONAR_PRO_OUT
    else:
        cost = in_tok * GPT4O_MINI_IN + out_tok * GPT4O_MINI_OUT
    return in_tok, out_tok, round(cost, 6)


async def record_ai_usage(provider: str, feature_area: str, in_chars: int, out_chars: int,
                          latency_ms: float, status: str = "ok", user_id: Optional[str] = None,
                          project_id: Optional[str] = None):
    """Sanitized AIUsageRecord — attributable by feature area. Never stores prompt/response content."""
    if _db is None:
        return
    try:
        in_tok, out_tok, cost = estimate_cost(provider, in_chars, out_chars)
        await _db.ai_usage_records.insert_one({
            "id": _nid(), "request_id": _nid(), "provider_reference": provider,
            "feature_area": feature_area or "general", "user_id": user_id, "project_id": project_id,
            "input_usage": in_tok, "output_usage": out_tok, "estimated_cost": cost, "currency": "USD",
            "latency_ms": round(latency_ms, 1), "status": status, "created_at": _now()})
    except Exception as e:
        _sentry("cost_calculation_failure", str(e))


# ============================================================= settings
async def _settings() -> dict:
    s = await _db.op_settings.find_one({"id": "singleton"}, {"_id": 0})
    if not s:
        s = {"id": "singleton",
             "ai_daily_cost_threshold": 5.0, "ai_cost_per_user_threshold": 0.50,
             "error_rate_threshold_24h": 25, "support_backlog_threshold": 15,
             "fraud_backlog_threshold": 5, "activation_floor_pct": 30.0,
             "auto_execute_safe_actions": True, "updated_at": _now()}
        await _db.op_settings.insert_one(dict(s)); s.pop("_id", None)
    return s


# ============================================================= metric collectors (internal, keyless)
async def _snapshot_metric(metric_key, domain, value, unit, source="internal", ref=None):
    await _db.op_metrics.insert_one({
        "id": _nid(), "metric_key": metric_key, "domain": domain, "value": value, "unit": unit,
        "period_start": _dt(days=1), "period_end": _now(), "source_system": source,
        "source_reference": ref, "created_at": _now()})


async def collect_app_health() -> dict:
    errs_24h = await _db.error_events.count_documents({"at": {"$gte": _dt(days=1)}})
    errs_5xx = await _db.error_events.count_documents({"at": {"$gte": _dt(days=1)}, "status": {"$gte": 500}})
    open_incidents = await _db.incidents.count_documents({"status": "open"})
    m = {"errors_24h": errs_24h, "server_errors_24h": errs_5xx, "open_incidents": open_incidents}
    await _snapshot_metric("errors_24h", "app_health", errs_24h, "count")
    return m


async def collect_revenue() -> dict:
    month_start = _dt(days=30)
    txns = await _db.payment_transactions.find(
        {"created_at": {"$gte": month_start}, "payment_status": "paid"}, {"_id": 0}).to_list(5000)
    rev_month = round(sum((t.get("amount") or 0) for t in txns), 2)
    active_subs = await _db.users.count_documents({"subscription_tier": {"$in": ["pro", "starter", "master"]}})
    # MRR approximation from plan tiers
    mrr = 0.0
    for tier, meta in (_plan_tiers or {}).items():
        n = await _db.users.count_documents({"subscription_tier": tier})
        price = (meta.get("amount", 0) / 100.0) if isinstance(meta, dict) else 0
        mrr += n * price
    partner_rev = round(sum((e.get("amount") or 0) for e in await _db.revenue_events.find(
        {"status": "received", "created_at": {"$gte": month_start}}, {"_id": 0}).to_list(5000)), 2)
    m = {"revenue_month": rev_month, "mrr": round(mrr, 2), "paying_users": active_subs, "partner_revenue_month": partner_rev}
    await _snapshot_metric("mrr", "revenue", round(mrr, 2), "usd")
    return m


async def collect_ai_costs() -> dict:
    today = _dt(days=1)
    recs = await _db.ai_usage_records.find({"created_at": {"$gte": today}}, {"_id": 0}).to_list(20000)
    total = round(sum(r.get("estimated_cost", 0) for r in recs), 4)
    by_feature: dict = {}
    by_provider: dict = {}
    fails = 0
    for r in recs:
        by_feature[r["feature_area"]] = round(by_feature.get(r["feature_area"], 0) + r.get("estimated_cost", 0), 5)
        by_provider[r["provider_reference"]] = round(by_provider.get(r["provider_reference"], 0) + r.get("estimated_cost", 0), 5)
        if r.get("status") != "ok":
            fails += 1
    active_users = max(1, await _db.users.count_documents({"last_login_at": {"$gte": _dt(days=1)}}) or 1)
    subs = max(1, await _db.users.count_documents({"subscription_tier": {"$in": ["pro", "starter", "master"]}}) or 1)
    m = {"cost_24h": total, "requests_24h": len(recs), "failed_requests_24h": fails,
         "cost_per_active_user": round(total / active_users, 5), "cost_per_subscriber": round(total / subs, 5),
         "by_feature": by_feature, "by_provider": by_provider}
    await _snapshot_metric("ai_cost_24h", "ai_cost", total, "usd")
    return m


async def collect_growth() -> dict:
    new_users_7d = await _db.users.count_documents({"created_at": {"$gte": _dt(days=7)}})
    projects_created_7d = await _db.hi_projects.count_documents({"created_at": {"$gte": _dt(days=7)}})
    projects_completed_7d = await _db.hi_projects.count_documents({"status": "completed", "completed_at": {"$gte": _dt(days=7)}})
    total_projects = await _db.hi_projects.count_documents({})
    completed_total = await _db.hi_projects.count_documents({"status": "completed"})
    activation = round((completed_total / total_projects * 100), 1) if total_projects else 0.0
    m = {"new_users_7d": new_users_7d, "projects_created_7d": projects_created_7d,
         "projects_completed_7d": projects_completed_7d, "activation_pct": activation}
    await _snapshot_metric("new_users_7d", "growth", new_users_7d, "count")
    return m


async def collect_support() -> dict:
    open_tickets = await _db.hi_support_tickets.count_documents({"status": {"$in": ["open", "new", "pending"]}})
    fraud_pending = await _db.fraud_reviews.count_documents({"status": "pending"})
    return {"open_tickets": open_tickets, "fraud_pending": fraud_pending}


# ============================================================= insight + recommendation engine
async def _emit_insight(insight_type, domain, title, summary, evidence, confidence, impact):
    doc = {"id": _nid(), "insight_type": insight_type, "domain": domain, "title": title,
           "summary": summary, "evidence": evidence, "confidence_score": confidence,
           "impact_score": impact, "status": "new", "created_at": _now()}
    await _db.op_insights.insert_one(dict(doc)); doc.pop("_id", None)
    await _cap({"id": "system"}, "insight_viewed", {"domain": domain, "type": insight_type})
    return doc


async def _emit_alert(domain, severity, title, description, evidence_ref):
    # de-dupe an identical open alert (same title) so refresh doesn't spam
    if await _db.op_alerts.find_one({"title": title, "status": "open"}):
        return None
    doc = {"id": _nid(), "domain": domain, "severity": severity, "title": title,
           "description": description, "evidence_reference": evidence_ref, "detected_at": _now(),
           "status": "open", "created_at": _now()}
    await _db.op_alerts.insert_one(dict(doc)); doc.pop("_id", None)
    return doc


async def _emit_recommendation(insight_id, title, action, automation_level, impact, confidence, risk, action_key):
    doc = {"id": _nid(), "insight_id": insight_id, "title": title, "recommended_action": action,
           "action_key": action_key, "automation_level": automation_level, "estimated_impact": impact,
           "confidence_score": confidence, "risk_level": risk, "status": "draft",
           "created_at": _now(), "executed_at": None}
    # route by automation level
    if automation_level == "automated" and action_key in AUTO_SAFE_ACTIONS:
        doc["status"] = "executed"; doc["executed_at"] = _now()
    elif automation_level == "approval_required" or action_key in HIGH_IMPACT_ACTIONS:
        doc["status"] = "pending_approval"
    await _db.op_recommendations.insert_one(dict(doc)); doc.pop("_id", None)
    await _cap({"id": "system"}, "recommendation_created", {"automation_level": automation_level, "risk": risk})
    if doc["status"] == "pending_approval":
        await _db.op_approvals.insert_one({
            "id": _nid(), "recommendation_id": doc["id"], "requested_by": "system",
            "approver_user_id": None, "decision": "pending", "decision_note": None,
            "created_at": _now(), "decided_at": None})
        await _cap({"id": "system"}, "approval_requested", {"recommendation": doc["title"]})
    return doc


async def run_insights():
    """Signal -> baseline -> impact -> recommendation -> confidence. Never a raw single-metric alert."""
    if _db is None:
        return
    try:
        s = await _settings()
        health = await collect_app_health()
        ai = await collect_ai_costs()
        growth = await collect_growth()
        support = await collect_support()

        # --- App Health: error volume breach (technical -> user/business impact)
        if health["errors_24h"] >= s["error_rate_threshold_24h"]:
            sev = "critical" if health["server_errors_24h"] >= 10 else "high"
            ev = {"errors_24h": health["errors_24h"], "server_errors_24h": health["server_errors_24h"],
                  "threshold": s["error_rate_threshold_24h"], "source": "monitoring.error_events"}
            ins = await _emit_insight("risk", "app_health",
                "Elevated API errors in the last 24h",
                f"{health['errors_24h']} request errors ({health['server_errors_24h']} server-side) exceed the "
                f"{s['error_rate_threshold_24h']} baseline. Failing requests reduce onboarding and project completion.",
                ev, confidence=88, impact=85)
            await _emit_recommendation(ins["id"],
                "Investigate the top failing endpoints and consider disabling the affected release path",
                "Open DevOps & Monitoring, review top failing endpoints, and disable the suspect release via feature flag after confirming.",
                "approval_required", "Restore crash-free experience; protect activation.", 88, "high", "disable_core_feature")

        # --- AI cost threshold (internal estimate only; never disable safety features)
        if ai["cost_24h"] >= s["ai_daily_cost_threshold"]:
            top_feature = max(ai["by_feature"].items(), key=lambda x: x[1]) if ai["by_feature"] else ("general", 0)
            ev = {"cost_24h": ai["cost_24h"], "threshold": s["ai_daily_cost_threshold"],
                  "top_feature": top_feature[0], "top_feature_cost": top_feature[1],
                  "cost_per_active_user": ai["cost_per_active_user"], "source": "ai_usage_records"}
            ins = await _emit_insight("risk", "ai_cost",
                "AI spend exceeded the daily threshold",
                f"Estimated AI cost ${ai['cost_24h']} passed the ${s['ai_daily_cost_threshold']} threshold. "
                f"'{top_feature[0]}' is the largest driver. Costs are internal estimates, not billing.",
                ev, confidence=80, impact=60)
            await _emit_recommendation(ins["id"],
                f"Review the '{top_feature[0]}' feature's AI usage and caching/model choices",
                "Inspect AI Costs by feature; consider prompt trimming, caching, or a cheaper model for non-safety paths. Do NOT disable safety features.",
                "recommend", "Lower cost per active user without harming safety.", 80, "low", "review_ai_usage")

        if ai["cost_per_active_user"] >= s["ai_cost_per_user_threshold"]:
            ev = {"cost_per_active_user": ai["cost_per_active_user"], "threshold": s["ai_cost_per_user_threshold"], "source": "ai_usage_records"}
            await _emit_insight("trend", "ai_cost", "Cost per active user is rising",
                f"AI cost per active user is ${ai['cost_per_active_user']} (threshold ${s['ai_cost_per_user_threshold']}).",
                ev, confidence=72, impact=45)

        # --- Support backlog (user experience)
        if support["open_tickets"] >= s["support_backlog_threshold"]:
            ev = {"open_tickets": support["open_tickets"], "threshold": s["support_backlog_threshold"], "source": "hi_support_tickets"}
            ins = await _emit_insight("risk", "user_experience", "Support backlog is high",
                f"{support['open_tickets']} open tickets exceed the {s['support_backlog_threshold']} threshold — response time and satisfaction are at risk.",
                ev, confidence=90, impact=55)
            await _emit_recommendation(ins["id"], "Open a support triage ticket and prioritize oldest open tickets",
                "Auto-created an internal support triage item.", "automated", "Protect response SLA.", 90, "low", "open_support_ticket")

        # --- Fraud backlog (revenue integrity)
        if support["fraud_pending"] >= s["fraud_backlog_threshold"]:
            ev = {"fraud_pending": support["fraud_pending"], "threshold": s["fraud_backlog_threshold"], "source": "fraud_reviews"}
            await _emit_alert("revenue", "medium", "Reward redemptions awaiting fraud review",
                f"{support['fraud_pending']} redemptions are pending review. Users' points are held safely meanwhile.",
                ev)

        # --- Activation opportunity (growth)
        if growth["activation_pct"] and growth["activation_pct"] < s["activation_floor_pct"]:
            ev = {"activation_pct": growth["activation_pct"], "floor": s["activation_floor_pct"],
                  "created_7d": growth["projects_created_7d"], "completed_7d": growth["projects_completed_7d"], "source": "hi_projects"}
            ins = await _emit_insight("opportunity", "growth", "Project completion (activation) is below target",
                f"Only {growth['activation_pct']}% of projects reach completion (target {s['activation_floor_pct']}%). Improving guidance at drop-off steps could lift completion.",
                ev, confidence=68, impact=70)
            await _emit_recommendation(ins["id"], "Prepare an onboarding/guidance experiment for the drop-off step",
                "Draft a PostHog experiment (feature-flag gated) targeting users who stall mid-project.",
                "prepare", "Higher activation and subscription conversion.", 68, "low", "prepare_experiment")

        # --- Success signal
        if growth["projects_completed_7d"] > growth["projects_created_7d"] and growth["projects_completed_7d"] > 0:
            await _emit_insight("trend", "growth", "Project completions are outpacing new starts",
                f"{growth['projects_completed_7d']} completed vs {growth['projects_created_7d']} started this week — strong follow-through.",
                {"completed_7d": growth["projects_completed_7d"], "created_7d": growth["projects_created_7d"]},
                confidence=75, impact=30)
    except Exception as e:
        _sentry("insight_engine_failure", str(e))
        if _logger:
            _logger.error(f"homie_hq run_insights failed: {e}")


# ============================================================= models
class SettingsReq(BaseModel):
    ai_daily_cost_threshold: Optional[float] = None
    ai_cost_per_user_threshold: Optional[float] = None
    error_rate_threshold_24h: Optional[int] = None
    support_backlog_threshold: Optional[int] = None
    fraud_backlog_threshold: Optional[int] = None
    activation_floor_pct: Optional[float] = None
    auto_execute_safe_actions: Optional[bool] = None


class DecisionReq(BaseModel):
    decision: str  # approved | rejected
    note: Optional[str] = None


class ExperimentReq(BaseModel):
    hypothesis: str
    target_segment: str
    feature_flag_reference: Optional[str] = None
    primary_metric: str
    guardrail_metric: Optional[str] = None
    requires_approval: bool = False


class ExperimentDecisionReq(BaseModel):
    decision_status: str  # running | winner | no_change | stopped


# ============================================================= admin router
def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/hq", dependencies=[Depends(require_admin)])

    @r.post("/refresh")
    async def refresh(admin: dict = Depends(require_admin)):
        await run_insights()
        return {"ok": True, "refreshed_at": _now()}

    @r.get("/dashboard")
    async def dashboard(admin: dict = Depends(require_admin)):
        await run_insights()
        await _cap(admin, "homie_hq_opened", {})
        health = await collect_app_health()
        revenue = await collect_revenue()
        ai = await collect_ai_costs()
        growth = await collect_growth()
        support = await collect_support()

        alerts = await _db.op_alerts.find({"status": "open"}, {"_id": 0}).sort("detected_at", -1).to_list(100)
        pending_approvals = await _db.op_approvals.count_documents({"decision": "pending"})
        recs_pending = await _db.op_recommendations.find({"status": "pending_approval"}, {"_id": 0}).sort("created_at", -1).to_list(50)
        insights = await _db.op_insights.find({"status": "new"}, {"_id": 0}).sort("impact_score", -1).to_list(100)

        urgent = [a for a in alerts if a["severity"] in ("critical", "high")]
        needs_review = [{"type": "approval", **rc} for rc in recs_pending] + \
                       [{"type": "insight", **i} for i in insights if i["insight_type"] in ("risk",) and i["impact_score"] >= 60]
        opportunities = [{"type": "insight", **i} for i in insights if i["insight_type"] == "opportunity"]
        successes = [{"type": "insight", **i} for i in insights if i["insight_type"] == "trend" and i["impact_score"] < 40]

        return {
            "summary": {"open_alerts": len(alerts), "pending_approvals": pending_approvals,
                        "new_insights": len(insights)},
            "attention": {"urgent": urgent, "needs_review": needs_review[:20],
                          "opportunities": opportunities[:20], "successes": successes[:20]},
            "domains": {"app_health": health, "revenue": revenue, "ai_cost": ai, "growth": growth, "support": support},
            "connectors": {"posthog": "dormant", "sentry": "dormant", "paddle": "dormant",
                           "internal_db": "connected", "ai_usage": "connected", "monitoring": "connected"},
        }

    @r.get("/metrics")
    async def metrics(domain: Optional[str] = None, admin: dict = Depends(require_admin)):
        flt = {"domain": domain} if domain in DOMAINS else {}
        rows = await _db.op_metrics.find(flt, {"_id": 0}).sort("created_at", -1).to_list(300)
        return {"metrics": rows}

    @r.get("/ai-costs")
    async def ai_costs(admin: dict = Depends(require_admin)):
        ai = await collect_ai_costs()
        # 7-day trend from snapshots
        trend = await _db.op_metrics.find({"metric_key": "ai_cost_24h"}, {"_id": 0}).sort("created_at", -1).to_list(30)
        return {"today": ai, "trend": trend,
                "disclaimer": "Costs are internal estimates for planning, not user billing. Individual user costs are never shown in support/public views."}

    @r.get("/insights")
    async def list_insights(status: str = "new", admin: dict = Depends(require_admin)):
        flt = {} if status == "all" else {"status": status}
        rows = await _db.op_insights.find(flt, {"_id": 0}).sort("impact_score", -1).to_list(200)
        return {"insights": rows}

    @r.post("/insights/{iid}/dismiss")
    async def dismiss_insight(iid: str, admin: dict = Depends(require_admin)):
        res = await _db.op_insights.update_one({"id": iid}, {"$set": {"status": "dismissed"}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Insight not found.")
        return {"ok": True}

    @r.get("/alerts")
    async def list_alerts(status: str = "open", admin: dict = Depends(require_admin)):
        flt = {} if status == "all" else {"status": status}
        rows = await _db.op_alerts.find(flt, {"_id": 0}).sort("detected_at", -1).to_list(200)
        return {"alerts": rows}

    @r.post("/alerts/{aid}/{action}")
    async def alert_action(aid: str, action: str, admin: dict = Depends(require_admin)):
        if action not in ("acknowledge", "resolve", "dismiss"):
            raise HTTPException(status_code=400, detail="Invalid action.")
        new_status = {"acknowledge": "acknowledged", "resolve": "resolved", "dismiss": "dismissed"}[action]
        res = await _db.op_alerts.update_one({"id": aid}, {"$set": {"status": new_status, "updated_at": _now()}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Alert not found.")
        return {"ok": True, "status": new_status}

    @r.get("/recommendations")
    async def list_recs(status: Optional[str] = None, admin: dict = Depends(require_admin)):
        flt = {"status": status} if status else {}
        rows = await _db.op_recommendations.find(flt, {"_id": 0}).sort("created_at", -1).to_list(200)
        return {"recommendations": rows}

    @r.get("/approvals")
    async def list_approvals(admin: dict = Depends(require_admin)):
        appr = await _db.op_approvals.find({"decision": "pending"}, {"_id": 0}).sort("created_at", -1).to_list(200)
        out = []
        for a in appr:
            rec = await _db.op_recommendations.find_one({"id": a["recommendation_id"]}, {"_id": 0})
            out.append({**a, "recommendation": rec})
        return {"approvals": out}

    @r.post("/approvals/{aid}/decide")
    async def decide_approval(aid: str, req: DecisionReq, admin: dict = Depends(require_admin)):
        if req.decision not in ("approved", "rejected"):
            raise HTTPException(status_code=400, detail="Invalid decision.")
        appr = await _db.op_approvals.find_one({"id": aid}, {"_id": 0})
        if not appr or appr["decision"] != "pending":
            raise HTTPException(status_code=404, detail="Pending approval not found.")
        await _db.op_approvals.update_one({"id": aid}, {"$set": {
            "decision": req.decision, "decision_note": req.note, "approver_user_id": admin["id"], "decided_at": _now()}})
        rec_status = "executed" if req.decision == "approved" else "rejected"
        rec_set = {"status": rec_status}
        if req.decision == "approved":
            rec_set["executed_at"] = _now()
        await _db.op_recommendations.update_one({"id": appr["recommendation_id"]}, {"$set": rec_set})
        try:
            await _cap(admin, "approval_decided", {"decision": req.decision})
        except Exception:
            _sentry("approval_execution_failure", aid)
        return {"ok": True, "decision": req.decision,
                "note": "Approved high-impact changes are marked executed here as an operational record; the actual change is applied in its own module (advisory)."}

    @r.get("/settings")
    async def get_settings(admin: dict = Depends(require_admin)):
        return await _settings()

    @r.put("/settings")
    async def put_settings(req: SettingsReq, admin: dict = Depends(require_admin)):
        upd = {k: v for k, v in req.dict().items() if v is not None}
        if upd:
            upd["updated_at"] = _now()
            await _db.op_settings.update_one({"id": "singleton"}, {"$set": upd}, upsert=True)
        return await _settings()

    # ---- experiments (PostHog-aligned; declare winners with guardrails, not click-through alone)
    @r.get("/experiments")
    async def list_experiments(admin: dict = Depends(require_admin)):
        rows = await _db.op_experiments.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
        return {"experiments": rows}

    @r.post("/experiments")
    async def create_experiment(req: ExperimentReq, admin: dict = Depends(require_admin)):
        doc = {"id": _nid(), "hypothesis": req.hypothesis, "target_segment": req.target_segment,
               "feature_flag_reference": req.feature_flag_reference, "primary_metric": req.primary_metric,
               "guardrail_metric": req.guardrail_metric or "error_rate + project_completion + subscription_conversion",
               "requires_approval": req.requires_approval, "decision_status": "draft" if req.requires_approval else "running",
               "start_date": _now(), "end_date": None, "created_at": _now()}
        await _db.op_experiments.insert_one(dict(doc)); doc.pop("_id", None)
        await _cap(admin, "experiment_started", {"segment": req.target_segment})
        return {"experiment": doc}

    @r.post("/experiments/{eid}/decision")
    async def experiment_decision(eid: str, req: ExperimentDecisionReq, admin: dict = Depends(require_admin)):
        if req.decision_status not in ("running", "winner", "no_change", "stopped"):
            raise HTTPException(status_code=400, detail="Invalid decision status.")
        upd = {"decision_status": req.decision_status}
        if req.decision_status in ("winner", "no_change", "stopped"):
            upd["end_date"] = _now()
            await _cap(admin, "experiment_completed", {"result": req.decision_status})
        res = await _db.op_experiments.update_one({"id": eid}, {"$set": upd})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Experiment not found.")
        return {"ok": True, "decision_status": req.decision_status}

    return r


# ============================================================= seed / startup
async def seed_hq():
    if _db is None:
        return
    try:
        await _settings()
        await _db.ai_usage_records.create_index([("created_at", -1)])
        await _db.op_metrics.create_index([("created_at", -1)])
        await _db.op_alerts.create_index([("status", 1)])
        if _logger:
            _logger.info("homie hq (B25) seeded")
    except Exception as e:
        if _logger:
            _logger.error(f"homie hq seed failed: {e}")
