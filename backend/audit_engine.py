"""
DIYhomie Activity, API & Consent Audit / Transparency Engine (Info Sheet #59).

Kept in a separate module to keep server.py lean. Provides:
  - Automatic HTTP audit logging middleware (mutations, logins, exports).
  - Explicit log_event() helper other modules can call.
  - Risk detection + admin alerting (rapid delete / bulk export / api-key share).
  - Consent & data-usage registry (GDPR/CCPA).
  - User transparency router (own history + export + consent management).
  - Admin audit router (query/slice/search + analytics + alerts).
"""
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, Callable

import jwt
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

_db = None
_logger = None
_jwt_secret = None
_jwt_algo = "HS256"


def configure(db, logger, jwt_secret: str, jwt_algo: str = "HS256"):
    global _db, _logger, _jwt_secret, _jwt_algo
    _db = db
    _logger = logger
    _jwt_secret = jwt_secret
    _jwt_algo = jwt_algo


def _now():
    return datetime.now(timezone.utc).isoformat()


def _new_id():
    return str(uuid.uuid4())


# --------------------------------------------------------------- categorisation
def _categorize(path: str) -> str:
    p = path.lower()
    checks = [
        ("/auth", "auth"),
        ("/billing", "billing"), ("/subscription", "billing"), ("/checkout", "billing"),
        ("/stripe", "billing"), ("/webhook", "webhook"),
        ("/admin", "admin"),
        ("/developer", "api"), ("/api/v1", "api"),
        ("/projects", "project"), ("/demo", "project"), ("/kits", "project"),
        ("/community", "community"), ("/neighborhood", "community"),
        ("/pro", "pro"), ("/expert", "expert"), ("/knowledge", "expert"),
        ("/portability", "data_rights"), ("/data", "data_rights"), ("/consents", "consent"),
        ("/freemium", "freemium"), ("/entitlements", "freemium"),
        ("/emergency", "emergency"), ("/notifications", "notification"),
    ]
    for frag, cat in checks:
        if frag in p:
            return cat
    return "general"


# paths we never log (avoid noise / recursion)
_SKIP_FRAGMENTS = (
    "/api/admin/audit", "/api/audit", "/api/conversion/event",
    "/api/entitlements/me", "/api/notifications", "/api/health",
)
_LOG_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _risk_for(method: str, path: str) -> tuple:
    """Return (risk_level, event_label) — high/medium/low."""
    p = path.lower()
    if "/developer/keys" in p and method == "POST":
        return "medium", "api_key_created"
    if "/portability/export" in p or ("/data" in p and "export" in p):
        return "medium", "data_export"
    if "/portability/delete-request" in p or ("/delete" in p and method in ("POST", "DELETE")):
        return "high", "data_deletion"
    if "/portability/import" in p or "/portability/transfer" in p:
        return "medium", "data_transfer"
    if "/admin/" in p and method in _LOG_METHODS:
        return "medium", "admin_change"
    if method == "DELETE":
        return "medium", "resource_delete"
    return "low", f"{method.lower()}_action"


# --------------------------------------------------------------- core logging
async def log_event(actor_type: str, actor_id: Optional[str], event: str, category: str,
                    actor_email: Optional[str] = None, method: str = "", path: str = "",
                    status_code: Optional[int] = None, target_type: Optional[str] = None,
                    target_id: Optional[str] = None, old_value=None, new_value=None,
                    ip: Optional[str] = None, risk_level: str = "low", meta: Optional[dict] = None):
    doc = {
        "id": _new_id(), "at": _now(),
        "actor_type": actor_type, "actor_id": actor_id, "actor_email": actor_email,
        "event": event, "category": category, "method": method, "path": path,
        "status_code": status_code, "target_type": target_type, "target_id": target_id,
        "old_value": old_value, "new_value": new_value, "ip": ip,
        "risk_level": risk_level, "meta": meta or {},
    }
    try:
        await _db.audit_events.insert_one(doc)
    except Exception as e:  # never break the request over logging
        if _logger:
            _logger.warning(f"audit log_event failed: {e}")
        return
    if risk_level == "high" or event in ("api_key_created", "data_export", "data_deletion"):
        await _maybe_alert(doc)
    await _detect_rapid(doc)


async def _maybe_alert(evt: dict, kind: str = None, detail: str = None):
    alert = {
        "id": _new_id(), "at": evt["at"], "status": "open",
        "kind": kind or evt["event"], "risk_level": evt.get("risk_level", "high"),
        "actor_type": evt.get("actor_type"), "actor_id": evt.get("actor_id"),
        "actor_email": evt.get("actor_email"), "category": evt.get("category"),
        "event_id": evt["id"], "path": evt.get("path"),
        "detail": detail or f"{evt['event']} on {evt.get('path','')}",
        "resolved_at": None, "resolved_by": None, "note": None,
    }
    try:
        await _db.audit_alerts.insert_one(alert)
    except Exception:
        pass


async def _detect_rapid(evt: dict):
    """Flag rapid bulk deletes / exports by the same actor in a short window."""
    if not evt.get("actor_id"):
        return
    if evt["event"] not in ("resource_delete", "data_deletion", "data_export"):
        return
    since = (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat()
    try:
        count = await _db.audit_events.count_documents({
            "actor_id": evt["actor_id"], "event": evt["event"], "at": {"$gte": since},
        })
    except Exception:
        return
    threshold = 8 if evt["event"] == "resource_delete" else 5
    if count >= threshold:
        existing = await _db.audit_alerts.find_one({
            "actor_id": evt["actor_id"], "kind": f"rapid_{evt['event']}", "status": "open",
        })
        if not existing:
            await _maybe_alert(evt, kind=f"rapid_{evt['event']}",
                               detail=f"{count} '{evt['event']}' actions in 60s by {evt.get('actor_email') or evt['actor_id']}")


# --------------------------------------------------------------- middleware
def _resolve_actor(request: Request) -> tuple:
    """Best-effort actor resolution from headers. Returns (actor_type, actor_id)."""
    api_key = request.headers.get("X-API-Key")
    if api_key:
        return "partner", api_key[:12] + "…"
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        try:
            payload = jwt.decode(auth.split(" ", 1)[1], _jwt_secret, algorithms=[_jwt_algo])
            return "user", payload.get("sub")
        except Exception:
            return "anonymous", None
    return "anonymous", None


async def audit_middleware(request: Request, call_next):
    response = await call_next(request)
    try:
        method = request.method
        path = request.url.path
        is_login = path.endswith("/auth/login") or path.endswith("/auth/register")
        if not path.startswith("/api"):
            return response
        if any(f in path for f in _SKIP_FRAGMENTS):
            return response
        if method not in _LOG_METHODS and not is_login:
            return response

        actor_type, actor_id = _resolve_actor(request)
        category = "auth" if is_login else _categorize(path)
        if is_login:
            risk, event = "low", ("login" if "login" in path else "register")
        else:
            risk, event = _risk_for(method, path)

        actor_email = None
        is_admin = "/admin/" in path
        if actor_id and actor_type == "user":
            u = await _db.users.find_one({"id": actor_id}, {"_id": 0, "email": 1, "is_admin": 1})
            if u:
                actor_email = u.get("email")
                if u.get("is_admin"):
                    actor_type = "admin"
        ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else None)

        await log_event(actor_type, actor_id, event, category, actor_email=actor_email,
                        method=method, path=path, status_code=response.status_code,
                        ip=ip, risk_level=risk)
    except Exception as e:
        if _logger:
            _logger.warning(f"audit middleware error: {e}")
    return response


# --------------------------------------------------------------- consent helper
CONSENT_TYPES = ["marketing", "analytics", "cookies", "data_processing", "personalization"]


async def _consent_state(user_id: str) -> dict:
    rows = await _db.consent_registry.find({"user_id": user_id}, {"_id": 0}).to_list(200)
    latest = {}
    for r in rows:
        t = r["type"]
        if t not in latest or r["at"] > latest[t]["at"]:
            latest[t] = r
    out = {}
    for t in CONSENT_TYPES:
        rec = latest.get(t)
        out[t] = {"status": rec["status"] if rec else "revoked",
                  "scope": rec.get("scope") if rec else None,
                  "updated_at": rec["at"] if rec else None}
    return out


# --------------------------------------------------------------- user router
class ConsentReq(BaseModel):
    type: str
    status: str  # granted | revoked
    scope: Optional[str] = None


def build_user_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api", dependencies=[])

    @r.get("/audit/me")
    async def my_audit(limit: int = 100, skip: int = 0, category: Optional[str] = None,
                       user: dict = Depends(get_current_user)):
        q = {"actor_id": user["id"]}
        if category:
            q["category"] = category
        total = await _db.audit_events.count_documents(q)
        events = await _db.audit_events.find(q, {"_id": 0}).sort("at", -1).skip(skip).limit(min(limit, 200)).to_list(200)
        # data-use summary by category
        pipeline = [{"$match": {"actor_id": user["id"]}},
                    {"$group": {"_id": "$category", "count": {"$sum": 1}}}]
        agg = await _db.audit_events.aggregate(pipeline).to_list(100)
        summary = sorted([{"category": a["_id"], "count": a["count"]} for a in agg],
                         key=lambda x: -x["count"])
        return {"total": total, "events": events, "summary": summary,
                "consents": await _consent_state(user["id"])}

    @r.get("/audit/me/export")
    async def my_audit_export(user: dict = Depends(get_current_user)):
        events = await _db.audit_events.find({"actor_id": user["id"]}, {"_id": 0}).sort("at", -1).to_list(20000)
        await log_event("user", user["id"], "data_export", "data_rights",
                        actor_email=user.get("email"), risk_level="medium",
                        meta={"kind": "audit_trail", "records": len(events)})
        return {"exported_at": _now(), "user_id": user["id"], "email": user.get("email"),
                "consents": await _consent_state(user["id"]), "event_count": len(events),
                "events": events}

    @r.get("/consents")
    async def get_consents(user: dict = Depends(get_current_user)):
        return {"types": CONSENT_TYPES, "consents": await _consent_state(user["id"])}

    @r.post("/consents")
    async def set_consent(req: ConsentReq, user: dict = Depends(get_current_user)):
        if req.type not in CONSENT_TYPES or req.status not in ("granted", "revoked"):
            from fastapi import HTTPException
            raise HTTPException(status_code=400, detail="Invalid consent type or status")
        prev = await _consent_state(user["id"])
        await _db.consent_registry.insert_one({
            "id": _new_id(), "user_id": user["id"], "type": req.type,
            "status": req.status, "scope": req.scope, "at": _now(),
        })
        await log_event("user", user["id"], "consent_change", "consent",
                        actor_email=user.get("email"),
                        old_value=prev.get(req.type, {}).get("status"),
                        new_value=req.status, meta={"type": req.type, "scope": req.scope})
        return {"ok": True, "consents": await _consent_state(user["id"])}

    return r


# --------------------------------------------------------------- admin router
class ResolveAlertReq(BaseModel):
    note: Optional[str] = None


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/admin/audit", dependencies=[Depends(require_admin)])

    @r.get("")
    async def query_audit(q: Optional[str] = None, category: Optional[str] = None,
                          event: Optional[str] = None, actor_type: Optional[str] = None,
                          actor_id: Optional[str] = None, actor_email: Optional[str] = None,
                          risk: Optional[str] = None, date_from: Optional[str] = None,
                          date_to: Optional[str] = None, limit: int = 100, skip: int = 0):
        flt = {}
        if category:
            flt["category"] = category
        if event:
            flt["event"] = event
        if actor_type:
            flt["actor_type"] = actor_type
        if actor_id:
            flt["actor_id"] = actor_id
        if actor_email:
            flt["actor_email"] = {"$regex": actor_email, "$options": "i"}
        if risk:
            flt["risk_level"] = risk
        if date_from or date_to:
            rng = {}
            if date_from:
                rng["$gte"] = date_from
            if date_to:
                rng["$lte"] = date_to
            flt["at"] = rng
        if q:
            flt["$or"] = [
                {"path": {"$regex": q, "$options": "i"}},
                {"actor_email": {"$regex": q, "$options": "i"}},
                {"event": {"$regex": q, "$options": "i"}},
            ]
        total = await _db.audit_events.count_documents(flt)
        events = await _db.audit_events.find(flt, {"_id": 0}).sort("at", -1).skip(skip).limit(min(limit, 500)).to_list(500)
        return {"total": total, "events": events}

    @r.get("/analytics")
    async def analytics():
        total = await _db.audit_events.count_documents({})
        async def group(field):
            agg = await _db.audit_events.aggregate(
                [{"$group": {"_id": f"${field}", "count": {"$sum": 1}}},
                 {"$sort": {"count": -1}}]).to_list(100)
            return [{"key": a["_id"], "count": a["count"]} for a in agg]
        by_category = await group("category")
        by_risk = await group("risk_level")
        by_actor_type = await group("actor_type")
        top_actors_agg = await _db.audit_events.aggregate(
            [{"$match": {"actor_id": {"$ne": None}}},
             {"$group": {"_id": {"id": "$actor_id", "email": "$actor_email"}, "count": {"$sum": 1}}},
             {"$sort": {"count": -1}}, {"$limit": 10}]).to_list(10)
        top_actors = [{"actor_id": a["_id"]["id"], "actor_email": a["_id"].get("email"),
                       "count": a["count"]} for a in top_actors_agg]
        open_alerts = await _db.audit_alerts.count_documents({"status": "open"})
        return {"total_events": total, "by_category": by_category, "by_risk": by_risk,
                "by_actor_type": by_actor_type, "top_actors": top_actors,
                "open_alerts": open_alerts}

    @r.get("/alerts")
    async def alerts(status: str = "open", limit: int = 100):
        flt = {} if status == "all" else {"status": status}
        rows = await _db.audit_alerts.find(flt, {"_id": 0}).sort("at", -1).limit(min(limit, 200)).to_list(200)
        return {"alerts": rows, "open_count": await _db.audit_alerts.count_documents({"status": "open"})}

    @r.post("/alerts/{alert_id}/resolve")
    async def resolve_alert(alert_id: str, req: ResolveAlertReq, admin: dict = Depends(require_admin)):
        from fastapi import HTTPException
        res = await _db.audit_alerts.update_one(
            {"id": alert_id, "status": "open"},
            {"$set": {"status": "resolved", "resolved_at": _now(),
                      "resolved_by": admin.get("email"), "note": req.note}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Alert not found or already resolved")
        return {"ok": True}

    @r.get("/user/{user_id}")
    async def user_trail(user_id: str, limit: int = 200):
        events = await _db.audit_events.find({"actor_id": user_id}, {"_id": 0}).sort("at", -1).limit(min(limit, 500)).to_list(500)
        target = await _db.audit_events.find({"target_id": user_id}, {"_id": 0}).sort("at", -1).limit(100).to_list(100)
        consents = await _consent_state(user_id)
        u = await _db.users.find_one({"id": user_id}, {"_id": 0, "email": 1, "name": 1, "created_at": 1})
        return {"user": u, "as_actor": events, "as_target": target, "consents": consents,
                "total": len(events)}

    return r
