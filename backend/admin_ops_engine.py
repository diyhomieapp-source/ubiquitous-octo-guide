"""
DIYhomie — Admin Control Center & Content Operations (Build Blueprint 10).

A Home-Intelligence-focused admin control center that lives INSIDE the existing
/admin workstation. Adds real role-based access control (RBAC) on top of the
existing JWT + is_admin owner flag, reusable content templates (draft → review →
published → archived, with versioning + rollback), a safety-escalation queue, a
support-ticket queue, HI feature flags, admin-role management (Super Admin only),
and an immutable (hash-chained) audit log.

RBAC pattern per integration_expert playbook, adapted to this app's uuid user ids
(user["id"]). Deny-by-default, least privilege, permissions read live from Mongo
(not from the JWT) so role changes take effect immediately.

Collections: hi_admin_users, hi_admin_permissions, hi_admin_audit,
             hi_content_templates, hi_content_template_versions,
             hi_safety_escalations, hi_support_tickets, hi_support_messages,
             hi_feature_flags
Shares: users, hi_properties, hi_rooms, hi_assets, hi_projects,
        hi_maintenance_tasks, hi_documents, hi_analytics, payment_transactions
"""
import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Optional, Callable, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

_db = None
_logger = None

# ---------------------------------------------------------------- RBAC matrix
ROLE_PERMISSIONS = {
    "super_admin": {"*"},
    "product_admin": {"dashboard.read", "users.read", "flags.read", "flags.write",
                      "content.read", "audit.read", "safety.read"},
    "support_admin": {"dashboard.read", "users.read", "users.suspend", "users.restore",
                      "support.read", "support.reply", "safety.read", "safety.review"},
    "content_reviewer": {"dashboard.read", "content.read", "content.write",
                         "content.review", "content.publish", "content.archive"},
    "finance_admin": {"dashboard.read", "users.read", "users.override", "audit.read"},
}
VALID_ROLES = set(ROLE_PERMISSIONS)
ROLE_LABELS = {"super_admin": "Super Admin", "product_admin": "Product Admin",
               "support_admin": "Support Admin", "content_reviewer": "Content Reviewer",
               "finance_admin": "Finance Admin"}
SENSITIVE = {"users.suspend", "users.delete", "users.override", "flags.write", "content.publish"}

TEMPLATE_TYPES = ["project", "maintenance", "safety", "issue", "tool_list", "material_list"]
TEMPLATE_STATUS = ["draft", "review", "published", "archived"]
TICKET_CATEGORIES = ["Account", "Billing", "AI Guidance", "Documents", "Projects", "Technical Issue", "Safety Concern", "Other"]
TICKET_STATUS = ["open", "in_progress", "waiting_user", "resolved", "closed"]
TICKET_PRIORITY = ["low", "medium", "high", "urgent"]
DEFAULT_FLAGS = [
    ("new_user_registration", "New user registration"),
    ("guest_mode", "Guest mode"),
    ("ai_photo_identification", "AI photo identification"),
    ("voice_input", "Voice input"),
    ("document_extraction", "Document extraction"),
    ("project_templates", "Project templates"),
    ("maintenance_suggestions", "Maintenance suggestions"),
    ("subscription_checkout", "Subscription checkout"),
]


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


def _now():
    return datetime.now(timezone.utc).isoformat()


def _new_id():
    return str(uuid.uuid4())


# ---------------------------------------------------------------- seed
async def seed(owner_email: str):
    """Idempotent: seed permissions, feature flags, and the initial Super Admin."""
    if _db is None:
        return
    try:
        for role, perms in ROLE_PERMISSIONS.items():
            for pk in perms:
                await _db.hi_admin_permissions.update_one(
                    {"admin_role": role, "permission_key": pk},
                    {"$setOnInsert": {"id": _new_id(), "created_at": _now()}}, upsert=True)
        for key, name in DEFAULT_FLAGS:
            await _db.hi_feature_flags.update_one(
                {"feature_key": key},
                {"$setOnInsert": {"id": _new_id(), "feature_key": key, "name": name,
                                  "description": f"Controls: {name}.", "enabled": True,
                                  "environment": "production", "updated_by_admin_id": None,
                                  "updated_at": _now()}}, upsert=True)
        owner = await _db.users.find_one({"email": {"$regex": f"^{owner_email}$", "$options": "i"}},
                                         {"_id": 0, "id": 1, "is_admin": 1})
        if owner and owner.get("is_admin"):
            await _db.hi_admin_users.update_one(
                {"user_id": owner["id"]},
                {"$set": {"admin_role": "super_admin", "status": "active", "updated_at": _now()},
                 "$setOnInsert": {"id": _new_id(), "created_at": _now()}}, upsert=True)
        await _db.hi_admin_audit.create_index([("created_at", -1)])
        await _db.hi_admin_users.create_index("user_id", unique=True)
        if _logger:
            _logger.info("admin ops (B10) seeded")
    except Exception as e:
        if _logger:
            _logger.warning(f"admin ops seed failed: {e}")


async def _permissions_for(role: str) -> set:
    rows = await _db.hi_admin_permissions.find({"admin_role": role}, {"_id": 0, "permission_key": 1}).to_list(200)
    return {r["permission_key"] for r in rows}


async def append_audit_raw(body: dict):
    """Shared hash-chain writer for hi_admin_audit. EVERY engine that records an
    admin-audit entry must go through this (raw inserts break the chain)."""
    prev = await _db.hi_admin_audit.find_one({}, {"_id": 0, "entry_hash": 1}, sort=[("created_at", -1)])
    body = dict(body)
    body.setdefault("id", _new_id())
    body.setdefault("created_at", _now())
    body["prev_hash"] = prev.get("entry_hash") if prev else None
    canonical = json.dumps({k: v for k, v in body.items() if k != "entry_hash"}, default=str, sort_keys=True)
    body["entry_hash"] = hashlib.sha256(canonical.encode()).hexdigest()
    await _db.hi_admin_audit.insert_one(dict(body))


async def _append_audit(actor_id, action, target_type, target_id, before=None, after=None, reason=None):
    await append_audit_raw({"admin_user_id": actor_id, "action_type": action,
                            "target_entity_type": target_type,
                            "target_entity_id": str(target_id) if target_id else None,
                            "before_data": before, "after_data": after, "reason": (reason or None)})


# ---------------------------------------------------------------- models
class ConfirmReq(BaseModel):
    confirm: bool = False
    reason: str = Field("", max_length=500)


class OverrideReq(ConfirmReq):
    subscription_tier: Optional[str] = None
    credits: Optional[int] = None


class FeatureOverrideReq(BaseModel):
    feature_key: str
    enabled: bool = True
    expires_at: Optional[str] = None
    reason: Optional[str] = None


class TemplateReq(BaseModel):
    template_type: str
    title: str
    category: str = "General"
    content: str = ""
    safety_notes: Optional[str] = None


class TemplateEditReq(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    content: Optional[str] = None
    safety_notes: Optional[str] = None
    status: Optional[str] = None


class PublishReq(ConfirmReq):
    pass


class SafetyReviewReq(BaseModel):
    status: str
    note: Optional[str] = None


class FlagReq(ConfirmReq):
    enabled: bool


class AssignRoleReq(BaseModel):
    user_email: str
    admin_role: str


class TicketReq(BaseModel):
    category: str
    subject: str
    description: str
    priority: str = "medium"
    related_entity_type: Optional[str] = None
    related_entity_id: Optional[str] = None


class TicketMsgReq(BaseModel):
    message: str


class TicketUpdateReq(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None


# ================================================================ admin router
def build_admin_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin")

    async def admin_ctx(user: dict = Depends(get_current_user)) -> dict:
        rec = await _db.hi_admin_users.find_one({"user_id": user["id"], "status": "active"}, {"_id": 0})
        if not rec:
            # migration guard: legacy owner is_admin but no AdminUser yet → treat as super_admin
            if user.get("is_admin"):
                rec = {"user_id": user["id"], "admin_role": "super_admin", "status": "active"}
                await _db.hi_admin_users.update_one(
                    {"user_id": user["id"]},
                    {"$set": {"admin_role": "super_admin", "status": "active", "updated_at": _now()},
                     "$setOnInsert": {"id": _new_id(), "created_at": _now()}}, upsert=True)
            else:
                raise HTTPException(status_code=403, detail="Admin access required")
        if rec["admin_role"] not in VALID_ROLES:
            raise HTTPException(status_code=403, detail="Invalid admin role")
        return {"user": user, "admin": rec, "perms": await _permissions_for(rec["admin_role"])}

    def need(perm: str):
        async def checker(ctx: dict = Depends(admin_ctx)):
            if "*" not in ctx["perms"] and perm not in ctx["perms"]:
                raise HTTPException(status_code=403, detail="Insufficient permission")
            return ctx
        return checker

    def need_role(role: str):
        async def checker(ctx: dict = Depends(admin_ctx)):
            if ctx["admin"]["admin_role"] != role:
                raise HTTPException(status_code=403, detail="Required role missing")
            return ctx
        return checker

    # ---------------- me / capabilities (any active admin)
    @r.get("/me")
    async def me(ctx: dict = Depends(admin_ctx)):
        return {"admin_role": ctx["admin"]["admin_role"],
                "role_label": ROLE_LABELS.get(ctx["admin"]["admin_role"], ctx["admin"]["admin_role"]),
                "permissions": sorted(ctx["perms"]), "is_super": ctx["admin"]["admin_role"] == "super_admin"}

    # ---------------- dashboard
    @r.get("/dashboard")
    async def dashboard(ctx: dict = Depends(need("dashboard.read"))):
        await _db.hi_analytics.insert_one({"id": _new_id(), "user_id": ctx["user"]["id"], "event": "admin_dashboard_opened", "meta": {}, "at": _now()})
        total_users = await _db.users.count_documents({})
        active_props = await _db.hi_properties.count_documents({})
        active_projects = await _db.hi_projects.count_documents({"status": {"$in": ["active", "draft", "paused"]}})
        open_safety = await _db.hi_safety_escalations.count_documents({"status": "open"})
        pending_docs = await _db.hi_documents.count_documents({"needs_review": True}) if "hi_documents" in await _db.list_collection_names() else 0
        active_subs = await _db.users.count_documents({"subscription_tier": {"$nin": ["free", None]}})
        open_tickets = await _db.hi_support_tickets.count_documents({"status": {"$in": ["open", "in_progress"]}})
        try:
            recent_errors = await _db.error_events.count_documents({})
        except Exception:
            recent_errors = 0
        recent_users = await _db.users.find({}, {"_id": 0, "id": 1, "name": 1, "email": 1, "created_at": 1, "subscription_tier": 1}).sort("created_at", -1).to_list(6)
        recent_safety = await _db.hi_safety_escalations.find({}, {"_id": 0}).sort("created_at", -1).to_list(6)
        recent_tickets = await _db.hi_support_tickets.find({}, {"_id": 0}).sort("created_at", -1).to_list(6)
        return {"cards": {"total_users": total_users, "active_properties": active_props,
                          "active_projects": active_projects, "open_safety": open_safety,
                          "pending_document_reviews": pending_docs, "active_subscriptions": active_subs,
                          "open_support_tickets": open_tickets, "recent_errors": recent_errors},
                "recent_users": recent_users, "recent_safety": recent_safety, "recent_tickets": recent_tickets}

    # ---------------- users
    @r.get("/users")
    async def list_users(q: Optional[str] = None, status: Optional[str] = None,
                         subscription: Optional[str] = None, ctx: dict = Depends(need("users.read"))):
        query = {}
        if q:
            query["$or"] = [{"name": {"$regex": q, "$options": "i"}}, {"email": {"$regex": q, "$options": "i"}}]
        if status:
            query["account_status"] = status
        if subscription:
            query["subscription_tier"] = subscription
        rows = await _db.users.find(query, {"_id": 0, "id": 1, "name": 1, "email": 1, "subscription_tier": 1,
                                            "account_status": 1, "created_at": 1, "last_login": 1}).sort("created_at", -1).to_list(200)
        return {"users": rows}

    @r.get("/users/{uid}")
    async def user_detail(uid: str, ctx: dict = Depends(need("users.read"))):
        u = await _db.users.find_one({"id": uid}, {"_id": 0, "password": 0, "password_hash": 0, "stripe_customer_id": 0})
        if not u:
            raise HTTPException(status_code=404, detail="User not found.")
        prop = await _db.hi_properties.find_one({"user_id": uid}, {"_id": 0})
        pid = prop["id"] if prop else None
        detail = {
            "profile": {k: u.get(k) for k in ("id", "name", "email", "subscription_tier", "account_status", "location", "created_at", "last_login")},
            "counts": {
                "properties": await _db.hi_properties.count_documents({"user_id": uid}),
                "rooms": await _db.hi_rooms.count_documents({"user_id": uid}),
                "assets": await _db.hi_assets.count_documents({"property_id": pid}) if pid else 0,
                "projects": await _db.hi_projects.count_documents({"user_id": uid}),
                "maintenance_tasks": await _db.hi_maintenance_tasks.count_documents({"user_id": uid}),
                "documents": await _db.hi_documents.count_documents({"user_id": uid}),
            },
            "subscription": {"tier": u.get("subscription_tier", "free"), "status": u.get("account_status", "active")},
            "activity": await _db.hi_analytics.find({"user_id": uid}, {"_id": 0, "event": 1, "at": 1}).sort("at", -1).to_list(15),
            "feature_override": u.get("feature_override"),
        }
        await _db.hi_analytics.insert_one({"id": _new_id(), "user_id": ctx["user"]["id"], "event": "admin_user_viewed", "meta": {"target": uid}, "at": _now()})
        return detail

    @r.post("/users/{uid}/suspend")
    async def suspend(uid: str, body: ConfirmReq, ctx: dict = Depends(need("users.suspend"))):
        if not body.confirm or len(body.reason.strip()) < 4:
            raise HTTPException(status_code=400, detail="Confirmation and a reason are required.")
        u = await _db.users.find_one({"id": uid}, {"_id": 0, "id": 1, "account_status": 1})
        if not u:
            raise HTTPException(status_code=404, detail="User not found.")
        await _db.users.update_one({"id": uid}, {"$set": {"account_status": "suspended"}})
        await _append_audit(ctx["user"]["id"], "user_account_suspended", "user", uid,
                            {"account_status": u.get("account_status", "active")}, {"account_status": "suspended"}, body.reason)
        return {"ok": True, "account_status": "suspended"}

    @r.post("/users/{uid}/restore")
    async def restore(uid: str, ctx: dict = Depends(need("users.restore"))):
        u = await _db.users.find_one({"id": uid}, {"_id": 0, "id": 1})
        if not u:
            raise HTTPException(status_code=404, detail="User not found.")
        await _db.users.update_one({"id": uid}, {"$set": {"account_status": "active"}})
        await _append_audit(ctx["user"]["id"], "user_account_restored", "user", uid, None, {"account_status": "active"}, "restore")
        return {"ok": True, "account_status": "active"}

    @r.post("/users/{uid}/override")
    async def override(uid: str, body: OverrideReq, ctx: dict = Depends(need("users.override"))):
        if not body.confirm or len(body.reason.strip()) < 4:
            raise HTTPException(status_code=400, detail="Confirmation and a reason are required.")
        u = await _db.users.find_one({"id": uid}, {"_id": 0, "subscription_tier": 1, "credits": 1})
        if not u:
            raise HTTPException(status_code=404, detail="User not found.")
        upd = {}
        if body.subscription_tier is not None:
            upd["subscription_tier"] = body.subscription_tier
        if body.credits is not None:
            upd["credits"] = max(0, int(body.credits))
        if upd:
            await _db.users.update_one({"id": uid}, {"$set": upd})
        await _append_audit(ctx["user"]["id"], "user_subscription_override", "user", uid,
                            {"subscription_tier": u.get("subscription_tier"), "credits": u.get("credits")}, upd, body.reason)
        return {"ok": True, **upd}

    @r.post("/users/{uid}/feature-override")
    async def feature_override(uid: str, body: FeatureOverrideReq, ctx: dict = Depends(need("users.override"))):
        u = await _db.users.find_one({"id": uid}, {"_id": 0, "id": 1, "feature_override": 1})
        if not u:
            raise HTTPException(status_code=404, detail="User not found.")
        ov = dict(u.get("feature_override") or {})
        ov[body.feature_key] = {"enabled": body.enabled, "expires_at": body.expires_at, "set_by": ctx["user"]["id"], "set_at": _now()}
        await _db.users.update_one({"id": uid}, {"$set": {"feature_override": ov}})
        await _append_audit(ctx["user"]["id"], "user_feature_override", "user", uid, None, {body.feature_key: body.enabled}, body.reason or "temporary override")
        return {"ok": True, "feature_override": ov}

    @r.delete("/users/{uid}")
    async def delete_user(uid: str, body: ConfirmReq, ctx: dict = Depends(need("users.delete"))):
        if not body.confirm or len(body.reason.strip()) < 4:
            raise HTTPException(status_code=400, detail="Confirmation and a reason are required to delete an account.")
        u = await _db.users.find_one({"id": uid}, {"_id": 0, "id": 1, "email": 1})
        if not u:
            raise HTTPException(status_code=404, detail="User not found.")
        await _db.users.update_one({"id": uid}, {"$set": {"account_status": "deleted", "deleted_at": _now()}})
        await _append_audit(ctx["user"]["id"], "user_account_deleted", "user", uid, {"email": u.get("email")}, {"account_status": "deleted"}, body.reason)
        return {"ok": True, "account_status": "deleted"}

    # ---------------- content templates
    @r.get("/templates")
    async def list_templates(template_type: Optional[str] = None, status: Optional[str] = None,
                             ctx: dict = Depends(need("content.read"))):
        query = {}
        if template_type:
            query["template_type"] = template_type
        if status:
            query["status"] = status
        rows = await _db.hi_content_templates.find(query, {"_id": 0}).sort("updated_at", -1).to_list(300)
        return {"templates": rows}

    @r.post("/templates")
    async def create_template(req: TemplateReq, ctx: dict = Depends(need("content.write"))):
        if req.template_type not in TEMPLATE_TYPES:
            raise HTTPException(status_code=400, detail="Invalid template type.")
        if not req.title.strip():
            raise HTTPException(status_code=400, detail="Title is required.")
        doc = {"id": _new_id(), "template_type": req.template_type, "title": req.title.strip()[:160],
               "category": (req.category or "General")[:60], "content": req.content, "safety_notes": req.safety_notes,
               "status": "draft", "version_number": 1, "created_by_admin_id": ctx["user"]["id"],
               "reviewed_by_admin_id": None, "last_reviewed_date": None, "created_at": _now(), "updated_at": _now()}
        await _db.hi_content_templates.insert_one(dict(doc))
        await _append_audit(ctx["user"]["id"], "content_template_created", "content_template", doc["id"], None, {"title": doc["title"], "type": doc["template_type"]}, None)
        doc.pop("_id", None)
        return doc

    @r.get("/templates/{tid}")
    async def template_detail(tid: str, ctx: dict = Depends(need("content.read"))):
        t = await _db.hi_content_templates.find_one({"id": tid}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Template not found.")
        versions = await _db.hi_content_template_versions.find({"template_id": tid}, {"_id": 0}).sort("version_number", -1).to_list(50)
        return {"template": t, "versions": versions}

    @r.put("/templates/{tid}")
    async def edit_template(tid: str, req: TemplateEditReq, ctx: dict = Depends(need("content.write"))):
        t = await _db.hi_content_templates.find_one({"id": tid}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Template not found.")
        upd = {"updated_at": _now()}
        for f in ("title", "category", "content", "safety_notes"):
            v = getattr(req, f)
            if v is not None:
                upd[f] = v
        if req.status in ("draft", "review"):
            upd["status"] = req.status
        if req.status == "review":
            upd["reviewed_by_admin_id"] = ctx["user"]["id"]
            upd["last_reviewed_date"] = _now()
        # material change to a safety template => snapshot a version
        if t["template_type"] == "safety" and ("content" in upd or "safety_notes" in upd):
            await _snapshot(t)
            upd["version_number"] = t.get("version_number", 1) + 1
        await _db.hi_content_templates.update_one({"id": tid}, {"$set": upd})
        return await _db.hi_content_templates.find_one({"id": tid}, {"_id": 0})

    async def _snapshot(t: dict):
        await _db.hi_content_template_versions.insert_one({
            "id": _new_id(), "template_id": t["id"], "version_number": t.get("version_number", 1),
            "title": t.get("title"), "content": t.get("content"), "safety_notes": t.get("safety_notes"),
            "status": t.get("status"), "snapshot_at": _now()})

    @r.post("/templates/{tid}/publish")
    async def publish_template(tid: str, body: PublishReq, ctx: dict = Depends(need("content.publish"))):
        if not body.confirm or len(body.reason.strip()) < 4:
            raise HTTPException(status_code=400, detail="Confirmation and a reason are required to publish.")
        t = await _db.hi_content_templates.find_one({"id": tid}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Template not found.")
        await _snapshot(t)
        await _db.hi_content_templates.update_one({"id": tid}, {"$set": {
            "status": "published", "reviewed_by_admin_id": ctx["user"]["id"],
            "last_reviewed_date": _now(), "updated_at": _now()}})
        await _append_audit(ctx["user"]["id"], "content_template_published", "content_template", tid, {"status": t["status"]}, {"status": "published"}, body.reason)
        return {"ok": True, "status": "published"}

    @r.post("/templates/{tid}/archive")
    async def archive_template(tid: str, ctx: dict = Depends(need("content.archive"))):
        t = await _db.hi_content_templates.find_one({"id": tid}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Template not found.")
        await _db.hi_content_templates.update_one({"id": tid}, {"$set": {"status": "archived", "updated_at": _now()}})
        await _append_audit(ctx["user"]["id"], "content_template_archived", "content_template", tid, {"status": t["status"]}, {"status": "archived"}, None)
        return {"ok": True, "status": "archived"}

    @r.post("/templates/{tid}/rollback/{version}")
    async def rollback_template(tid: str, version: int, ctx: dict = Depends(need("content.publish"))):
        t = await _db.hi_content_templates.find_one({"id": tid}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Template not found.")
        snap = await _db.hi_content_template_versions.find_one({"template_id": tid, "version_number": version}, {"_id": 0})
        if not snap:
            raise HTTPException(status_code=404, detail="Version not found.")
        await _snapshot(t)
        await _db.hi_content_templates.update_one({"id": tid}, {"$set": {
            "title": snap.get("title"), "content": snap.get("content"), "safety_notes": snap.get("safety_notes"),
            "version_number": t.get("version_number", 1) + 1, "status": "published", "updated_at": _now()}})
        await _append_audit(ctx["user"]["id"], "content_template_published", "content_template", tid, {"rolled_back_to": version}, {"status": "published"}, f"rollback to v{version}")
        return {"ok": True, "restored_from_version": version}

    # ---------------- safety escalation queue
    @r.get("/safety")
    async def list_safety(status: Optional[str] = None, ctx: dict = Depends(need("safety.read"))):
        query = {}
        if status:
            query["status"] = status
        rows = await _db.hi_safety_escalations.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
        return {"escalations": rows}

    @r.post("/safety/{sid}/review")
    async def review_safety(sid: str, req: SafetyReviewReq, ctx: dict = Depends(need("safety.review"))):
        s = await _db.hi_safety_escalations.find_one({"id": sid}, {"_id": 0})
        if not s:
            raise HTTPException(status_code=404, detail="Escalation not found.")
        st = req.status if req.status in ("open", "reviewed", "resolved", "false_positive") else "reviewed"
        await _db.hi_safety_escalations.update_one({"id": sid}, {"$set": {
            "status": st, "reviewed_by_admin_id": ctx["user"]["id"], "internal_note": req.note, "updated_at": _now()}})
        await _append_audit(ctx["user"]["id"], "safety_escalation_reviewed", "safety_escalation", sid, {"status": s["status"]}, {"status": st}, req.note)
        return {"ok": True, "status": st}

    # ---------------- feature flags
    @r.get("/flags")
    async def list_flags(ctx: dict = Depends(need("flags.read"))):
        return {"flags": await _db.hi_feature_flags.find({}, {"_id": 0}).sort("name", 1).to_list(100)}

    @r.put("/flags/{key}")
    async def set_flag(key: str, body: FlagReq, ctx: dict = Depends(need("flags.write"))):
        f = await _db.hi_feature_flags.find_one({"feature_key": key}, {"_id": 0})
        if not f:
            raise HTTPException(status_code=404, detail="Flag not found.")
        # disabling in production is sensitive
        if not body.enabled and f.get("environment") == "production" and (not body.confirm or len(body.reason.strip()) < 4):
            raise HTTPException(status_code=400, detail="Disabling a production feature needs confirmation and a reason.")
        await _db.hi_feature_flags.update_one({"feature_key": key}, {"$set": {
            "enabled": body.enabled, "updated_by_admin_id": ctx["user"]["id"], "updated_at": _now()}})
        await _append_audit(ctx["user"]["id"], "feature_flag_changed", "feature_flag", key, {"enabled": f.get("enabled")}, {"enabled": body.enabled}, body.reason or None)
        return {"ok": True, "enabled": body.enabled}

    # ---------------- support queue
    @r.get("/support")
    async def list_support(status: Optional[str] = None, category: Optional[str] = None, ctx: dict = Depends(need("support.read"))):
        query = {}
        if status:
            query["status"] = status
        if category:
            query["category"] = category
        rows = await _db.hi_support_tickets.find(query, {"_id": 0}).sort("updated_at", -1).to_list(200)
        return {"tickets": rows}

    @r.get("/support/{tid}")
    async def support_detail(tid: str, ctx: dict = Depends(need("support.read"))):
        t = await _db.hi_support_tickets.find_one({"id": tid}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Ticket not found.")
        msgs = await _db.hi_support_messages.find({"support_ticket_id": tid}, {"_id": 0}).sort("created_at", 1).to_list(200)
        return {"ticket": t, "messages": msgs}

    @r.post("/support/{tid}/reply")
    async def support_reply(tid: str, req: TicketMsgReq, ctx: dict = Depends(need("support.reply"))):
        t = await _db.hi_support_tickets.find_one({"id": tid}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Ticket not found.")
        await _db.hi_support_messages.insert_one({"id": _new_id(), "support_ticket_id": tid, "sender_type": "admin",
                                                  "sender_id": ctx["user"]["id"], "message": req.message[:4000], "created_at": _now()})
        await _db.hi_support_tickets.update_one({"id": tid}, {"$set": {"status": "in_progress" if t["status"] == "open" else t["status"], "updated_at": _now()}})
        await _append_audit(ctx["user"]["id"], "support_ticket_updated", "support_ticket", tid, None, {"reply": True}, None)
        return {"ok": True}

    @r.put("/support/{tid}")
    async def support_update(tid: str, req: TicketUpdateReq, ctx: dict = Depends(need("support.reply"))):
        upd = {"updated_at": _now()}
        if req.status in TICKET_STATUS:
            upd["status"] = req.status
        if req.priority in TICKET_PRIORITY:
            upd["priority"] = req.priority
        res = await _db.hi_support_tickets.update_one({"id": tid}, {"$set": upd})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Ticket not found.")
        await _append_audit(ctx["user"]["id"], "support_ticket_updated", "support_ticket", tid, None, upd, None)
        return {"ok": True}

    # ---------------- admin roles (Super Admin only)
    @r.get("/admins")
    async def list_admins(ctx: dict = Depends(need_role("super_admin"))):
        rows = await _db.hi_admin_users.find({}, {"_id": 0}).to_list(100)
        for a in rows:
            u = await _db.users.find_one({"id": a["user_id"]}, {"_id": 0, "name": 1, "email": 1})
            a["name"] = u.get("name") if u else None
            a["email"] = u.get("email") if u else None
            a["role_label"] = ROLE_LABELS.get(a["admin_role"], a["admin_role"])
        return {"admins": rows, "roles": [{"key": k, "label": v} for k, v in ROLE_LABELS.items()]}

    @r.post("/admins")
    async def assign_admin(req: AssignRoleReq, ctx: dict = Depends(need_role("super_admin"))):
        if req.admin_role not in VALID_ROLES:
            raise HTTPException(status_code=400, detail="Invalid role.")
        u = await _db.users.find_one({"email": {"$regex": f"^{req.user_email}$", "$options": "i"}}, {"_id": 0, "id": 1})
        if not u:
            raise HTTPException(status_code=404, detail="No user with that email.")
        await _db.hi_admin_users.update_one({"user_id": u["id"]}, {"$set": {
            "admin_role": req.admin_role, "status": "active", "updated_at": _now()},
            "$setOnInsert": {"id": _new_id(), "created_at": _now()}}, upsert=True)
        await _append_audit(ctx["user"]["id"], "admin_role_assigned", "admin_user", u["id"], None, {"admin_role": req.admin_role}, None)
        return {"ok": True}

    @r.delete("/admins/{user_id}")
    async def remove_admin(user_id: str, ctx: dict = Depends(need_role("super_admin"))):
        target = await _db.hi_admin_users.find_one({"user_id": user_id}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="Admin not found.")
        if target["admin_role"] == "super_admin":
            supers = await _db.hi_admin_users.count_documents({"admin_role": "super_admin", "status": "active"})
            if supers <= 1:
                raise HTTPException(status_code=409, detail="Cannot remove the last Super Admin.")
        await _db.hi_admin_users.delete_one({"user_id": user_id})
        await _append_audit(ctx["user"]["id"], "admin_role_removed", "admin_user", user_id, {"admin_role": target["admin_role"]}, None, None)
        return {"ok": True}

    # ---------------- audit log (read-only)
    @r.get("/audit")
    async def list_audit(ctx: dict = Depends(need("audit.read"))):
        return {"entries": await _db.hi_admin_audit.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)}

    return r


# ================================================================ user router (support + escalations source)
def build_user_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/support", dependencies=[Depends(get_current_user)])

    @r.get("")
    async def my_tickets(user: dict = Depends(get_current_user)):
        return {"tickets": await _db.hi_support_tickets.find({"user_id": user["id"]}, {"_id": 0}).sort("updated_at", -1).to_list(100)}

    @r.post("")
    async def create_ticket(req: TicketReq, user: dict = Depends(get_current_user)):
        if req.category not in TICKET_CATEGORIES:
            raise HTTPException(status_code=400, detail="Invalid category.")
        if not req.subject.strip() or not req.description.strip():
            raise HTTPException(status_code=400, detail="Subject and description are required.")
        tid = _new_id()
        doc = {"id": tid, "user_id": user["id"], "category": req.category,
               "priority": req.priority if req.priority in TICKET_PRIORITY else "medium",
               "status": "open", "subject": req.subject.strip()[:160], "description": req.description.strip()[:4000],
               "related_entity_type": req.related_entity_type, "related_entity_id": req.related_entity_id,
               "created_at": _now(), "updated_at": _now()}
        await _db.hi_support_tickets.insert_one(dict(doc))
        await _db.hi_support_messages.insert_one({"id": _new_id(), "support_ticket_id": tid, "sender_type": "user",
                                                  "sender_id": user["id"], "message": req.description.strip()[:4000], "created_at": _now()})
        await _db.hi_analytics.insert_one({"id": _new_id(), "user_id": user["id"], "event": "support_ticket_created", "meta": {"ticket_id": tid}, "at": _now()})
        doc.pop("_id", None)
        return doc

    @r.get("/{tid}")
    async def ticket_detail(tid: str, user: dict = Depends(get_current_user)):
        t = await _db.hi_support_tickets.find_one({"id": tid, "user_id": user["id"]}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Ticket not found.")
        msgs = await _db.hi_support_messages.find({"support_ticket_id": tid}, {"_id": 0}).sort("created_at", 1).to_list(200)
        return {"ticket": t, "messages": msgs}

    @r.post("/{tid}/message")
    async def add_message(tid: str, req: TicketMsgReq, user: dict = Depends(get_current_user)):
        t = await _db.hi_support_tickets.find_one({"id": tid, "user_id": user["id"]}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Ticket not found.")
        await _db.hi_support_messages.insert_one({"id": _new_id(), "support_ticket_id": tid, "sender_type": "user",
                                                  "sender_id": user["id"], "message": req.message[:4000], "created_at": _now()})
        await _db.hi_support_tickets.update_one({"id": tid}, {"$set": {"status": "waiting_user" if t["status"] == "resolved" else t["status"], "updated_at": _now()}})
        return {"ok": True}

    return r


# ---------------------------------------------------------------- external hook
async def get_published_templates(category: str = None, types: list = None, limit: int = 6) -> str:
    """Return a bounded text block of PUBLISHED templates for Homie to use as
    approved guidance context. Drafts/archived are never included."""
    if _db is None:
        return ""
    try:
        q = {"status": "published"}
        if types:
            q["template_type"] = {"$in": types}
        rows = await _db.hi_content_templates.find(q, {"_id": 0}).sort("updated_at", -1).to_list(30)
        if category:
            cl = category.lower()
            rows.sort(key=lambda t: 0 if (t.get("category", "").lower() == cl) else 1)
        # always surface safety templates first
        rows.sort(key=lambda t: 0 if t.get("template_type") == "safety" else 1)
        picked = rows[:limit]
        if not picked:
            return ""
        bits = []
        for t in picked:
            line = f"- [{t.get('template_type')}] {t.get('title')}: {(t.get('content') or '')[:400]}"
            if t.get("safety_notes"):
                line += f" | Safety: {(t.get('safety_notes'))[:200]}"
            bits.append(line)
        return "\n".join(bits)
    except Exception:
        return ""


async def record_safety_escalation(user_id: str, *, risk_level: str, trigger_type: str,
                                    ai_response_reference: str = "", conversation_id: str = None,
                                    issue_id: str = None, project_id: str = None):
    """Called by other engines (e.g. conversation hub emergency) to log a safety event."""
    if _db is None:
        return
    try:
        await _db.hi_safety_escalations.insert_one({
            "id": _new_id(), "user_id": user_id, "conversation_id": conversation_id,
            "issue_id": issue_id, "project_id": project_id,
            "risk_level": risk_level if risk_level in ("low", "moderate", "high", "emergency") else "moderate",
            "trigger_type": trigger_type, "ai_response_reference": ai_response_reference[:500],
            "status": "open", "reviewed_by_admin_id": None, "internal_note": None,
            "created_at": _now(), "updated_at": _now()})
    except Exception:
        pass
