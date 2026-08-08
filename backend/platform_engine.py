"""
DIYhomie — Platform Domain Architecture, API Contracts & Service Boundaries (Build Blueprint 39).

Governance/observability surface for the modular-monolith architecture: a machine-readable
catalog of core DOMAINS (ownership, owned vs referenced entities), API CONTRACT standards
(auth, error schema, idempotency, versioning), and an immutable domain-EVENT log with a
reusable emit_event() helper other engines can call. Extraction to microservices happens later;
this keeps boundaries explicit meanwhile.

Namespace /api/hi/admin/platform/*. Collection: platform_events.
"""
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

DOMAINS = [
    {"domain": "Identity & Access", "owns": ["accounts", "authentication", "roles", "consent", "collaborators"], "references": []},
    {"domain": "Property Intelligence", "owns": ["properties", "rooms", "assets", "measurements", "digital_twins", "property_timeline"], "references": ["accounts"]},
    {"domain": "Project Intelligence", "owns": ["projects", "work_items", "dependencies", "resources", "budget", "outcomes"], "references": ["room_id", "asset_id", "property_id"]},
    {"domain": "Knowledge Intelligence", "owns": ["documents", "extraction", "knowledge_graph", "templates", "retrieval_indexes"], "references": ["property_id", "asset_id"]},
    {"domain": "AI Intelligence", "owns": ["ai_orchestration", "safety_gateway", "provider_routing", "usage_tracking"], "references": ["retrieval_indexes", "property_context"]},
    {"domain": "Commerce & Rewards", "owns": ["subscriptions", "entitlements", "partner_routing", "affiliate_attribution", "points_ledger", "rewards", "redemptions"], "references": ["accounts"]},
    {"domain": "Operations", "owns": ["admin_controls", "support", "feature_flags", "analytics", "releases", "incidents"], "references": []},
    {"domain": "Communication", "owns": ["notifications", "inbox", "email_push_orchestration"], "references": ["accounts"]},
    {"domain": "Integration Platform", "owns": ["connectors", "webhooks", "workflows", "credential_references", "provider_health"], "references": []},
]

DOMAIN_EVENTS = ["asset.created", "document.processed", "room.confirmed", "measurement.recorded", "project.started",
                 "project.completed", "maintenance.due", "professional_job.created", "subscription.activated",
                 "reward.points_approved", "reward.redemption_fulfilled", "integration.failed",
                 "community.content_approved", "emergency.incident_created", "privacy.account_deletion_started"]

API_ERROR_CODES = ["unauthorized", "forbidden", "not_found", "validation_failed", "conflict", "rate_limited", "service_unavailable", "internal_error"]

API_STANDARDS = {
    "required_fields": ["authentication_requirement", "authorization_scope", "request_schema", "response_schema",
                        "error_schema", "idempotency_behavior", "rate_limit_behavior", "audit_behavior", "version_identifier"],
    "error_schema": {"code": "string", "message": "string", "user_message": "string", "correlation_id": "string",
                     "retryable": "boolean", "field_errors": "optional object"},
    "error_codes": API_ERROR_CODES,
    "versioning": ["Version contracts on breaking changes", "Preserve backward compat for supported mobile clients",
                   "Deprecate with documented timelines", "Never silently change response meaning"],
    "cqrs": {"queries": "read-only, no state change", "commands": "validate auth + rules, idempotent when retryable"},
    "extraction_candidates": ["AI Orchestration", "Document Processing", "Digital Twin Capture", "Notification Delivery",
                              "Rewards Fulfillment", "Integration Gateway", "Search & Knowledge Retrieval"],
}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


async def emit_event(event_type: str, domain: str, entity_id: str, *, actor_type: str = "system",
                     actor_id: Optional[str] = None, entity_version: Optional[str] = None,
                     correlation_id: Optional[str] = None, payload: Optional[dict] = None):
    """Reusable, idempotent-friendly domain-event emitter. Never store unnecessary private content."""
    if _db is None:
        return None
    env = {"event_id": _nid(), "event_type": event_type, "domain": domain, "entity_id": entity_id,
           "entity_version": entity_version, "occurred_at": _now(), "actor_type": actor_type, "actor_id": actor_id,
           "correlation_id": correlation_id or _nid(), "payload": payload or {}}
    try:
        await _db.platform_events.insert_one(dict(env)); env.pop("_id", None)
    except Exception as e:
        if _logger:
            _logger.error(f"emit_event failed: {e}")
    return env


class EventReq(BaseModel):
    event_type: str
    domain: str
    entity_id: str
    payload: Optional[dict] = None


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/platform", dependencies=[Depends(require_admin)])

    @r.get("/domains")
    async def domains(admin: dict = Depends(require_admin)):
        return {"domains": DOMAINS, "ownership_rule": "Each domain owns its data & rules. Other domains reference by id only and mutate via that domain's approved API — never direct cross-domain writes."}

    @r.get("/api-standards")
    async def api_standards(admin: dict = Depends(require_admin)):
        return {"standards": API_STANDARDS, "event_types": DOMAIN_EVENTS}

    @r.get("/events")
    async def events(domain: Optional[str] = None, event_type: Optional[str] = None, admin: dict = Depends(require_admin)):
        q = {}
        if domain:
            q["domain"] = domain
        if event_type:
            q["event_type"] = event_type
        rows = await _db.platform_events.find(q, {"_id": 0, "payload": 0}).sort("occurred_at", -1).to_list(200)
        by_type = {}
        for e in await _db.platform_events.find({}, {"_id": 0, "event_type": 1}).to_list(1000):
            by_type[e["event_type"]] = by_type.get(e["event_type"], 0) + 1
        return {"events": rows, "counts_by_type": by_type, "total": await _db.platform_events.count_documents({})}

    @r.post("/events")
    async def record_event(req: EventReq, admin: dict = Depends(require_admin)):
        if req.event_type not in DOMAIN_EVENTS:
            raise HTTPException(status_code=400, detail="Unknown event type.")
        env = await emit_event(req.event_type, req.domain, req.entity_id, actor_type="admin", actor_id=admin["id"], payload=req.payload)
        return {"event": env}

    return r


async def seed_platform():
    if _db is None:
        return
    try:
        await _db.platform_events.create_index("occurred_at")
        if _logger:
            _logger.info("platform architecture (B39) seeded")
    except Exception as e:
        if _logger:
            _logger.error(f"platform seed failed: {e}")
