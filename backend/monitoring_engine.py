"""
DIYhomie DevOps, Monitoring & Platform Reliability Engine (Info Sheet #67).

Admin/founder-facing observability. Real, in-app monitoring (no external infra control):
  - Live health check (DB ping + latency, uptime, service status).
  - Automatic error capture via middleware (status >= 400 -> error_events).
  - Live metrics: request volume, error rate, latency, breakdown by status.
  - Incident / bug-report tracker with one-click resolve.
NOTE: true auto-scaling & code rollback require infra/hosting control not available in
this environment; those are surfaced as advisory alerts/thresholds instead.
"""
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Optional, Callable

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

_db = None
_logger = None
_start = time.time()

# in-process live counters (reset on restart, which also resets "uptime")
_stats = {"requests": 0, "errors": 0, "latency_sum": 0.0}
_by_status = {}
_recent_latency = deque(maxlen=200)
ERROR_RATE_ALERT = 5.0  # percent


def configure(db, logger):
    global _db, _logger, _start
    _db = db
    _logger = logger
    _start = time.time()


def _now():
    return datetime.now(timezone.utc).isoformat()


def _new_id():
    return str(uuid.uuid4())


async def monitoring_middleware(request: Request, call_next):
    t0 = time.perf_counter()
    response = await call_next(request)
    try:
        path = request.url.path
        if not path.startswith("/api") or "/admin/monitoring" in path:
            return response
        dt = (time.perf_counter() - t0) * 1000.0
        _stats["requests"] += 1
        _stats["latency_sum"] += dt
        _recent_latency.append(dt)
        bucket = f"{response.status_code // 100}xx"
        _by_status[bucket] = _by_status.get(bucket, 0) + 1
        if response.status_code >= 400:
            _stats["errors"] += 1
            await _db.error_events.insert_one({
                "id": _new_id(), "at": _now(), "method": request.method, "path": path,
                "status": response.status_code, "latency_ms": round(dt, 1),
                "ip": (request.client.host if request.client else None)})
    except Exception as e:
        if _logger:
            _logger.warning(f"monitoring middleware error: {e}")
    return response


# ----------------------------------------------------------- admin router
class IncidentReq(BaseModel):
    title: str
    severity: str = "medium"  # low | medium | high | critical
    detail: Optional[str] = None
    source: str = "ops"


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/admin/monitoring", dependencies=[Depends(require_admin)])

    @r.get("/health")
    async def health():
        db_ok, db_latency = True, None
        try:
            t0 = time.perf_counter()
            await _db.command("ping")
            db_latency = round((time.perf_counter() - t0) * 1000.0, 1)
        except Exception:
            db_ok = False
        uptime_s = int(time.time() - _start)
        reqs = _stats["requests"]
        err_rate = round(_stats["errors"] / reqs * 100, 2) if reqs else 0.0
        services = [
            {"name": "API (backend)", "status": "up"},
            {"name": "Database (MongoDB)", "status": "up" if db_ok else "down", "latency_ms": db_latency},
            {"name": "Web / mobile app", "status": "up"},
        ]
        status = "healthy"
        if not db_ok:
            status = "critical"
        elif err_rate >= ERROR_RATE_ALERT:
            status = "degraded"
        return {"status": status, "uptime_seconds": uptime_s, "db_ok": db_ok, "db_latency_ms": db_latency,
                "error_rate_pct": err_rate, "error_rate_alert": err_rate >= ERROR_RATE_ALERT,
                "services": services, "checked_at": _now()}

    @r.get("/metrics")
    async def metrics():
        reqs = _stats["requests"]
        avg_latency = round(_stats["latency_sum"] / reqs, 1) if reqs else 0.0
        lat = sorted(_recent_latency)
        p95 = round(lat[int(len(lat) * 0.95)], 1) if lat else 0.0
        return {"requests": reqs, "errors": _stats["errors"],
                "error_rate_pct": round(_stats["errors"] / reqs * 100, 2) if reqs else 0.0,
                "avg_latency_ms": avg_latency, "p95_latency_ms": p95,
                "by_status": [{"bucket": k, "count": v} for k, v in sorted(_by_status.items())]}

    @r.get("/errors")
    async def errors(limit: int = 50):
        rows = await _db.error_events.find({}, {"_id": 0}).sort("at", -1).limit(min(limit, 200)).to_list(200)
        agg = await _db.error_events.aggregate(
            [{"$group": {"_id": {"path": "$path", "status": "$status"}, "count": {"$sum": 1}}},
             {"$sort": {"count": -1}}, {"$limit": 10}]).to_list(10)
        top = [{"path": a["_id"]["path"], "status": a["_id"]["status"], "count": a["count"]} for a in agg]
        return {"recent": rows, "top_failing": top, "total": await _db.error_events.count_documents({})}

    @r.post("/incidents")
    async def create_incident(req: IncidentReq, admin: dict = Depends(require_admin)):
        doc = {"id": _new_id(), "at": _now(), "title": req.title, "severity": req.severity,
               "detail": req.detail, "source": req.source, "status": "open",
               "created_by": admin.get("email"), "resolved_at": None}
        await _db.incidents.insert_one(doc)
        return {"ok": True, "id": doc["id"]}

    @r.get("/incidents")
    async def list_incidents(status: str = "open", limit: int = 100):
        flt = {} if status == "all" else {"status": status}
        rows = await _db.incidents.find(flt, {"_id": 0}).sort("at", -1).limit(min(limit, 200)).to_list(200)
        return {"incidents": rows, "open_count": await _db.incidents.count_documents({"status": "open"})}

    @r.post("/incidents/{incident_id}/resolve")
    async def resolve_incident(incident_id: str, admin: dict = Depends(require_admin)):
        res = await _db.incidents.update_one({"id": incident_id, "status": "open"},
                                             {"$set": {"status": "resolved", "resolved_at": _now(),
                                                       "resolved_by": admin.get("email")}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Open incident not found")
        return {"ok": True}

    return r
