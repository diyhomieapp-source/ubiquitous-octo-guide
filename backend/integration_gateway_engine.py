"""
DIYhomie — Integration Gateway, Secrets Vault & Automation Control Plane (Build Blueprint 18).

ONE secure integration layer for every external service. Product features NEVER call
third-party APIs directly with raw keys — they go through the gateway, which resolves a
*vault reference* (a pointer to an environment secret), never the raw secret itself.

Guarantees:
- No raw secret / password / token is ever stored in product data or returned to any client.
- The vault stores only references (env:VAR_NAME). Admin UI shows status only, never values.
- Webhooks are signature-verified + idempotent (dedupe by provider_event_id).
- Workflow jobs have a full state machine with retries/backoff + dead-letter.
- Browser-automation sessions are approval-gated + audited.
- Health monitoring is sanitized — no credentials leak into logs/analytics.

Collections: ig_connectors, ig_credential_refs, ig_oauth_connections, ig_webhook_subscriptions,
ig_webhook_receipts, ig_jobs, ig_health_events, ig_browser_sessions.
"""
import hashlib
import hmac
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from pydantic import BaseModel

_db = None
_logger = None

# ------------------------------------------------------------- constants
CONNECTION_TYPES = ["api_key", "oauth", "webhook", "workflow", "browser_automation", "manual"]
CONNECTOR_STATUS = ["active", "disabled", "maintenance", "deprecated"]
CRED_STATUS = ["active", "expired", "revoked", "invalid"]
JOB_STATUS = ["queued", "running", "succeeded", "failed_retryable", "retrying",
              "failed_final", "cancelled", "awaiting_approval", "dead_letter"]
AUTOMATION_LEVELS = {0: "observe", 1: "recommend", 2: "prepare", 3: "approval_required", 4: "automated"}

# Sensitive workflow types that always need explicit admin approval (Level 3).
APPROVAL_REQUIRED_ACTIONS = {
    "publish_content_external", "change_financial_settings", "change_billing_config",
    "connect_production_service", "disconnect_production_service", "browser_account_change",
    "delete_external_data", "send_bulk_communication", "change_partner_config",
}

# Max retry attempts before dead-letter, by connection type.
MAX_ATTEMPTS = {"workflow": 5, "webhook": 3, "api_key": 3, "oauth": 3, "browser_automation": 2, "manual": 1}

# Non-secret connector registry seed. `vault_refs` point at env vars (never the value).
SEED_CONNECTORS = [
    {"connector_key": "emergent_llm", "name": "Emergent LLM (AI)", "category": "ai_provider",
     "connection_type": "api_key", "data_classification": "confidential", "automation_level": 4,
     "vault_refs": [{"credential_type": "api_key", "vault_reference": "env:EMERGENT_LLM_KEY"}],
     "description": "AI text/vision/image generation via the Emergent universal key."},
    {"connector_key": "stripe", "name": "Stripe (Payments)", "category": "billing",
     "connection_type": "api_key", "data_classification": "restricted", "automation_level": 3,
     "vault_refs": [{"credential_type": "secret_key", "vault_reference": "env:STRIPE_SECRET_KEY"},
                    {"credential_type": "webhook_secret", "vault_reference": "env:STRIPE_WEBHOOK_SECRET"}],
     "webhook": {"event_type": "payment_events", "signature_verification_required": True,
                 "signing_secret_ref": "env:STRIPE_WEBHOOK_SECRET"},
     "description": "Subscription billing, checkout, customer portal and payment webhooks."},
    {"connector_key": "posthog", "name": "PostHog (Analytics)", "category": "analytics",
     "connection_type": "api_key", "data_classification": "internal", "automation_level": 4,
     "vault_refs": [{"credential_type": "project_token", "vault_reference": "env:POSTHOG_PROJECT_TOKEN"}],
     "description": "Privacy-safe product analytics events."},
    {"connector_key": "sentry", "name": "Sentry (Error Monitoring)", "category": "monitoring",
     "connection_type": "api_key", "data_classification": "internal", "automation_level": 0,
     "vault_refs": [{"credential_type": "dsn", "vault_reference": "env:SENTRY_BACKEND_DSN"}],
     "description": "Backend error + performance monitoring."},
    {"connector_key": "firebase_push", "name": "Firebase / Push", "category": "notifications",
     "connection_type": "api_key", "data_classification": "internal", "automation_level": 4,
     "vault_refs": [{"credential_type": "relay_key", "vault_reference": "env:EMERGENT_PUSH_KEY"}],
     "description": "Emergent-managed push notification relay (native build only)."},
    {"connector_key": "decor8", "name": "Decor8 AI (Visualizer)", "category": "image_generation",
     "connection_type": "api_key", "data_classification": "confidential", "automation_level": 4,
     "vault_refs": [{"credential_type": "api_key", "vault_reference": "env:DECOR8_API_KEY"}],
     "description": "Paint / finish room visualization."},
    {"connector_key": "perplexity", "name": "Perplexity (Code Check)", "category": "ai_provider",
     "connection_type": "api_key", "data_classification": "confidential", "automation_level": 4,
     "vault_refs": [{"credential_type": "api_key", "vault_reference": "env:PERPLEXITY_API_KEY"}],
     "description": "Live web-search local building code lookups."},
    {"connector_key": "aws_ses", "name": "Amazon SES (Email)", "category": "email",
     "connection_type": "api_key", "data_classification": "restricted", "automation_level": 3,
     "vault_refs": [{"credential_type": "access_key_id", "vault_reference": "env:AWS_ACCESS_KEY_ID"},
                    {"credential_type": "secret_access_key", "vault_reference": "env:AWS_SECRET_ACCESS_KEY"}],
     "description": "Transactional + marketing email delivery."},
    {"connector_key": "weatherapi", "name": "WeatherAPI.com", "category": "data_provider",
     "connection_type": "api_key", "data_classification": "public", "automation_level": 4,
     "vault_refs": [{"credential_type": "api_key", "vault_reference": "env:WEATHER_API_KEY"}],
     "description": "Weather-aware guide generation."},
    # --- dormant future connectors (framework ready, activate when keys added) ---
    {"connector_key": "pipedream", "name": "Pipedream (Workflows)", "category": "automation",
     "connection_type": "workflow", "data_classification": "confidential", "automation_level": 2,
     "vault_refs": [{"credential_type": "api_key", "vault_reference": "env:PIPEDREAM_API_KEY"}],
     "description": "Async background workflow execution layer (non-authoritative)."},
    {"connector_key": "browserbase", "name": "Browserbase (Admin Browser)", "category": "browser_automation",
     "connection_type": "browser_automation", "data_classification": "restricted", "automation_level": 3,
     "vault_refs": [{"credential_type": "api_key", "vault_reference": "env:BROWSERBASE_API_KEY"},
                    {"credential_type": "project_id", "vault_reference": "env:BROWSERBASE_PROJECT_ID"}],
     "description": "Approval-gated, audited admin browser automation sessions."},
]


def _now():
    return datetime.now(timezone.utc)


def _now_iso():
    return _now().isoformat()


def _nid():
    return str(uuid.uuid4())


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


async def _cap(user, event, props=None):
    """Fire a privacy-safe analytics event (silently ignored if unregistered)."""
    try:
        import analytics_engine
        await analytics_engine.capture(user, event, props or {})
    except Exception:
        pass


def _sentry(event_type: str, connector_key: str, message: str):
    """Report a sanitized integration failure to Sentry (never includes secrets)."""
    try:
        import sentry_sdk
        sentry_sdk.capture_message(f"[integration:{event_type}] {connector_key}: {message}", level="error")
    except Exception:
        pass


# ------------------------------------------------------------- secrets vault
def _vault_var(vault_reference: str) -> str:
    """Extract the env var name from a vault reference like 'env:STRIPE_SECRET_KEY'."""
    return vault_reference.split(":", 1)[1] if ":" in vault_reference else vault_reference


def _secret_present(vault_reference: str) -> bool:
    """True if the referenced secret is configured. NEVER returns the value."""
    val = (os.environ.get(_vault_var(vault_reference)) or "").strip()
    return bool(val) and val.lower() != "placeholder"


def _mask_ref(vault_reference: str) -> str:
    """A safe display label for a vault reference — reveals the pointer, never the value."""
    return f"vault://{_vault_var(vault_reference)}"


# ------------------------------------------------------------- seeding
async def seed_connectors():
    """Idempotently register the approved connectors + their credential references."""
    if _db is None:
        return
    try:
        for c in SEED_CONNECTORS:
            existing = await _db.ig_connectors.find_one({"connector_key": c["connector_key"]})
            if existing:
                cid = existing["id"]
                await _db.ig_connectors.update_one({"id": cid}, {"$set": {
                    "name": c["name"], "category": c["category"], "description": c["description"],
                    "connection_type": c["connection_type"], "data_classification": c["data_classification"],
                    "automation_level": c.get("automation_level", 0), "updated_at": _now_iso()}})
            else:
                cid = _nid()
                await _db.ig_connectors.insert_one({
                    "id": cid, "connector_key": c["connector_key"], "name": c["name"],
                    "category": c["category"], "description": c["description"],
                    "connection_type": c["connection_type"], "status": "active",
                    "owner_team": "platform", "data_classification": c["data_classification"],
                    "automation_level": c.get("automation_level", 0),
                    "created_at": _now_iso(), "updated_at": _now_iso()})
            # credential references (metadata only)
            for ref in c.get("vault_refs", []):
                q = {"connector_id": cid, "environment": "production", "vault_reference": ref["vault_reference"]}
                if not await _db.ig_credential_refs.find_one(q):
                    await _db.ig_credential_refs.insert_one({
                        "id": _nid(), "connector_id": cid, "environment": "production",
                        "vault_reference": ref["vault_reference"], "credential_type": ref["credential_type"],
                        "status": "active", "expires_at": None, "rotation_due_at": None,
                        "last_rotated_at": None, "last_checked_at": None,
                        "created_at": _now_iso(), "updated_at": _now_iso()})
            # webhook subscription
            wh = c.get("webhook")
            if wh:
                q = {"connector_id": cid, "event_type": wh["event_type"]}
                if not await _db.ig_webhook_subscriptions.find_one(q):
                    await _db.ig_webhook_subscriptions.insert_one({
                        "id": _nid(), "connector_id": cid, "event_type": wh["event_type"],
                        "endpoint_reference": f"/api/integrations/webhooks/{c['connector_key']}",
                        "signature_verification_required": wh["signature_verification_required"],
                        "signing_secret_ref": wh.get("signing_secret_ref"),
                        "status": "active", "created_at": _now_iso()})
    except Exception as e:
        if _logger:
            _logger.error(f"integration seed failed: {e}")


# ------------------------------------------------------------- health
async def _record_health(connector_id: str, event_type: str, severity: str, message: str,
                         correlation_id: Optional[str] = None, environment: str = "production"):
    await _db.ig_health_events.insert_one({
        "id": _nid(), "connector_id": connector_id, "environment": environment,
        "event_type": event_type, "severity": severity, "sanitized_message": message[:300],
        "correlation_id": correlation_id or _nid(), "created_at": _now_iso()})


async def _health_check(connector: dict) -> dict:
    """Sanitized health check — verifies credential presence + connector state. No network call."""
    cid = connector["id"]
    refs = await _db.ig_credential_refs.find({"connector_id": cid}, {"_id": 0}).to_list(20)
    missing = [r for r in refs if not _secret_present(r["vault_reference"])]
    now = _now_iso()
    if connector["status"] == "disabled":
        status, msg, ev = "disabled", "Connector is disabled.", "success"
    elif not refs:
        status, msg, ev = "healthy", "No credentials required.", "success"
    elif missing:
        status, msg, ev = "dormant", f"{len(missing)} credential(s) not configured — connector is dormant.", "credential_error"
    else:
        status, msg, ev = "healthy", "All credentials configured.", "success"
    # update each credential's status + last_checked
    for r in refs:
        cred_status = "active" if _secret_present(r["vault_reference"]) else "invalid"
        # expiry overrides
        if r.get("expires_at") and r["expires_at"] < now:
            cred_status = "expired"
        await _db.ig_credential_refs.update_one({"id": r["id"]}, {"$set": {
            "status": cred_status, "last_checked_at": now, "updated_at": now}})
    await _db.ig_connectors.update_one({"id": cid}, {"$set": {"health_status": status, "last_checked_at": now}})
    await _record_health(cid, ev, "info" if ev == "success" else "warning", msg)
    if ev != "success":
        _sentry("credential_error", connector["connector_key"], msg)
    return {"health_status": status, "message": msg, "checked_at": now, "credentials_missing": len(missing)}


def _cred_view(r: dict) -> dict:
    """Sanitized credential-reference view for admins — status only, never the value."""
    now = _now_iso()
    display = r["status"]
    if r["status"] == "active" and r.get("expires_at"):
        try:
            soon = (datetime.fromisoformat(r["expires_at"]) - _now()).days <= 14
            display = "expiring_soon" if soon and r["expires_at"] > now else display
        except Exception:
            pass
    return {
        "id": r["id"], "credential_type": r["credential_type"],
        "reference": _mask_ref(r["vault_reference"]),
        "configured": _secret_present(r["vault_reference"]),
        "status": display, "expires_at": r.get("expires_at"),
        "rotation_due_at": r.get("rotation_due_at"), "last_rotated_at": r.get("last_rotated_at"),
        "last_checked_at": r.get("last_checked_at"),
    }


# ------------------------------------------------------------- job engine
async def enqueue_job(connector_key: str, workflow_type: str, initiated_by_type: str = "system",
                      initiated_by_id: Optional[str] = None, idempotency_key: Optional[str] = None,
                      request_meta: Optional[dict] = None) -> dict:
    """Queue an integration job. Never accepts raw secrets in request_meta.
    Sensitive workflow types are parked as awaiting_approval (Level 3)."""
    connector = await _db.ig_connectors.find_one({"connector_key": connector_key}, {"_id": 0})
    if not connector:
        raise HTTPException(status_code=404, detail="Unknown connector.")
    idempotency_key = idempotency_key or _nid()
    existing = await _db.ig_jobs.find_one({"connector_id": connector["id"], "idempotency_key": idempotency_key}, {"_id": 0})
    if existing:
        return existing  # idempotent — no duplicate financial/notification events
    status = "awaiting_approval" if workflow_type in APPROVAL_REQUIRED_ACTIONS else "queued"
    job = {"id": _nid(), "connector_id": connector["id"], "connector_key": connector_key,
           "workflow_type": workflow_type, "initiated_by_type": initiated_by_type,
           "initiated_by_id": initiated_by_id, "idempotency_key": idempotency_key,
           "request_reference": (request_meta or {}).get("ref") or _nid(),
           "status": status, "attempt_count": 0, "max_attempts": MAX_ATTEMPTS.get(connector["connection_type"], 3),
           "next_retry_at": None, "started_at": None, "completed_at": None,
           "sanitized_result": None, "created_at": _now_iso()}
    await _db.ig_jobs.insert_one(dict(job))
    await _cap({"id": initiated_by_id} if initiated_by_id else None, "workflow_triggered",
               {"connector": connector_key, "workflow_type": workflow_type})
    if status == "queued":
        await _run_job(job["id"])
    return await _db.ig_jobs.find_one({"id": job["id"]}, {"_id": 0})


async def _run_job(job_id: str) -> dict:
    """Execute (simulate) a job through the state machine. External dispatch is dormant —
    a configured connector succeeds; an unconfigured one fails + retries → dead_letter."""
    job = await _db.ig_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job or job["status"] in ("succeeded", "failed_final", "cancelled", "dead_letter", "awaiting_approval"):
        return job
    connector = await _db.ig_connectors.find_one({"id": job["connector_id"]}, {"_id": 0})
    attempt = job["attempt_count"] + 1
    await _db.ig_jobs.update_one({"id": job_id}, {"$set": {
        "status": "running", "attempt_count": attempt, "started_at": job.get("started_at") or _now_iso()}})
    refs = await _db.ig_credential_refs.find({"connector_id": connector["id"]}, {"_id": 0}).to_list(20)
    ready = connector["status"] == "active" and all(_secret_present(r["vault_reference"]) for r in refs)
    if ready:
        await _db.ig_jobs.update_one({"id": job_id}, {"$set": {
            "status": "succeeded", "completed_at": _now_iso(),
            "sanitized_result": "Workflow dispatched successfully."}})
        await _record_health(connector["id"], "success", "info", f"job {job['workflow_type']} succeeded", job["request_reference"])
        await _cap(None, "workflow_completed", {"connector": connector["connector_key"]})
    else:
        msg = "Connector dormant — credential not configured." if refs else "Connector unavailable."
        if attempt >= job["max_attempts"]:
            await _db.ig_jobs.update_one({"id": job_id}, {"$set": {
                "status": "dead_letter", "completed_at": _now_iso(), "sanitized_result": msg}})
            await _record_health(connector["id"], "failure", "error", f"job dead-lettered: {msg}", job["request_reference"])
            _sentry("workflow_dead_letter", connector["connector_key"], msg)
            await _cap(None, "workflow_failed", {"connector": connector["connector_key"], "final": True})
        else:
            backoff = min(60, 2 ** attempt)
            await _db.ig_jobs.update_one({"id": job_id}, {"$set": {
                "status": "failed_retryable", "sanitized_result": msg,
                "next_retry_at": (_now() + timedelta(seconds=backoff)).isoformat()}})
            await _record_health(connector["id"], "failure", "warning", f"job retryable ({attempt}/{job['max_attempts']}): {msg}", job["request_reference"])
            await _cap(None, "workflow_failed", {"connector": connector["connector_key"], "final": False})
    return await _db.ig_jobs.find_one({"id": job_id}, {"_id": 0})


# ============================================================= models
class ConnectorReq(BaseModel):
    connector_key: str
    name: str
    category: str = "other"
    description: Optional[str] = None
    connection_type: str = "api_key"
    data_classification: str = "internal"
    automation_level: int = 0


class ConnectorUpdateReq(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    automation_level: Optional[int] = None


class RotateReq(BaseModel):
    credential_reference_id: str
    rotation_due_days: Optional[int] = 90
    reason: Optional[str] = None


class BrowserSessionReq(BaseModel):
    target_platform: str
    purpose: str
    workflow_type: str = "browser_account_change"


# ============================================================= admin router
def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/integrations", dependencies=[Depends(require_admin)])

    async def _connector_or_404(cid: str) -> dict:
        c = await _db.ig_connectors.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Connector not found.")
        return c

    @r.get("/dashboard")
    async def dashboard(admin: dict = Depends(require_admin)):
        connectors = await _db.ig_connectors.find({}, {"_id": 0}).sort("name", 1).to_list(200)
        out = []
        for c in connectors:
            refs = await _db.ig_credential_refs.find({"connector_id": c["id"]}, {"_id": 0}).to_list(20)
            configured = all(_secret_present(x["vault_reference"]) for x in refs) if refs else True
            fails = await _db.ig_health_events.count_documents({"connector_id": c["id"], "event_type": {"$ne": "success"}})
            total = await _db.ig_health_events.count_documents({"connector_id": c["id"]})
            pending = await _db.ig_jobs.count_documents({"connector_id": c["id"], "status": {"$in": ["queued", "running", "failed_retryable", "awaiting_approval"]}})
            failed = await _db.ig_jobs.count_documents({"connector_id": c["id"], "status": {"$in": ["failed_final", "dead_letter"]}})
            last_wh = await _db.ig_webhook_receipts.find_one({"connector_id": c["id"]}, {"_id": 0}, sort=[("received_at", -1)])
            last_ok = await _db.ig_health_events.find_one({"connector_id": c["id"], "event_type": "success"}, {"_id": 0}, sort=[("created_at", -1)])
            out.append({
                "id": c["id"], "connector_key": c["connector_key"], "name": c["name"],
                "category": c["category"], "connection_type": c["connection_type"], "status": c["status"],
                "health_status": c.get("health_status") or ("healthy" if configured else "dormant"),
                "credential_status": "connected" if configured else "not_configured",
                "automation_level": c.get("automation_level", 0),
                "automation_label": AUTOMATION_LEVELS.get(c.get("automation_level", 0), "observe"),
                "error_rate": round(fails / total, 2) if total else 0.0,
                "pending_jobs": pending, "failed_jobs": failed,
                "last_successful_request": last_ok["created_at"] if last_ok else None,
                "last_webhook_received": last_wh["received_at"] if last_wh else None,
                "last_checked_at": c.get("last_checked_at"),
            })
        summary = {
            "connectors": len(connectors),
            "active": len([c for c in connectors if c["status"] == "active"]),
            "dormant": len([c for c in out if c["credential_status"] == "not_configured"]),
            "pending_jobs": await _db.ig_jobs.count_documents({"status": {"$in": ["queued", "running", "failed_retryable", "awaiting_approval"]}}),
            "dead_letter": await _db.ig_jobs.count_documents({"status": "dead_letter"}),
            "awaiting_approval": await _db.ig_jobs.count_documents({"status": "awaiting_approval"}),
        }
        return {"summary": summary, "connectors": out}

    @r.get("/connectors/{cid}")
    async def connector_detail(cid: str, admin: dict = Depends(require_admin)):
        c = await _connector_or_404(cid)
        refs = await _db.ig_credential_refs.find({"connector_id": cid}, {"_id": 0}).to_list(20)
        subs = await _db.ig_webhook_subscriptions.find({"connector_id": cid}, {"_id": 0}).to_list(20)
        jobs = await _db.ig_jobs.find({"connector_id": cid}, {"_id": 0}).sort("created_at", -1).to_list(25)
        health = await _db.ig_health_events.find({"connector_id": cid}, {"_id": 0}).sort("created_at", -1).to_list(25)
        return {"connector": c, "credentials": [_cred_view(x) for x in refs],
                "webhook_subscriptions": subs, "recent_jobs": jobs, "recent_health": health}

    @r.post("/connectors")
    async def create_connector(req: ConnectorReq, admin: dict = Depends(require_admin)):
        if req.connection_type not in CONNECTION_TYPES:
            raise HTTPException(status_code=400, detail="Invalid connection type.")
        if await _db.ig_connectors.find_one({"connector_key": req.connector_key}):
            raise HTTPException(status_code=400, detail="Connector key already exists.")
        c = {"id": _nid(), "connector_key": req.connector_key, "name": req.name, "category": req.category,
             "description": req.description, "connection_type": req.connection_type, "status": "active",
             "owner_team": "platform", "data_classification": req.data_classification,
             "automation_level": max(0, min(4, req.automation_level)),
             "created_at": _now_iso(), "updated_at": _now_iso()}
        await _db.ig_connectors.insert_one(dict(c))
        c.pop("_id", None)
        return c

    @r.put("/connectors/{cid}")
    async def update_connector(cid: str, req: ConnectorUpdateReq, admin: dict = Depends(require_admin)):
        await _connector_or_404(cid)
        upd = {"updated_at": _now_iso()}
        if req.name is not None:
            upd["name"] = req.name
        if req.description is not None:
            upd["description"] = req.description
        if req.status is not None:
            if req.status not in CONNECTOR_STATUS:
                raise HTTPException(status_code=400, detail="Invalid status.")
            upd["status"] = req.status
        if req.automation_level is not None:
            upd["automation_level"] = max(0, min(4, req.automation_level))
        await _db.ig_connectors.update_one({"id": cid}, {"$set": upd})
        return await _db.ig_connectors.find_one({"id": cid}, {"_id": 0})

    @r.post("/connectors/{cid}/test")
    async def test_connection(cid: str, admin: dict = Depends(require_admin)):
        c = await _connector_or_404(cid)
        return await _health_check(c)

    @r.post("/connectors/{cid}/test-workflow")
    async def test_workflow(cid: str, admin: dict = Depends(require_admin)):
        """Enqueue a diagnostic workflow job to exercise the dispatcher + monitoring."""
        c = await _connector_or_404(cid)
        return await enqueue_job(c["connector_key"], "diagnostic_health_check",
                                 initiated_by_type="admin", initiated_by_id=admin["id"])

    @r.post("/connectors/{cid}/rotate")
    async def rotate_credential(cid: str, req: RotateReq, admin: dict = Depends(require_admin)):
        """Records a credential rotation event. NEVER accepts or stores a raw secret —
        the actual value is rotated in the environment-secret system out of band."""
        ref = await _db.ig_credential_refs.find_one({"id": req.credential_reference_id, "connector_id": cid}, {"_id": 0})
        if not ref:
            raise HTTPException(status_code=404, detail="Credential reference not found.")
        now = _now_iso()
        due = (_now() + timedelta(days=req.rotation_due_days or 90)).isoformat()
        await _db.ig_credential_refs.update_one({"id": ref["id"]}, {"$set": {
            "last_rotated_at": now, "rotation_due_at": due,
            "status": "active" if _secret_present(ref["vault_reference"]) else "invalid", "updated_at": now}})
        await _record_health(cid, "success", "info", "credential rotation recorded")
        return _cred_view(await _db.ig_credential_refs.find_one({"id": ref["id"]}, {"_id": 0}))

    # ---- jobs
    @r.get("/jobs")
    async def list_jobs(status: Optional[str] = None, admin: dict = Depends(require_admin)):
        q = {}
        if status:
            q["status"] = status
        rows = await _db.ig_jobs.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
        return {"jobs": rows}

    @r.post("/jobs/{jid}/retry")
    async def retry_job(jid: str, admin: dict = Depends(require_admin)):
        job = await _db.ig_jobs.find_one({"id": jid}, {"_id": 0})
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        if job["status"] not in ("failed_retryable", "failed_final", "dead_letter"):
            raise HTTPException(status_code=400, detail="Job is not in a retryable state.")
        await _db.ig_jobs.update_one({"id": jid}, {"$set": {"status": "queued", "next_retry_at": None}})
        return await _run_job(jid)

    @r.post("/jobs/{jid}/cancel")
    async def cancel_job(jid: str, admin: dict = Depends(require_admin)):
        job = await _db.ig_jobs.find_one({"id": jid}, {"_id": 0})
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        if job["status"] in ("succeeded", "failed_final"):
            raise HTTPException(status_code=400, detail="Job already finished.")
        await _db.ig_jobs.update_one({"id": jid}, {"$set": {"status": "cancelled", "completed_at": _now_iso()}})
        return await _db.ig_jobs.find_one({"id": jid}, {"_id": 0})

    @r.post("/jobs/{jid}/approve")
    async def approve_job(jid: str, admin: dict = Depends(require_admin)):
        job = await _db.ig_jobs.find_one({"id": jid}, {"_id": 0})
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        if job["status"] != "awaiting_approval":
            raise HTTPException(status_code=400, detail="Job is not awaiting approval.")
        await _db.ig_jobs.update_one({"id": jid}, {"$set": {"status": "queued", "approved_by": admin["id"], "approved_at": _now_iso()}})
        return await _run_job(jid)

    # ---- health / webhooks / audit
    @r.get("/health")
    async def health_feed(admin: dict = Depends(require_admin)):
        rows = await _db.ig_health_events.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
        return {"events": rows}

    @r.get("/webhooks")
    async def webhook_receipts(admin: dict = Depends(require_admin)):
        rows = await _db.ig_webhook_receipts.find({}, {"_id": 0}).sort("received_at", -1).to_list(100)
        return {"receipts": rows}

    @r.get("/oauth")
    async def oauth_connections(admin: dict = Depends(require_admin)):
        rows = await _db.ig_oauth_connections.find({}, {"_id": 0}).sort("connected_at", -1).to_list(200)
        # sanitized — provider_account_reference is a reference, not a token
        return {"connections": rows}

    # ---- browser automation broker
    @r.get("/browser-sessions")
    async def list_browser(admin: dict = Depends(require_admin)):
        rows = await _db.ig_browser_sessions.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
        return {"sessions": rows}

    @r.post("/browser-sessions")
    async def create_browser(req: BrowserSessionReq, admin: dict = Depends(require_admin)):
        s = {"id": _nid(), "initiator_id": admin["id"], "initiator_email": admin.get("email"),
             "purpose": req.purpose[:300], "target_platform": req.target_platform[:200],
             "workflow_type": req.workflow_type, "approval_status": "awaiting_approval",
             "started_at": None, "ended_at": None, "outcome": None,
             "session_reference": None, "created_at": _now_iso()}
        await _db.ig_browser_sessions.insert_one(dict(s))
        s.pop("_id", None)
        return s

    @r.post("/browser-sessions/{sid}/approve")
    async def approve_browser(sid: str, admin: dict = Depends(require_admin)):
        s = await _db.ig_browser_sessions.find_one({"id": sid}, {"_id": 0})
        if not s:
            raise HTTPException(status_code=404, detail="Session not found.")
        if s["approval_status"] != "awaiting_approval":
            raise HTTPException(status_code=400, detail="Session is not awaiting approval.")
        # Browserbase is dormant — approving records intent; a real session starts once keys exist.
        ready = _secret_present("env:BROWSERBASE_API_KEY")
        await _db.ig_browser_sessions.update_one({"id": sid}, {"$set": {
            "approval_status": "approved", "approved_by": admin["id"], "approved_at": _now_iso(),
            "started_at": _now_iso() if ready else None,
            "outcome": None if ready else "Browserbase not configured — session parked (dormant).",
            "session_reference": f"vault://BROWSERBASE_SESSION/{_nid()}" if ready else None}})
        return await _db.ig_browser_sessions.find_one({"id": sid}, {"_id": 0})

    @r.post("/browser-sessions/{sid}/end")
    async def end_browser(sid: str, admin: dict = Depends(require_admin), body: dict = Body(default={})):
        s = await _db.ig_browser_sessions.find_one({"id": sid}, {"_id": 0})
        if not s:
            raise HTTPException(status_code=404, detail="Session not found.")
        await _db.ig_browser_sessions.update_one({"id": sid}, {"$set": {
            "approval_status": "completed", "ended_at": _now_iso(),
            "outcome": (body.get("outcome") or "Completed by admin")[:300]}})
        return await _db.ig_browser_sessions.find_one({"id": sid}, {"_id": 0})

    return r


# ============================================================= user router
def build_user_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/integrations", dependencies=[Depends(get_current_user)])

    @r.get("/connections")
    async def my_connections(user: dict = Depends(get_current_user)):
        """User-authorized OAuth connections — sanitized (no tokens ever returned)."""
        rows = await _db.ig_oauth_connections.find(
            {"connection_owner_type": "user", "connection_owner_id": user["id"]}, {"_id": 0}
        ).sort("connected_at", -1).to_list(100)
        out = []
        for c in rows:
            conn = await _db.ig_connectors.find_one({"id": c["connector_id"]}, {"_id": 0}) or {}
            out.append({
                "id": c["id"], "provider": conn.get("name", c["connector_id"]),
                "purpose": conn.get("description"), "requested_access": c.get("granted_scopes", []),
                "status": c["status"], "connected_at": c.get("connected_at"),
                "last_successful_sync": c.get("last_sync_at"), "expires_at": c.get("expires_at")})
        return {"connections": out}

    @r.post("/connections/{conn_id}/revoke")
    async def revoke_connection(conn_id: str, user: dict = Depends(get_current_user)):
        c = await _db.ig_oauth_connections.find_one(
            {"id": conn_id, "connection_owner_type": "user", "connection_owner_id": user["id"]}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Connection not found.")
        await _db.ig_oauth_connections.update_one({"id": conn_id}, {"$set": {
            "status": "revoked", "revoked_at": _now_iso()}})
        await _cap(user, "integration_connection_revoked", {"connector_id": c["connector_id"]})
        return {"ok": True}

    return r


# ============================================================= webhook gateway (public)
def build_webhook_router() -> APIRouter:
    r = APIRouter(prefix="/api/integrations/webhooks")

    @r.post("/{connector_key}")
    async def receive(connector_key: str, request: Request):
        connector = await _db.ig_connectors.find_one({"connector_key": connector_key}, {"_id": 0})
        if not connector:
            raise HTTPException(status_code=404, detail="Unknown connector.")
        sub = await _db.ig_webhook_subscriptions.find_one({"connector_id": connector["id"], "status": "active"}, {"_id": 0})
        raw = await request.body()
        headers = {k.lower(): v for k, v in request.headers.items()}
        provider_event_id = headers.get("x-event-id") or headers.get("stripe-signature", "")[:60] or hashlib.sha256(raw).hexdigest()[:32]

        # signature verification (framework)
        signature_valid = True
        if sub and sub.get("signature_verification_required"):
            secret_ref = sub.get("signing_secret_ref")
            provided = headers.get("x-signature") or headers.get("x-webhook-signature")
            if secret_ref and _secret_present(secret_ref) and provided:
                expected = hmac.new(os.environ.get(_vault_var(secret_ref), "").encode(), raw, hashlib.sha256).hexdigest()
                signature_valid = hmac.compare_digest(expected, provided)
            else:
                signature_valid = False  # required but unverifiable → reject

        # idempotency / dedupe
        dup = await _db.ig_webhook_receipts.find_one({"connector_id": connector["id"], "provider_event_id": provider_event_id})
        if dup:
            return {"received": True, "duplicate": True}

        processing_status = "processed" if signature_valid else "rejected_invalid_signature"
        await _db.ig_webhook_receipts.insert_one({
            "id": _nid(), "connector_id": connector["id"], "connector_key": connector_key,
            "provider_event_id": provider_event_id, "event_type": headers.get("x-event-type", "unknown"),
            "signature_valid": signature_valid, "processing_status": processing_status,
            "received_at": _now_iso(), "processed_at": _now_iso() if signature_valid else None})
        if not signature_valid:
            await _record_health(connector["id"], "webhook_error", "warning", "webhook signature invalid/unverifiable")
            _sentry("webhook_validation_failure", connector_key, "signature invalid/unverifiable")
            raise HTTPException(status_code=400, detail="Invalid signature.")
        await _record_health(connector["id"], "success", "info", "webhook received + verified")
        return {"received": True, "duplicate": False}

    return r
