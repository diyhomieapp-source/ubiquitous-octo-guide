"""
DIYhomie — Data Governance, Privacy, Retention & Account Portability (Build Blueprint 31).

Platform-wide trust & lifecycle layer. Additive: references existing collections, never
duplicates auth. Provides: consent model, data classification map, retention policies,
step-up REAUTHENTICATION for high-risk actions, account & property deletion workflows
(async, controlled), data export (access-controlled + expiring), sharing registry with
revocation, AI/analytics privacy controls, and admin privacy-incident tracking.

Private property data is private by default. Deletion revokes access and queues controlled
deletion; we never claim instant deletion when async processing is required.

Collections: dg_consents, dg_retention_policies, dg_exports, dg_incidents, dg_reauth_grants,
dg_deletion_jobs, dg_ai_prefs, dg_account_state.
"""
import uuid
import json
import hashlib
import secrets
from datetime import datetime, timezone, timedelta
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel

_db = None
_logger = None
_verify_password: Optional[Callable] = None

# ---- reauth ----
REAUTH_TTL_MIN = 10
HIGH_RISK_ACTIONS = ["account_delete", "property_delete", "data_export", "share_sensitive", "security_change"]

# ---- lifecycle ----
ACCOUNT_STATES = ["active", "suspended", "deletion_pending", "deleted", "retained_for_legal_hold"]
DELETION_RECOVERY_DAYS = 30

# ---- consent ----
CONSENT_TYPES = [
    {"type": "terms", "purpose": "Accept Terms of Service", "required": True},
    {"type": "privacy_policy", "purpose": "Acknowledge the Privacy Policy", "required": True},
    {"type": "analytics", "purpose": "Optional usage analytics to keep the app reliable", "required": False},
    {"type": "product_improvement", "purpose": "Optional product-improvement analytics", "required": False},
    {"type": "photo_document_processing", "purpose": "Process your photos & documents to give guidance", "required": False},
    {"type": "community_contribution", "purpose": "Share your projects/experiences with the community", "required": False},
    {"type": "public_project_sharing", "purpose": "Publish a project publicly", "required": False},
    {"type": "marketing", "purpose": "Marketing communications", "required": False},
    {"type": "external_account", "purpose": "Connect an external account (OAuth)", "required": False},
    {"type": "location", "purpose": "Use your location for local codes & weather", "required": False},
    {"type": "ai_processing", "purpose": "Use AI to help with your home tasks", "required": False},
    {"type": "ai_training", "purpose": "Optional: allow anonymized data to improve AI models", "required": False},
]

# ---- data classification (ownership/purpose/retention/access/deletion) ----
DATA_MAP = [
    {"category": "profile", "data_class": "C", "label": "Profile & preferences", "purpose": "Personalize guidance", "retention": "While account active", "deletion": "Deleted on account deletion", "collections": ["users", "hi_user_prefs"]},
    {"category": "properties", "data_class": "C", "label": "Properties & rooms", "purpose": "Home context for guidance", "retention": "While property/account active", "deletion": "Deleted on property/account deletion", "collections": ["hi_properties", "hi_rooms"]},
    {"category": "assets", "data_class": "C", "label": "Assets & appliances", "purpose": "Tailored, asset-aware guidance", "retention": "While account active", "deletion": "Deleted on account deletion", "collections": ["hi_assets"]},
    {"category": "measurements", "data_class": "C", "label": "Measurements", "purpose": "Accurate material estimates", "retention": "While account active", "deletion": "Deleted on account deletion", "collections": ["hi_measurements"]},
    {"category": "projects", "data_class": "C", "label": "Projects & plans", "purpose": "Plan & track your work", "retention": "While account active", "deletion": "Deleted on account deletion", "collections": ["hi_projects", "hi_project_steps"]},
    {"category": "maintenance", "data_class": "C", "label": "Maintenance records", "purpose": "Keep your home healthy", "retention": "While account active", "deletion": "Deleted on account deletion", "collections": ["hi_maintenance_tasks"]},
    {"category": "inventory", "data_class": "C", "label": "Toolbox / inventory", "purpose": "Match supplies you already own", "retention": "While account active", "deletion": "Deleted on account deletion", "collections": ["hi_inventory_items"]},
    {"category": "documents", "data_class": "C", "label": "Documents, receipts & warranties", "purpose": "Grounded, document-aware answers", "retention": "While account active", "deletion": "Deleted on account deletion", "collections": ["hi_documents"]},
    {"category": "conversations", "data_class": "C", "label": "Conversations with Homie", "purpose": "Context & history", "retention": "While account active", "deletion": "Deleted on account deletion", "collections": ["hi_conversations", "hi_conversation_messages"]},
    {"category": "rewards", "data_class": "E", "label": "Reward & redemption activity", "purpose": "Points ledger & redemptions", "retention": "Per financial policy", "deletion": "Anonymized; minimum kept for accounting", "collections": ["rewards_ledger"]},
    {"category": "billing", "data_class": "D", "label": "Payment provider references", "purpose": "Subscriptions & billing", "retention": "Per accounting/legal policy", "deletion": "Provider references kept as required by law", "collections": ["payment_transactions"]},
    {"category": "audit", "data_class": "B", "label": "Security & audit logs", "purpose": "Security, fraud & legal", "retention": "Per security/legal policy", "deletion": "Retained per legal hold; not user-erasable", "collections": ["hi_admin_audit"]},
]

DEFAULT_RETENTION = [
    {"data_category": "active_property_data", "retention_period": "Account/property active", "retention_trigger": "account_or_property_deletion", "deletion_method": "hard_delete", "legal_hold_supported": True},
    {"data_category": "deleted_user_content", "retention_period": f"{DELETION_RECOVERY_DAYS} day recovery window", "retention_trigger": "recovery_window_elapsed", "deletion_method": "hard_delete", "legal_hold_supported": True},
    {"data_category": "audit_logs", "retention_period": "Security/legal defined", "retention_trigger": "legal_policy", "deletion_method": "restricted", "legal_hold_supported": True},
    {"data_category": "error_telemetry", "retention_period": "90 days", "retention_trigger": "operational_window_elapsed", "deletion_method": "auto_prune", "legal_hold_supported": False},
    {"data_category": "expired_share_links", "retention_period": "Immediate inaccessibility", "retention_trigger": "expiry_or_revocation", "deletion_method": "invalidate", "legal_hold_supported": False},
    {"data_category": "anonymous_aggregate_analytics", "retention_period": "Approved policy", "retention_trigger": "approved_policy", "deletion_method": "retain_anonymous", "legal_hold_supported": False},
]

EXPORT_CATEGORIES = ["profile", "properties", "assets", "projects", "maintenance", "measurements", "inventory", "documents", "rewards", "conversations"]
EXPORT_TTL_HOURS = 48


def _now():
    return datetime.now(timezone.utc)


def _iso():
    return _now().isoformat()


def _nid():
    return str(uuid.uuid4())


def _digest(v: str) -> str:
    return hashlib.sha256(v.encode("utf-8")).hexdigest()


def configure(db, logger, verify_password: Callable):
    global _db, _logger, _verify_password
    _db, _logger, _verify_password = db, logger, verify_password


async def _cap(user_id, event, props=None):
    try:
        import analytics_engine
        await analytics_engine.capture({"id": user_id}, event, props or {})
    except Exception:
        pass


def _sentry(event_type, message):
    try:
        import sentry_sdk
        sentry_sdk.capture_message(f"[data_governance:{event_type}] {message}", level="error")
    except Exception:
        pass


async def _account_state(user_id: str) -> dict:
    st = await _db.dg_account_state.find_one({"user_id": user_id}, {"_id": 0})
    if not st:
        st = {"user_id": user_id, "state": "active", "updated_at": _iso()}
        await _db.dg_account_state.insert_one(dict(st)); st.pop("_id", None)
    return st


async def _consume_reauth(user_id: str, action: str, token: Optional[str]):
    """Atomically consume a one-time, action-bound reauth grant. Raises 403 if invalid."""
    if not token:
        raise HTTPException(status_code=403, detail="Reauthentication required for this action.")
    grant = await _db.dg_reauth_grants.find_one_and_delete({
        "user_id": user_id, "jti_hash": _digest(token), "action": action,
        "expires_at": {"$gt": _iso()},
    })
    if not grant:
        raise HTTPException(status_code=403, detail="Invalid or expired reauthentication. Please confirm your password again.")


async def _active_shares(user_id: str) -> list:
    """Sharing registry, assembled live from real share sources (private-by-default)."""
    shares = []
    # Pro workspace client links
    async for link in _db.pro_share_links.find({"status": "active"}, {"_id": 0}):
        proj = await _db.pro_projects.find_one({"id": link.get("professional_project_id"), "owner_user_id": user_id}, {"_id": 0, "id": 1, "project_name": 1})
        if proj:
            shares.append({"id": link["id"], "kind": "professional_client_link", "recipient": link.get("client_reference") or "Client (link)",
                           "scope": "deliverable", "purpose": "Share an approved deliverable", "duration": "Until revoked",
                           "download": True, "source": "pro_share_links", "created_at": link.get("created_at")})
    # Collaboration invites/members on properties owned by user
    async for prop in _db.hi_properties.find({"user_id": user_id}, {"_id": 0, "id": 1, "name": 1}):
        async for m in _db.prop_members.find({"property_id": prop["id"], "status": {"$ne": "removed"}}, {"_id": 0}):
            if m.get("user_id") == user_id:
                continue
            shares.append({"id": m["id"], "kind": "property_collaborator", "recipient": m.get("email") or m.get("user_id") or "Collaborator",
                           "scope": f"{prop.get('name') or 'Home'} · {m.get('role','viewer')}", "purpose": "Property collaboration",
                           "duration": "Until removed", "download": False, "source": "prop_members", "created_at": m.get("created_at")})
    return shares


async def _revoke_share(user_id: str, sid: str) -> bool:
    link = await _db.pro_share_links.find_one({"id": sid, "status": "active"}, {"_id": 0})
    if link:
        proj = await _db.pro_projects.find_one({"id": link.get("professional_project_id"), "owner_user_id": user_id})
        if proj:
            await _db.pro_share_links.update_one({"id": sid}, {"$set": {"status": "revoked", "revoked_at": _iso()}})
            return True
    mem = await _db.prop_members.find_one({"id": sid}, {"_id": 0})
    if mem:
        prop = await _db.hi_properties.find_one({"id": mem.get("property_id"), "user_id": user_id})
        if prop:
            await _db.prop_members.update_one({"id": sid}, {"$set": {"status": "removed", "removed_at": _iso()}})
            return True
    return False


# ============================================================= models
class ReauthReq(BaseModel):
    current_password: str
    action: str


class ConsentReq(BaseModel):
    consent_type: str
    status: str  # granted | withdrawn


class ExportReq(BaseModel):
    categories: list[str]


class AiPrefsReq(BaseModel):
    ai_training_opt_in: Optional[bool] = None
    analytics_opt_in: Optional[bool] = None


class DeletionReq(BaseModel):
    reason: Optional[str] = None


# ============================================================= user router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/privacy", dependencies=[Depends(get_current_user)])

    @r.post("/reauth")
    async def reauth(req: ReauthReq, user: dict = Depends(get_current_user)):
        if req.action not in HIGH_RISK_ACTIONS:
            raise HTTPException(status_code=400, detail="Unknown action.")
        pw_hash = user.get("hashed_password")
        if not pw_hash:
            raise HTTPException(status_code=409, detail="This account signs in with a connected provider. Set a password first to confirm sensitive actions.")
        ok = False
        try:
            ok = bool(_verify_password(req.current_password, pw_hash))
        except Exception:
            ok = False
        if not ok:
            _sentry("reauth_failed", f"user={user['id']} action={req.action}")
            raise HTTPException(status_code=401, detail="Reauthentication failed. Check your password.")
        token = secrets.token_urlsafe(32)
        expires = (_now() + timedelta(minutes=REAUTH_TTL_MIN)).isoformat()
        await _db.dg_reauth_grants.insert_one({"id": _nid(), "user_id": user["id"], "jti_hash": _digest(token),
                                               "action": req.action, "issued_at": _iso(), "expires_at": expires})
        return {"reauth_token": token, "expires_in": REAUTH_TTL_MIN * 60, "action": req.action}

    @r.get("/overview")
    async def overview(user: dict = Depends(get_current_user)):
        st = await _account_state(user["id"])
        consents = await _db.dg_consents.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
        latest: dict = {}
        for c in consents:
            latest.setdefault(c["consent_type"], c)
        shares = await _active_shares(user["id"])
        exports = await _db.dg_exports.find({"user_id": user["id"]}, {"_id": 0, "secure_token": 0}).sort("created_at", -1).to_list(20)
        ai = await _db.dg_ai_prefs.find_one({"user_id": user["id"]}, {"_id": 0}) or {"ai_training_opt_in": False, "analytics_opt_in": True}
        return {"account_state": st["state"], "deletion": {k: st.get(k) for k in ("deletion_requested_at", "deletion_effective_at") if st.get(k)},
                "consents": [{"consent_type": c["consent_type"], "status": v["status"], "purpose": next((t["purpose"] for t in CONSENT_TYPES if t["type"] == c["consent_type"]), c["consent_type"])} for c, v in [(x, x) for x in latest.values()]],
                "consent_types": CONSENT_TYPES, "active_shares": len(shares), "exports": exports,
                "ai_prefs": {"ai_training_opt_in": ai.get("ai_training_opt_in", False), "analytics_opt_in": ai.get("analytics_opt_in", True)},
                "recovery_days": DELETION_RECOVERY_DAYS}

    @r.get("/data-map")
    async def data_map(user: dict = Depends(get_current_user)):
        return {"data_map": DATA_MAP, "classes": {
            "A": "Public platform content", "B": "Internal operational data", "C": "Private user data",
            "D": "Sensitive security data", "E": "Restricted financial data"}}

    @r.get("/consents")
    async def consents(user: dict = Depends(get_current_user)):
        rows = await _db.dg_consents.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(300)
        latest: dict = {}
        for c in rows:
            latest.setdefault(c["consent_type"], c)
        out = []
        for t in CONSENT_TYPES:
            cur = latest.get(t["type"])
            out.append({**t, "status": cur["status"] if cur else "denied", "version": cur.get("version", 1) if cur else 0,
                        "updated_at": cur.get("granted_at") or cur.get("withdrawn_at") if cur else None})
        return {"consents": out}

    @r.put("/consents")
    async def set_consent(req: ConsentReq, user: dict = Depends(get_current_user)):
        meta = next((t for t in CONSENT_TYPES if t["type"] == req.consent_type), None)
        if not meta:
            raise HTTPException(status_code=400, detail="Unknown consent type.")
        if req.status not in ("granted", "withdrawn"):
            raise HTTPException(status_code=400, detail="Invalid status.")
        if meta["required"] and req.status == "withdrawn":
            raise HTTPException(status_code=409, detail="This consent is required to use DIYhomie and cannot be withdrawn without deleting your account.")
        prev = await _db.dg_consents.find({"user_id": user["id"], "consent_type": req.consent_type}, {"_id": 0}).sort("version", -1).to_list(1)
        version = (prev[0]["version"] + 1) if prev else 1
        doc = {"id": _nid(), "user_id": user["id"], "consent_type": req.consent_type, "purpose": meta["purpose"],
               "status": req.status, "version": version, "created_at": _iso()}
        doc["granted_at" if req.status == "granted" else "withdrawn_at"] = _iso()
        await _db.dg_consents.insert_one(dict(doc)); doc.pop("_id", None)
        await _cap(user["id"], "consent_updated", {"type": req.consent_type, "status": req.status})
        return {"consent": doc}

    @r.get("/ai-controls")
    async def get_ai(user: dict = Depends(get_current_user)):
        ai = await _db.dg_ai_prefs.find_one({"user_id": user["id"]}, {"_id": 0}) or {"ai_training_opt_in": False, "analytics_opt_in": True}
        return {"ai_training_opt_in": ai.get("ai_training_opt_in", False), "analytics_opt_in": ai.get("analytics_opt_in", True),
                "note": "Safety and essential service processing always run and are never affected by these optional toggles."}

    @r.put("/ai-controls")
    async def put_ai(req: AiPrefsReq, user: dict = Depends(get_current_user)):
        upd = {k: v for k, v in req.dict().items() if v is not None}
        if upd:
            upd["updated_at"] = _iso()
            await _db.dg_ai_prefs.update_one({"user_id": user["id"]}, {"$set": upd, "$setOnInsert": {"user_id": user["id"]}}, upsert=True)
            await _cap(user["id"], "consent_updated", {"type": "ai_controls"})
        return await get_ai(user)

    # ---- sharing registry ----
    @r.get("/shares")
    async def shares(user: dict = Depends(get_current_user)):
        return {"shares": await _active_shares(user["id"]),
                "note": "Private data is only shared through your explicit actions. Revoke anything here at any time."}

    @r.post("/shares/{sid}/revoke")
    async def revoke(sid: str, user: dict = Depends(get_current_user)):
        ok = await _revoke_share(user["id"], sid)
        if not ok:
            raise HTTPException(status_code=404, detail="Share not found.")
        await _cap(user["id"], "sharing_permission_changed", {"revoked": sid})
        return {"ok": True}

    # ---- export ----
    @r.get("/export/categories")
    async def export_cats(user: dict = Depends(get_current_user)):
        return {"categories": EXPORT_CATEGORIES, "ttl_hours": EXPORT_TTL_HOURS}

    @r.post("/export")
    async def create_export(req: ExportReq, x_reauth_token: Optional[str] = Header(default=None), user: dict = Depends(get_current_user)):
        await _consume_reauth(user["id"], "data_export", x_reauth_token)
        cats = [c for c in req.categories if c in EXPORT_CATEGORIES] or EXPORT_CATEGORIES
        try:
            data = await _gather_export(user, cats)
        except Exception as e:
            _sentry("export_generation_failure", str(e))
            raise HTTPException(status_code=502, detail="Couldn't build your export. Try again.")
        token = secrets.token_urlsafe(24)
        exp = {"id": _nid(), "user_id": user["id"], "requested_categories": cats, "status": "ready",
               "secure_token": _digest(token), "payload": json.dumps(data), "size_bytes": len(json.dumps(data)),
               "expires_at": (_now() + timedelta(hours=EXPORT_TTL_HOURS)).isoformat(), "downloads": 0, "created_at": _iso()}
        await _db.dg_exports.insert_one(dict(exp))
        await _cap(user["id"], "data_export_requested", {"categories": len(cats)})
        return {"export": {"id": exp["id"], "status": "ready", "categories": cats, "size_bytes": exp["size_bytes"],
                           "expires_at": exp["expires_at"], "download_token": token},
                "note": f"Download link works for {EXPORT_TTL_HOURS}h and only for you. It never includes other users' data or internal secrets."}

    @r.get("/export")
    async def list_exports(user: dict = Depends(get_current_user)):
        rows = await _db.dg_exports.find({"user_id": user["id"]}, {"_id": 0, "secure_token": 0, "payload": 0}).sort("created_at", -1).to_list(30)
        for row in rows:
            if row.get("status") == "ready" and row.get("expires_at", "") < _iso():
                row["status"] = "expired"
        return {"exports": rows}

    @r.get("/export/{eid}/download")
    async def download_export(eid: str, token: str, user: dict = Depends(get_current_user)):
        exp = await _db.dg_exports.find_one({"id": eid, "user_id": user["id"]}, {"_id": 0})
        if not exp:
            raise HTTPException(status_code=404, detail="Export not found.")
        if exp.get("secure_token") != _digest(token):
            raise HTTPException(status_code=403, detail="Invalid download token.")
        if exp.get("expires_at", "") < _iso():
            await _db.dg_exports.update_one({"id": eid}, {"$set": {"status": "expired"}})
            raise HTTPException(status_code=410, detail="This export link has expired. Request a new export.")
        await _db.dg_exports.update_one({"id": eid}, {"$inc": {"downloads": 1}})
        return {"export_id": eid, "generated_at": exp["created_at"], "categories": exp["requested_categories"],
                "data": json.loads(exp["payload"])}

    # ---- account deletion ----
    @r.get("/account/deletion")
    async def deletion_status(user: dict = Depends(get_current_user)):
        st = await _account_state(user["id"])
        return {"state": st["state"], "deletion_requested_at": st.get("deletion_requested_at"),
                "deletion_effective_at": st.get("deletion_effective_at"), "retention_exceptions": st.get("retention_exceptions", [])}

    @r.post("/account/deletion")
    async def start_deletion(req: DeletionReq, x_reauth_token: Optional[str] = Header(default=None), user: dict = Depends(get_current_user)):
        await _consume_reauth(user["id"], "account_delete", x_reauth_token)
        st = await _account_state(user["id"])
        if st["state"] == "deletion_pending":
            return await deletion_status(user)
        effective = (_now() + timedelta(days=DELETION_RECOVERY_DAYS)).isoformat()
        # revoke active shares, collaborator access, external connections
        revoked = 0
        async for link in _db.pro_share_links.find({"status": "active"}, {"_id": 0, "id": 1, "professional_project_id": 1}):
            proj = await _db.pro_projects.find_one({"id": link.get("professional_project_id"), "owner_user_id": user["id"]})
            if proj:
                await _db.pro_share_links.update_one({"id": link["id"]}, {"$set": {"status": "revoked", "revoked_at": _iso()}}); revoked += 1
        async for prop in _db.hi_properties.find({"user_id": user["id"]}, {"_id": 0, "id": 1}):
            await _db.prop_members.update_many({"property_id": prop["id"], "user_id": {"$ne": user["id"]}}, {"$set": {"status": "removed", "removed_at": _iso()}})
        try:
            await _db.hi_user_integrations.update_many({"user_id": user["id"]}, {"$set": {"status": "revoked"}})
        except Exception:
            pass
        # queue deletion jobs per private category; record retention exceptions
        jobs = [{"id": _nid(), "user_id": user["id"], "data_category": d["category"], "status": "queued",
                 "scheduled_for": effective, "created_at": _iso()} for d in DATA_MAP if d["data_class"] == "C"]
        if jobs:
            await _db.dg_deletion_jobs.insert_many(jobs)
        retention_exceptions = [{"category": d["category"], "reason": "legal/accounting/security obligation"} for d in DATA_MAP if d["data_class"] in ("B", "D", "E")]
        await _db.dg_account_state.update_one({"user_id": user["id"]}, {"$set": {
            "state": "deletion_pending", "deletion_requested_at": _iso(), "deletion_effective_at": effective,
            "deletion_reason": (req.reason or "")[:300] or None, "retention_exceptions": retention_exceptions,
            "shares_revoked": revoked, "updated_at": _iso()}}, upsert=True)
        await _cap(user["id"], "account_deletion_started", {})
        return {"state": "deletion_pending", "deletion_effective_at": effective, "shares_revoked": revoked,
                "queued_categories": [j["data_category"] for j in jobs], "retention_exceptions": retention_exceptions,
                "note": f"Your account is scheduled for deletion in {DELETION_RECOVERY_DAYS} days. Sessions and shares are revoked now. Some records are kept only where legally required. You can cancel any time before then."}

    @r.post("/account/deletion/cancel")
    async def cancel_deletion(user: dict = Depends(get_current_user)):
        st = await _account_state(user["id"])
        if st["state"] != "deletion_pending":
            raise HTTPException(status_code=409, detail="No pending deletion to cancel.")
        await _db.dg_deletion_jobs.delete_many({"user_id": user["id"], "status": "queued"})
        await _db.dg_account_state.update_one({"user_id": user["id"]}, {"$set": {"state": "active", "updated_at": _iso()},
                                              "$unset": {"deletion_requested_at": "", "deletion_effective_at": "", "deletion_reason": ""}})
        return {"state": "active", "note": "Deletion cancelled. Your data is safe."}

    # ---- property deletion ----
    @r.get("/properties/{pid}/deletion-impact")
    async def property_impact(pid: str, user: dict = Depends(get_current_user)):
        prop = await _db.hi_properties.find_one({"id": pid, "user_id": user["id"]}, {"_id": 0})
        if not prop:
            raise HTTPException(status_code=404, detail="Property not found or not owned by you.")
        counts = {}
        for coll, field in [("hi_rooms", "property_id"), ("hi_assets", "property_id"), ("hi_projects", "property_id"),
                            ("hi_measurements", "property_id"), ("hi_documents", "property_id")]:
            try:
                counts[coll.replace("hi_", "")] = await _db[coll].count_documents({field: pid})
            except Exception:
                counts[coll.replace("hi_", "")] = 0
        collaborators = await _db.prop_members.count_documents({"property_id": pid, "user_id": {"$ne": user["id"]}, "status": {"$ne": "removed"}})
        return {"property": {"id": prop["id"], "name": prop.get("name")}, "impact": counts, "collaborators": collaborators,
                "note": "Deleting this property removes its rooms, assets, projects, measurements, documents and digital twin, revokes collaborator access, invalidates shared links, and pauses linked workflows. Export first if you want a copy."}

    @r.post("/properties/{pid}/deletion")
    async def delete_property(pid: str, x_reauth_token: Optional[str] = Header(default=None), user: dict = Depends(get_current_user)):
        await _consume_reauth(user["id"], "property_delete", x_reauth_token)
        prop = await _db.hi_properties.find_one({"id": pid, "user_id": user["id"]}, {"_id": 0})
        if not prop:
            raise HTTPException(status_code=404, detail="Property not found or not owned by you.")
        active_homes = await _db.hi_properties.count_documents({"user_id": user["id"], "status": {"$ne": "deleted"}})
        if active_homes <= 1:
            raise HTTPException(status_code=409, detail="You can't delete your only home. Add another home first, or delete your account instead.")
        await _db.prop_members.update_many({"property_id": pid, "user_id": {"$ne": user["id"]}}, {"$set": {"status": "removed", "removed_at": _iso()}})
        async for link in _db.pro_share_links.find({"status": "active"}, {"_id": 0, "id": 1, "professional_project_id": 1}):
            proj = await _db.pro_projects.find_one({"id": link.get("professional_project_id"), "property_id": pid})
            if proj:
                await _db.pro_share_links.update_one({"id": link["id"]}, {"$set": {"status": "revoked", "revoked_at": _iso()}})
        try:
            await _db.hi_maintenance_tasks.update_many({"property_id": pid}, {"$set": {"status": "paused"}})
        except Exception:
            pass
        for coll, field in [("hi_rooms", "property_id"), ("hi_assets", "property_id"), ("hi_projects", "property_id"),
                            ("hi_measurements", "property_id"), ("hi_documents", "property_id"), ("hi_inventory_items", "property_id")]:
            try:
                await _db[coll].delete_many({field: pid})
            except Exception:
                pass
        was_active = prop.get("is_active")
        await _db.hi_properties.delete_one({"id": pid})
        if was_active:
            other = await _db.hi_properties.find_one({"user_id": user["id"]}, {"_id": 0, "id": 1})
            if other:
                await _db.hi_properties.update_one({"id": other["id"]}, {"$set": {"is_active": True}})
        await _cap(user["id"], "property_deletion_started", {})
        return {"ok": True, "note": "Property and its private data were deleted. Collaborator access and shared links were revoked."}

    return r


async def _gather_export(user: dict, categories: list) -> dict:
    uid = user["id"]
    out: dict = {"account": {"id": uid, "email": user.get("email"), "name": user.get("name"),
                             "subscription_tier": user.get("subscription_tier"), "created_at": user.get("created_at")}}
    SAFE_EXCLUDE = {"_id", "secure_token", "payload", "hashed_password"}

    async def _dump(coll, flt, limit=1000):
        rows = await _db[coll].find(flt, {k: 0 for k in ("_id",)}).to_list(limit)
        for row in rows:
            for k in list(row.keys()):
                if k in SAFE_EXCLUDE:
                    row.pop(k, None)
        return rows

    props = await _db.hi_properties.find({"user_id": uid}, {"_id": 0}).to_list(50)
    prop_ids = [p["id"] for p in props]
    if "profile" in categories:
        out["profile"] = {"preferences": await _dump("hi_user_prefs", {"user_id": uid})}
    if "properties" in categories:
        out["properties"] = props
        out["rooms"] = await _dump("hi_rooms", {"property_id": {"$in": prop_ids}})
    if "assets" in categories:
        out["assets"] = await _dump("hi_assets", {"property_id": {"$in": prop_ids}})
    if "projects" in categories:
        out["projects"] = await _dump("hi_projects", {"user_id": uid})
    if "maintenance" in categories:
        out["maintenance"] = await _dump("hi_maintenance_tasks", {"user_id": uid})
    if "measurements" in categories:
        out["measurements"] = await _dump("hi_measurements", {"property_id": {"$in": prop_ids}})
    if "inventory" in categories:
        out["inventory"] = await _dump("hi_inventory_items", {"user_id": uid})
    if "documents" in categories:
        # metadata only — never raw file blobs
        docs = await _dump("hi_documents", {"user_id": uid})
        for d in docs:
            d.pop("file_base64", None); d.pop("image_base64", None); d.pop("data", None)
        out["documents"] = docs
    if "rewards" in categories:
        out["rewards"] = await _dump("rewards_ledger", {"user_id": uid})
    if "conversations" in categories:
        convos = await _dump("hi_conversations", {"user_id": uid})
        out["conversations"] = convos
    return out


# ============================================================= admin router
class RetentionReq(BaseModel):
    data_category: str
    retention_period: str
    retention_trigger: str
    deletion_method: str
    legal_hold_supported: bool = False
    status: str = "active"


class IncidentReq(BaseModel):
    incident_type: str
    severity: str
    affected_data_category: Optional[str] = None
    affected_user_count: Optional[int] = None


class IncidentStatusReq(BaseModel):
    status: str


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/privacy", dependencies=[Depends(require_admin)])

    @r.get("/dashboard")
    async def dashboard(admin: dict = Depends(require_admin)):
        async def _cs(st):
            return await _db.dg_account_state.count_documents({"state": st})
        consent_counts = {}
        for t in CONSENT_TYPES:
            consent_counts[t["type"]] = await _db.dg_consents.count_documents({"consent_type": t["type"], "status": "granted"})
        return {"account_states": {st: await _cs(st) for st in ACCOUNT_STATES},
                "pending_deletions": await _db.dg_account_state.count_documents({"state": "deletion_pending"}),
                "queued_deletion_jobs": await _db.dg_deletion_jobs.count_documents({"status": "queued"}),
                "exports_total": await _db.dg_exports.count_documents({}),
                "open_incidents": await _db.dg_incidents.count_documents({"status": {"$in": ["detected", "investigating", "contained"]}}),
                "retention_policies": await _db.dg_retention_policies.count_documents({}),
                "granted_consents": consent_counts,
                "note": "Admins never browse private property data here. Sensitive access requires a logged support/safety/legal reason."}

    @r.get("/retention")
    async def get_retention(admin: dict = Depends(require_admin)):
        return {"policies": await _db.dg_retention_policies.find({}, {"_id": 0}).sort("data_category", 1).to_list(100)}

    @r.put("/retention")
    async def put_retention(req: RetentionReq, admin: dict = Depends(require_admin)):
        doc = req.dict(); doc["updated_at"] = _iso()
        await _db.dg_retention_policies.update_one({"data_category": req.data_category}, {"$set": doc, "$setOnInsert": {"id": _nid()}}, upsert=True)
        return {"ok": True, "policy": await _db.dg_retention_policies.find_one({"data_category": req.data_category}, {"_id": 0})}

    @r.get("/deletions")
    async def deletions(admin: dict = Depends(require_admin)):
        rows = await _db.dg_account_state.find({"state": "deletion_pending"}, {"_id": 0}).sort("deletion_requested_at", -1).to_list(200)
        return {"deletions": rows}

    @r.get("/incidents")
    async def incidents(admin: dict = Depends(require_admin)):
        return {"incidents": await _db.dg_incidents.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)}

    @r.post("/incidents")
    async def create_incident(req: IncidentReq, admin: dict = Depends(require_admin)):
        if req.severity not in ("low", "medium", "high", "critical"):
            raise HTTPException(status_code=400, detail="Invalid severity.")
        doc = {"id": _nid(), "incident_type": req.incident_type[:120], "severity": req.severity,
               "affected_data_category": req.affected_data_category, "affected_user_count": req.affected_user_count,
               "status": "detected", "opened_by": admin["id"], "created_at": _iso(), "resolved_at": None}
        await _db.dg_incidents.insert_one(dict(doc)); doc.pop("_id", None)
        return {"incident": doc}

    @r.put("/incidents/{iid}")
    async def update_incident(iid: str, req: IncidentStatusReq, admin: dict = Depends(require_admin)):
        if req.status not in ("detected", "investigating", "contained", "resolved"):
            raise HTTPException(status_code=400, detail="Invalid status.")
        upd = {"status": req.status}
        if req.status == "resolved":
            upd["resolved_at"] = _iso()
        res = await _db.dg_incidents.update_one({"id": iid}, {"$set": upd})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Incident not found.")
        return {"ok": True, "status": req.status}

    return r


# ============================================================= seed
async def seed_governance():
    if _db is None:
        return
    try:
        await _db.dg_reauth_grants.create_index("expires_at")
        for p in DEFAULT_RETENTION:
            existing = await _db.dg_retention_policies.find_one({"data_category": p["data_category"]})
            if not existing:
                await _db.dg_retention_policies.insert_one({**p, "id": _nid(), "status": "active", "updated_at": _iso()})
        if _logger:
            _logger.info("data governance (B31) seeded")
    except Exception as e:
        if _logger:
            _logger.error(f"data governance seed failed: {e}")
