"""
DIYhomie — Property Collaboration, Roles & Shared Access (Build Blueprint 22).

A property-scoped, SERVER-SIDE authorization layer on top of the existing JWT auth. Lets an
owner share selected property info with household members / renters / contractors WITHOUT
sharing account credentials, and WITHOUT exposing billing, rewards, private conversations, or
other properties.

Access hierarchy: User → Property Access → (Room/Project/Doc scope) → permission.
Roles: owner, property_manager, editor, contributor, viewer, professional_guest (expiring).

Security: invite/guest tokens are random + stored ONLY as SHA-256 hashes; guest access expires;
every material permission action is audited; removing a collaborator revokes access immediately.

Collections: prop_members, collab_invites, collab_activity, task_assignments, collab_audit.
"""
import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

ROLES = ["owner", "property_manager", "editor", "contributor", "viewer", "professional_guest"]
SCOPE_TYPES = ["property", "room", "asset", "project", "maintenance_task", "document", "professional_job"]

# Default permission sets per role. "*" = full (owner). Wildcards like "room.*" match any room.* key.
ROLE_PERMS = {
    "owner": ["*"],
    "property_manager": ["property.view", "room.*", "asset.*", "project.*", "maintenance.*",
                         "document.view", "document.upload", "measurement.*", "professional_job.view"],
    "editor": ["property.view", "room.view", "room.edit", "asset.view", "asset.edit",
               "project.view", "project.edit", "project.complete_step", "maintenance.view",
               "maintenance.complete", "measurement.view", "measurement.edit",
               "document.view", "document.upload"],
    "contributor": ["property.view", "room.view", "asset.view", "project.view",
                    "project.complete_step", "maintenance.view", "maintenance.complete",
                    "measurement.view", "document.view", "document.upload"],
    "viewer": ["property.view", "room.view", "asset.view", "project.view",
               "maintenance.view", "measurement.view", "document.view"],
    "professional_guest": ["professional_job.view", "project.view", "room.view", "document.view"],
}
ROLE_LABEL = {"owner": "Owner", "property_manager": "Property Manager", "editor": "Editor",
              "contributor": "Contributor", "viewer": "Viewer", "professional_guest": "Professional Guest"}
INVITE_TTL_DAYS = 14
GUEST_TTL_DAYS = 7


def _now():
    return datetime.now(timezone.utc)


def _iso():
    return _now().isoformat()


def _nid():
    return str(uuid.uuid4())


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


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
        sentry_sdk.capture_message(f"[collab:{event_type}] {message}", level="error")
    except Exception:
        pass


def _perm_match(perms: list, key: str) -> bool:
    if "*" in perms or key in perms:
        return True
    prefix = key.split(".", 1)[0] + ".*"
    return prefix in perms


async def _audit(property_id, actor_id, action, target_type=None, target_id=None, prev=None, new=None):
    await _db.collab_audit.insert_one({
        "id": _nid(), "property_id": property_id, "actor_user_id": actor_id, "action_type": action,
        "target_entity_type": target_type, "target_entity_id": target_id,
        "previous_state": prev, "new_state": new, "created_at": _iso()})


async def _activity(property_id, actor_id, action_type, target_type=None, target_id=None, visibility="collaborators"):
    await _db.collab_activity.insert_one({
        "id": _nid(), "property_id": property_id, "actor_user_id": actor_id, "action_type": action_type,
        "target_entity_type": target_type, "target_entity_id": target_id,
        "visibility": visibility, "created_at": _iso()})


async def _property(pid: str) -> Optional[dict]:
    return await _db.hi_properties.find_one({"id": pid}, {"_id": 0})


async def is_owner(pid: str, user_id: str) -> bool:
    p = await _property(pid)
    return bool(p and p.get("user_id") == user_id)


async def get_member(pid: str, user_id: str) -> Optional[dict]:
    return await _db.prop_members.find_one({"property_id": pid, "user_id": user_id, "status": "active"}, {"_id": 0})


async def check_access(pid: str, user_id: str, permission_key: str) -> bool:
    """SERVER-SIDE authorization. Owner → full. Otherwise an active member's role perms +
    non-expired scopes. Reusable by other engines."""
    if await is_owner(pid, user_id):
        return True
    m = await get_member(pid, user_id)
    if not m:
        return False
    # expired guest?
    if m.get("expires_at") and m["expires_at"] < _iso():
        await _db.prop_members.update_one({"id": m["id"]}, {"$set": {"status": "suspended"}})
        return False
    return _perm_match(ROLE_PERMS.get(m["role"], []), permission_key)


async def require(pid: str, user_id: str, permission_key: str):
    if not await check_access(pid, user_id, permission_key):
        _sentry("authorization_failure", f"user {user_id} lacked {permission_key} on {pid}")
        raise HTTPException(status_code=403, detail="You do not have access to this item.")


# ============================================================= models
class InviteReq(BaseModel):
    invited_email: str
    invited_role: str = "viewer"
    scope_type: Optional[str] = None
    scope_id: Optional[str] = None


class AcceptReq(BaseModel):
    invite_token: str


class RoleReq(BaseModel):
    role: str


class AssignReq(BaseModel):
    property_id: str
    task_entity_type: str
    task_entity_id: str
    assigned_to_user_id: str
    due_date: Optional[str] = None


class AssignRespondReq(BaseModel):
    status: str  # accepted | declined | completed


# ============================================================= router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/collab", dependencies=[Depends(get_current_user)])

    async def _owned(user) -> list:
        return await _db.hi_properties.find({"user_id": user["id"]}, {"_id": 0, "id": 1, "nickname": 1, "name": 1, "property_type": 1}).to_list(50)

    @r.get("/owned")
    async def owned_properties(user: dict = Depends(get_current_user)):
        props = await _owned(user)
        out = []
        for p in props:
            members = await _db.prop_members.count_documents({"property_id": p["id"], "status": "active"})
            pending = await _db.collab_invites.count_documents({"property_id": p["id"], "status": "pending"})
            out.append({"id": p["id"], "name": p.get("nickname") or p.get("name") or "My property",
                        "type": p.get("property_type"), "collaborators": members, "pending_invites": pending})
        return {"properties": out}

    @r.get("/shared-with-me")
    async def shared_with_me(user: dict = Depends(get_current_user)):
        members = await _db.prop_members.find({"user_id": user["id"], "status": "active"}, {"_id": 0}).to_list(100)
        out = []
        for m in members:
            p = await _property(m["property_id"])
            if not p:
                continue
            out.append({"property_id": m["property_id"], "name": p.get("nickname") or p.get("name") or "Shared property",
                        "role": m["role"], "role_label": ROLE_LABEL.get(m["role"], m["role"]),
                        "expires_at": m.get("expires_at"), "accepted_at": m.get("accepted_at")})
        return {"properties": out}

    @r.get("/properties/{pid}/my-permissions")
    async def my_permissions(pid: str, user: dict = Depends(get_current_user)):
        if await is_owner(pid, user["id"]):
            return {"role": "owner", "role_label": "Owner", "permissions": ["*"], "is_owner": True}
        m = await get_member(pid, user["id"])
        if not m:
            raise HTTPException(status_code=403, detail="You do not have access to this item.")
        return {"role": m["role"], "role_label": ROLE_LABEL.get(m["role"], m["role"]),
                "permissions": ROLE_PERMS.get(m["role"], []), "is_owner": False, "expires_at": m.get("expires_at")}

    # ---- members / invitations (owner-managed)
    @r.get("/properties/{pid}/members")
    async def list_members(pid: str, user: dict = Depends(get_current_user)):
        if not await is_owner(pid, user["id"]) and not await check_access(pid, user["id"], "property.manage_members"):
            raise HTTPException(status_code=403, detail="You do not have access to this item.")
        rows = await _db.prop_members.find({"property_id": pid, "status": {"$ne": "removed"}}, {"_id": 0}).to_list(200)
        out = []
        for m in rows:
            u = await _db.users.find_one({"id": m["user_id"]}, {"_id": 0, "email": 1, "name": 1}) or {}
            out.append({**m, "role_label": ROLE_LABEL.get(m["role"], m["role"]),
                        "email": u.get("email"), "name": u.get("name")})
        return {"members": out}

    @r.get("/properties/{pid}/invites")
    async def list_invites(pid: str, user: dict = Depends(get_current_user)):
        if not await is_owner(pid, user["id"]):
            raise HTTPException(status_code=403, detail="You do not have access to this item.")
        rows = await _db.collab_invites.find({"property_id": pid, "status": "pending"}, {"_id": 0, "invite_token_hash": 0}).to_list(100)
        return {"invites": rows}

    @r.post("/properties/{pid}/invite")
    async def invite(pid: str, req: InviteReq, user: dict = Depends(get_current_user)):
        if not await is_owner(pid, user["id"]):
            raise HTTPException(status_code=403, detail="Only the owner can invite collaborators.")
        if req.invited_role not in ROLES or req.invited_role == "owner":
            raise HTTPException(status_code=400, detail="Invalid role.")
        email = req.invited_email.strip().lower()
        if not email or "@" not in email:
            raise HTTPException(status_code=400, detail="Enter a valid email.")
        token = secrets.token_urlsafe(32)
        is_guest = req.invited_role == "professional_guest"
        expires = (_now() + timedelta(days=GUEST_TTL_DAYS if is_guest else INVITE_TTL_DAYS)).isoformat()
        scope_cfg = {"scope_type": req.scope_type, "scope_id": req.scope_id} if req.scope_type else None
        # dedupe: update existing pending invite for same email/role instead of piling up
        existing = await _db.collab_invites.find_one({"property_id": pid, "invited_email": email, "status": "pending"}, {"_id": 0})
        if existing:
            await _db.collab_invites.update_one({"id": existing["id"]}, {"$set": {
                "invited_role": req.invited_role, "scope_configuration": scope_cfg,
                "invite_token_hash": _hash(token), "expires_at": expires, "created_at": _iso()}})
            invite_id = existing["id"]
        else:
            invite_id = _nid()
            await _db.collab_invites.insert_one({
                "id": invite_id, "property_id": pid, "invited_email": email, "invited_role": req.invited_role,
                "scope_configuration": scope_cfg, "invite_token_hash": _hash(token), "status": "pending",
                "expires_at": expires, "invited_by_user_id": user["id"], "created_at": _iso()})
        await _audit(pid, user["id"], "invitation_created", "invite", invite_id, None, {"email": email, "role": req.invited_role})
        await _cap(user, "collaboration_invite_created", {"role": req.invited_role})
        return {"invite_id": invite_id, "invite_token": token, "invited_role": req.invited_role,
                "role_label": ROLE_LABEL.get(req.invited_role), "expires_at": expires,
                "accept_path": f"/home-intel/collab/accept?token={token}"}

    @r.post("/invites/{invite_id}/revoke")
    async def revoke_invite(invite_id: str, user: dict = Depends(get_current_user)):
        inv = await _db.collab_invites.find_one({"id": invite_id}, {"_id": 0})
        if not inv or not await is_owner(inv["property_id"], user["id"]):
            raise HTTPException(status_code=404, detail="Invitation not found.")
        await _db.collab_invites.update_one({"id": invite_id}, {"$set": {"status": "revoked"}})
        await _audit(inv["property_id"], user["id"], "invitation_revoked", "invite", invite_id)
        return {"ok": True}

    @r.post("/invites/accept")
    async def accept_invite(req: AcceptReq, user: dict = Depends(get_current_user)):
        inv = await _db.collab_invites.find_one({"invite_token_hash": _hash(req.invite_token)}, {"_id": 0})
        if not inv or inv["status"] != "pending":
            raise HTTPException(status_code=400, detail="This invitation is no longer active.")
        if inv["expires_at"] < _iso():
            await _db.collab_invites.update_one({"id": inv["id"]}, {"$set": {"status": "expired"}})
            raise HTTPException(status_code=400, detail="This invitation is no longer active.")
        pid = inv["property_id"]
        if await is_owner(pid, user["id"]):
            raise HTTPException(status_code=400, detail="You already own this property.")
        is_guest = inv["invited_role"] == "professional_guest"
        member_expires = inv["expires_at"] if is_guest else None
        existing = await _db.prop_members.find_one({"property_id": pid, "user_id": user["id"]}, {"_id": 0})
        if existing:
            await _db.prop_members.update_one({"id": existing["id"]}, {"$set": {
                "role": inv["invited_role"], "status": "active", "accepted_at": _iso(), "expires_at": member_expires}})
            member_id = existing["id"]
        else:
            member_id = _nid()
            await _db.prop_members.insert_one({
                "id": member_id, "property_id": pid, "user_id": user["id"], "role": inv["invited_role"],
                "status": "active", "invited_by_user_id": inv["invited_by_user_id"], "invited_at": inv["created_at"],
                "accepted_at": _iso(), "removed_at": None, "expires_at": member_expires,
                "scope_configuration": inv.get("scope_configuration")})
        await _db.collab_invites.update_one({"id": inv["id"]}, {"$set": {"status": "accepted"}})
        await _audit(pid, user["id"], "invitation_accepted", "member", member_id, None, {"role": inv["invited_role"]})
        await _activity(pid, user["id"], "joined_property")
        await _cap(user, "collaboration_invite_accepted", {"role": inv["invited_role"]})
        p = await _property(pid)
        return {"ok": True, "property_id": pid, "property_name": (p or {}).get("nickname") or (p or {}).get("name"),
                "role": inv["invited_role"], "role_label": ROLE_LABEL.get(inv["invited_role"])}

    @r.put("/members/{member_id}/role")
    async def change_role(member_id: str, req: RoleReq, user: dict = Depends(get_current_user)):
        m = await _db.prop_members.find_one({"id": member_id}, {"_id": 0})
        if not m or not await is_owner(m["property_id"], user["id"]):
            raise HTTPException(status_code=404, detail="Member not found.")
        if req.role not in ROLES or req.role == "owner":
            raise HTTPException(status_code=400, detail="Invalid role.")
        await _db.prop_members.update_one({"id": member_id}, {"$set": {"role": req.role}})
        await _audit(m["property_id"], user["id"], "role_changed", "member", member_id, {"role": m["role"]}, {"role": req.role})
        await _cap(user, "role_changed", {"role": req.role})
        return {"ok": True, "role": req.role}

    @r.post("/members/{member_id}/remove")
    async def remove_member(member_id: str, user: dict = Depends(get_current_user)):
        m = await _db.prop_members.find_one({"id": member_id}, {"_id": 0})
        if not m or not await is_owner(m["property_id"], user["id"]):
            raise HTTPException(status_code=404, detail="Member not found.")
        await _db.prop_members.update_one({"id": member_id}, {"$set": {"status": "removed", "removed_at": _iso()}})
        await _audit(m["property_id"], user["id"], "access_revoked", "member", member_id, {"role": m["role"]}, {"status": "removed"})
        await _cap(user, "collaborator_removed", {})
        return {"ok": True}

    # ---- activity / audit
    @r.get("/properties/{pid}/activity")
    async def activity(pid: str, user: dict = Depends(get_current_user)):
        if not await check_access(pid, user["id"], "property.view"):
            raise HTTPException(status_code=403, detail="You do not have access to this item.")
        rows = await _db.collab_activity.find({"property_id": pid, "visibility": "collaborators"}, {"_id": 0}).sort("created_at", -1).to_list(50)
        out = []
        for a in rows:
            u = await _db.users.find_one({"id": a["actor_user_id"]}, {"_id": 0, "name": 1, "email": 1}) or {}
            out.append({**a, "actor_name": u.get("name") or (u.get("email") or "Someone").split("@")[0]})
        return {"activity": out}

    @r.get("/properties/{pid}/audit")
    async def audit_log(pid: str, user: dict = Depends(get_current_user)):
        if not await is_owner(pid, user["id"]):
            raise HTTPException(status_code=403, detail="Only the owner can view the audit log.")
        rows = await _db.collab_audit.find({"property_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(200)
        return {"audit": rows}

    # ---- assignments
    @r.post("/assign")
    async def assign(req: AssignReq, user: dict = Depends(get_current_user)):
        if not await is_owner(req.property_id, user["id"]) and not await check_access(req.property_id, user["id"], "project.edit"):
            raise HTTPException(status_code=403, detail="You cannot assign work on this property.")
        a = {"id": _nid(), "property_id": req.property_id, "task_entity_type": req.task_entity_type,
             "task_entity_id": req.task_entity_id, "assigned_to_user_id": req.assigned_to_user_id,
             "assigned_by_user_id": user["id"], "status": "assigned", "due_date": req.due_date, "created_at": _iso()}
        await _db.task_assignments.insert_one(dict(a))
        await _activity(req.property_id, user["id"], "assigned_task", req.task_entity_type, req.task_entity_id)
        await _cap(user, "task_assigned", {"entity_type": req.task_entity_type})
        a.pop("_id", None)
        return a

    @r.get("/properties/{pid}/assignments")
    async def list_assignments(pid: str, user: dict = Depends(get_current_user)):
        if not await check_access(pid, user["id"], "property.view"):
            raise HTTPException(status_code=403, detail="You do not have access to this item.")
        rows = await _db.task_assignments.find({"property_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(200)
        return {"assignments": rows}

    @r.get("/my-assignments")
    async def my_assignments(user: dict = Depends(get_current_user)):
        rows = await _db.task_assignments.find({"assigned_to_user_id": user["id"], "status": {"$in": ["assigned", "accepted"]}}, {"_id": 0}).sort("created_at", -1).to_list(200)
        return {"assignments": rows}

    @r.post("/assignments/{aid}/respond")
    async def respond_assignment(aid: str, req: AssignRespondReq, user: dict = Depends(get_current_user)):
        a = await _db.task_assignments.find_one({"id": aid}, {"_id": 0})
        if not a:
            raise HTTPException(status_code=404, detail="Assignment not found.")
        # assignee can accept/decline/complete; owner/manager can also update
        can = a["assigned_to_user_id"] == user["id"] or await is_owner(a["property_id"], user["id"])
        if not can:
            raise HTTPException(status_code=403, detail="You cannot change this assignment.")
        if req.status not in ("accepted", "declined", "completed"):
            raise HTTPException(status_code=400, detail="Invalid status.")
        await _db.task_assignments.update_one({"id": aid}, {"$set": {"status": req.status}})
        return {"ok": True, "status": req.status}

    return r
