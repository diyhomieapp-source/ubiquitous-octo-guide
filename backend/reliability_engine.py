"""
Build Doc 34 — Platform Reliability, Performance & Scalability Engine (MVP deltas).

Extends what already exists (monitoring_engine admin health/metrics/errors, sync_engine
offline-first + conflicts, homie_hq ai_usage_records cost tracking, subscription entitlements).

Adds:
- Async job framework (rl_jobs): queued/running/waiting_provider/completed/failed/retrying/
  canceled with progress + friendly messages. run_job() wraps long work in a background task
  with one automatic retry. Used by Design Studio concept generation.
- AI cost protection: per-user daily AI-call cap + admin emergency kill switch (rl_settings,
  rl_ai_calls). Never applied to deterministic safety triage.
- User-facing system status (/api/hi/system/status): reliability tiers with degraded labels
  derived from recent error_events + ai_usage_records failures.
- Admin: /api/hi/admin/reliability (jobs overview, limits, AI cost breakdown).
"""
import asyncio
import uuid
from datetime import datetime, timezone, timedelta
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

JOB_STATUSES = ("queued", "running", "waiting_provider", "completed", "failed", "retrying", "canceled")
JOB_MESSAGES = {
    "design_concept": "Homie is designing your concept. This usually takes under a minute.",
    "design_refine": "Homie is refining your concept. This usually takes under a minute.",
    "export": "Preparing your export.",
    "scan_analysis": "Homie is analyzing your photos. This usually takes less than a minute.",
}
_DEFAULT_LIMITS = {"ai_daily_per_user": 300, "ai_kill_switch": False}

# Service reliability tiers surfaced to users (Doc 34).
_SERVICES = [
    {"key": "auth", "label": "Sign-in & security", "tier": 1, "systems": ["auth"]},
    {"key": "projects", "label": "Projects & home records", "tier": 1, "systems": ["repair", "start", "planner", "record", "account"]},
    {"key": "payments", "label": "Payments & subscriptions", "tier": 1, "systems": ["billing", "subscription"]},
    {"key": "homie_ai", "label": "Homie AI guidance", "tier": 2, "systems": ["chat", "conversations", "design-studio"]},
    {"key": "documents", "label": "Documents & photos", "tier": 2, "systems": ["documents", "vault"]},
    {"key": "community", "label": "Community & discovery", "tier": 3, "systems": ["community", "blog"]},
]


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


def _now():
    return datetime.now(timezone.utc)


def _iso(dt=None):
    return (dt or _now()).isoformat()


def _nid():
    return str(uuid.uuid4())


# ================================================================ async jobs
async def create_job(user_id: str, job_type: str, resource_id: Optional[str] = None,
                     priority: str = "normal") -> dict:
    job = {"id": _nid(), "job_type": job_type, "priority": priority, "user_id": user_id,
           "resource_id": resource_id, "status": "queued", "progress": 0,
           "message": JOB_MESSAGES.get(job_type, "Working on it…"), "retry_count": 0,
           "error": None, "result": None,
           "created_at": _iso(), "updated_at": _iso(), "completed_at": None}
    await _db.rl_jobs.insert_one(dict(job)); job.pop("_id", None)
    return job


async def update_job(job_id: str, **fields):
    fields["updated_at"] = _iso()
    await _db.rl_jobs.update_one({"id": job_id}, {"$set": fields})


def run_job(job_id: str, work: Callable, on_fail_message: str = "That didn't finish. Your data is safe — try again in a moment."):
    """Run `work(progress)` in the background with ONE automatic retry.
    `work` receives an async progress(pct, message, status=...) callback and returns a result dict."""
    async def _progress(pct: int, message: Optional[str] = None, status: str = "running"):
        upd = {"progress": max(0, min(100, int(pct))), "status": status}
        if message:
            upd["message"] = message
        await update_job(job_id, **upd)

    async def _runner():
        for attempt in (0, 1):
            job = await _db.rl_jobs.find_one({"id": job_id}, {"_id": 0, "status": 1})
            if job and job["status"] == "canceled":
                return
            try:
                await update_job(job_id, status="running", retry_count=attempt)
                result = await work(_progress)
                await update_job(job_id, status="completed", progress=100, result=result,
                                 message="Done.", completed_at=_iso())
                return
            except Exception as e:  # noqa: BLE001
                if _logger:
                    _logger.warning(f"job {job_id} attempt {attempt} failed: {e}")
                if attempt == 0:
                    await update_job(job_id, status="retrying", message="Taking longer than usual — retrying…")
                    await asyncio.sleep(2)
                else:
                    await update_job(job_id, status="failed", error=str(e)[:300],
                                     message=on_fail_message, completed_at=_iso())

    asyncio.get_event_loop().create_task(_runner())


# ================================================================ AI cost protection
async def _limits() -> dict:
    s = await _db.rl_settings.find_one({"key": "limits"}, {"_id": 0})
    return {**_DEFAULT_LIMITS, **(s or {})}


async def enforce_ai_budget(user_id: str, feature: str = "general"):
    """Per-user daily AI-call guard + admin emergency kill switch.
    NEVER used for safety triage (which is deterministic and always available)."""
    lim = await _limits()
    if lim.get("ai_kill_switch"):
        raise HTTPException(status_code=503, detail=(
            "AI features are briefly paused for maintenance. Your saved projects, plans and safety "
            "guidance are still available."))
    day = _now().strftime("%Y-%m-%d")
    doc = await _db.rl_ai_calls.find_one_and_update(
        {"user_id": user_id, "day": day},
        {"$inc": {"count": 1}, "$setOnInsert": {"id": _nid(), "created_at": _iso()}},
        upsert=True, return_document=True)
    if (doc or {}).get("count", 0) > int(lim.get("ai_daily_per_user", 300)):
        raise HTTPException(status_code=429, detail=(
            "You've reached today's AI usage limit. You can keep working with your saved plans, "
            "checklists and guides — AI features reset tomorrow."))


# ================================================================ system status
async def _system_status() -> dict:
    since = _iso(_now() - timedelta(minutes=15))
    # recent server-side failures (5xx) grouped by path prefix — expected 4xx are not outages
    errs = await _db.error_events.find({"at": {"$gte": since}, "status": {"$gte": 500}},
                                       {"_id": 0, "path": 1}).to_list(500)
    err_paths = [e.get("path") or "" for e in errs]
    # recent AI provider failures
    ai_recent = await _db.ai_usage_records.find({"created_at": {"$gte": since}},
                                                {"_id": 0, "status": 1}).to_list(500)
    ai_total = len(ai_recent)
    ai_errors = sum(1 for a in ai_recent if a.get("status") != "ok")
    services = []
    degraded_any = False
    for svc in _SERVICES:
        hits = sum(1 for p in err_paths if any(f"/{s}" in p for s in svc["systems"]))
        status = "ok"
        note = None
        if svc["key"] == "homie_ai" and ai_total >= 3 and ai_errors / ai_total > 0.5:
            status, note = "degraded", "AI responses may be slow — your saved plans and guides still work."
        elif hits >= 5:
            status = "degraded"
            note = ("Core features are recovering — recent changes are safe." if svc["tier"] == 1
                    else "This area may be slow. Your projects and safety guidance are unaffected.")
        if status != "ok":
            degraded_any = True
        services.append({**{k: svc[k] for k in ("key", "label", "tier")}, "status": status, "note": note})
    return {"overall": "degraded" if degraded_any else "ok", "services": services,
            "checked_at": _iso(),
            "message": next((s["note"] for s in services if s["status"] != "ok"), None)}


class LimitsReq(BaseModel):
    ai_daily_per_user: Optional[int] = None
    ai_kill_switch: Optional[bool] = None


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi", tags=["reliability"])

    @r.get("/jobs")
    async def list_jobs(user: dict = Depends(get_current_user)):
        rows = await _db.rl_jobs.find({"user_id": user["id"]}, {"_id": 0, "result": 0}) \
            .sort("created_at", -1).to_list(20)
        return {"jobs": rows, "active": sum(1 for j in rows if j["status"] in ("queued", "running", "waiting_provider", "retrying"))}

    @r.get("/jobs/{jid}")
    async def get_job(jid: str, user: dict = Depends(get_current_user)):
        job = await _db.rl_jobs.find_one({"id": jid, "user_id": user["id"]}, {"_id": 0})
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        return job

    @r.post("/jobs/{jid}/cancel")
    async def cancel_job(jid: str, user: dict = Depends(get_current_user)):
        job = await _db.rl_jobs.find_one({"id": jid, "user_id": user["id"]}, {"_id": 0})
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        if job["status"] not in ("queued", "retrying"):
            raise HTTPException(status_code=409, detail="This job is already running or finished.")
        await update_job(jid, status="canceled", message="Canceled.", completed_at=_iso())
        return {"ok": True}

    @r.get("/system/status")
    async def system_status(user: dict = Depends(get_current_user)):
        return await _system_status()

    return r


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/reliability", tags=["reliability-admin"])

    @r.get("/jobs")
    async def jobs_overview(admin: dict = Depends(require_admin)):
        by_status: dict = {}
        by_type: dict = {}
        async for j in _db.rl_jobs.find({}, {"_id": 0, "status": 1, "job_type": 1}):
            by_status[j["status"]] = by_status.get(j["status"], 0) + 1
            by_type[j["job_type"]] = by_type.get(j["job_type"], 0) + 1
        failures = await _db.rl_jobs.find({"status": "failed"}, {"_id": 0, "result": 0}) \
            .sort("created_at", -1).to_list(20)
        queue_depth = by_status.get("queued", 0) + by_status.get("retrying", 0)
        return {"queue_depth": queue_depth, "by_status": by_status, "by_type": by_type,
                "recent_failures": failures}

    @r.get("/limits")
    async def get_limits(admin: dict = Depends(require_admin)):
        return await _limits()

    @r.put("/limits")
    async def set_limits(req: LimitsReq, admin: dict = Depends(require_admin)):
        upd = {"updated_at": _iso()}
        if req.ai_daily_per_user is not None:
            upd["ai_daily_per_user"] = max(1, int(req.ai_daily_per_user))
        if req.ai_kill_switch is not None:
            upd["ai_kill_switch"] = bool(req.ai_kill_switch)
        await _db.rl_settings.update_one({"key": "limits"}, {"$set": upd}, upsert=True)
        return await _limits()

    @r.get("/costs")
    async def ai_costs(admin: dict = Depends(require_admin), days: int = 7):
        since = _iso(_now() - timedelta(days=max(1, min(days, 30))))
        by_feature: dict = {}
        by_provider: dict = {}
        total = {"calls": 0, "errors": 0, "estimated_cost": 0.0}
        async for rec in _db.ai_usage_records.find({"created_at": {"$gte": since}},
                                                   {"_id": 0, "feature_area": 1, "provider_reference": 1,
                                                    "estimated_cost": 1, "status": 1, "latency_ms": 1}):
            cost = float(rec.get("estimated_cost") or 0)
            err = 1 if rec.get("status") != "ok" else 0
            for bucket, key in ((by_feature, rec.get("feature_area") or "general"),
                                (by_provider, rec.get("provider_reference") or "unknown")):
                b = bucket.setdefault(key, {"calls": 0, "errors": 0, "estimated_cost": 0.0})
                b["calls"] += 1; b["errors"] += err; b["estimated_cost"] = round(b["estimated_cost"] + cost, 4)
            total["calls"] += 1; total["errors"] += err
            total["estimated_cost"] = round(total["estimated_cost"] + cost, 4)
        return {"since": since, "total": total, "by_feature": by_feature, "by_provider": by_provider}

    return r
