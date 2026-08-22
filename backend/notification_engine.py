"""
DIYhomie — Notification, Reminder & Communication Orchestration (Build Blueprint 28).

Additive orchestration layer over the existing reminders/push/email engines. Owns the
provider-independent parts: the in-app inbox, per-category/channel preferences + marketing
consent, a priority model (emergency/high/normal/low/marketing), the Eligibility Engine
(consent, quiet hours, frequency caps, dedupe, admin category enable, safety override),
a template composer (versioned, approval-gated), and full delivery tracking + audit.

Other engines call `notify(...)` to emit a contextual, permission-aware communication.
Safety/emergency messages bypass marketing prefs & quiet hours; marketing requires opt-in.
The in-app inbox is the always-available fallback and is never blocked by provider failures.

Collections: notif_events, notif_templates, notif_preferences, notif_deliveries,
notif_suppressions, notif_inbox, notif_settings.
"""
import uuid
from datetime import datetime, timezone, timedelta
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

CATEGORIES = ["safety", "maintenance", "project", "document", "collaboration", "billing", "rewards", "account", "product", "marketing"]
CHANNELS = ["in_app", "push", "email"]
PRIORITIES = ["emergency", "high", "normal", "low", "marketing"]
CATEGORY_PRIORITY = {"safety": "emergency", "billing": "high", "account": "high", "maintenance": "normal",
                     "project": "normal", "document": "normal", "collaboration": "normal",
                     "rewards": "low", "product": "low", "marketing": "marketing"}
# marketing is opt-out-by-default OFF; everything else defaults on per channel
DEFAULT_OFF = {"marketing"}
DELIVERY_STATES = ["queued", "sent", "delivered", "opened", "clicked", "failed", "suppressed", "expired", "cancelled"]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


async def _cap(user_id, event, props=None):
    try:
        import analytics_engine
        await analytics_engine.capture({"id": user_id}, event, props or {})
    except Exception:
        pass


def _sentry(event_type, message):
    try:
        import sentry_sdk
        sentry_sdk.capture_message(f"[notif:{event_type}] {message}", level="error")
    except Exception:
        pass


async def _settings() -> dict:
    s = await _db.notif_settings.find_one({"id": "singleton"}, {"_id": 0})
    if not s:
        s = {"id": "singleton", "categories_enabled": {c: True for c in CATEGORIES},
             "daily_cap_normal": 6, "weekly_cap_normal": 25,
             "quiet_hours_start": 22, "quiet_hours_end": 7,
             "pause_nonessential": False, "updated_at": _now()}
        await _db.notif_settings.insert_one(dict(s)); s.pop("_id", None)
    return s


async def _prefs(user_id: str) -> dict:
    """Return {category: {channel: enabled}} plus quiet hours + marketing consent, defaulting sensibly."""
    rows = await _db.notif_preferences.find({"user_id": user_id}, {"_id": 0}).to_list(200)
    by = {(r["category"], r["channel"]): r for r in rows}
    matrix = {}
    for c in CATEGORIES:
        matrix[c] = {}
        for ch in CHANNELS:
            r = by.get((c, ch))
            if r is not None:
                matrix[c][ch] = r["enabled"]
            else:
                matrix[c][ch] = (c not in DEFAULT_OFF)
    consent_row = await _db.notif_preferences.find_one({"user_id": user_id, "category": "marketing", "channel": "in_app"}, {"_id": 0})
    marketing_consent = bool(consent_row["enabled"]) if consent_row else False
    return {"matrix": matrix, "marketing_consent": marketing_consent}


def _in_quiet_hours(s: dict) -> bool:
    h = datetime.now(timezone.utc).hour
    start, end = s.get("quiet_hours_start", 22), s.get("quiet_hours_end", 7)
    if start == end:
        return False
    if start < end:
        return start <= h < end
    return h >= start or h < end  # wraps midnight


# ============================================================= public helper
async def notify(user_id: str, category: str, event_type: str, title: str, body: str,
                 priority: Optional[str] = None, related_entity_type: Optional[str] = None,
                 related_entity_id: Optional[str] = None, deep_link: Optional[str] = None,
                 channels: Optional[list] = None) -> dict:
    """Emit a contextual communication. Always creates an in-app inbox item when eligible;
    push/email are best-effort. Returns a summary of deliveries + suppressions."""
    if _db is None:
        return {"skipped": True}
    try:
        if category not in CATEGORIES:
            category = "account"
        priority = priority if priority in PRIORITIES else CATEGORY_PRIORITY.get(category, "normal")
        s = await _settings()
        is_safety = priority == "emergency"
        # admin category gate (safety overrides)
        if not is_safety and not s["categories_enabled"].get(category, True):
            await _suppress(user_id, category, "admin_pause")
            return {"suppressed": "admin_pause"}
        if not is_safety and s.get("pause_nonessential") and priority in ("low", "marketing"):
            await _suppress(user_id, category, "admin_pause")
            return {"suppressed": "admin_pause"}

        event = {"id": _nid(), "user_id": user_id, "event_type": event_type, "priority": priority,
                 "category": category, "related_entity_type": related_entity_type,
                 "related_entity_id": related_entity_id, "created_at": _now()}
        await _db.notif_events.insert_one(dict(event))
        await _cap(user_id, "notification_created", {"category": category, "priority": priority})

        prefs = await _prefs(user_id)
        target_channels = channels or CHANNELS
        deliveries = []
        suppressions = []
        for ch in target_channels:
            # consent / preference
            allowed = prefs["matrix"].get(category, {}).get(ch, True)
            if category == "marketing" and not prefs["marketing_consent"]:
                allowed = False
            if is_safety and ch == "in_app":
                allowed = True  # safety always reaches the inbox
            if not allowed:
                suppressions.append((ch, "user_opt_out")); continue
            # quiet hours (normal/low/marketing) — passive in_app still allowed
            if priority in ("normal", "low", "marketing") and ch != "in_app" and _in_quiet_hours(s):
                suppressions.append((ch, "quiet_hours")); continue
            # dedupe (non-safety): same event+entity+channel in last 24h
            if not is_safety:
                since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
                dup = await _db.notif_deliveries.find_one({
                    "user_id": user_id, "event_type": event_type, "related_entity_id": related_entity_id,
                    "channel": ch, "created_at": {"$gte": since}, "status": {"$nin": ["failed", "suppressed"]}})
                if dup:
                    suppressions.append((ch, "duplicate")); continue
            # frequency cap (normal only)
            if priority == "normal":
                day = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
                n = await _db.notif_deliveries.count_documents({"user_id": user_id, "priority": "normal",
                                                                "channel": ch, "created_at": {"$gte": day},
                                                                "status": {"$nin": ["suppressed", "failed"]}})
                if n >= s["daily_cap_normal"]:
                    suppressions.append((ch, "frequency_cap")); continue

            delivery = {"id": _nid(), "notification_event_id": event["id"], "user_id": user_id,
                        "event_type": event_type, "category": category, "priority": priority,
                        "channel": ch, "status": "queued", "provider_reference": None,
                        "scheduled_at": _now(), "sent_at": None, "opened_at": None, "created_at": _now()}
            # deliver
            if ch == "in_app":
                delivery["status"] = "delivered"
                await _db.notif_inbox.insert_one({
                    "id": _nid(), "user_id": user_id, "notification_delivery_id": delivery["id"],
                    "title": title[:140], "body": body[:1000], "priority": priority, "category": category,
                    "related_entity_type": related_entity_type, "related_entity_id": related_entity_id,
                    "deep_link": deep_link, "read_at": None, "archived_at": None,
                    "expires_at": None, "created_at": _now()})
            elif ch == "push":
                ok = await _try_push(user_id, title, body, priority)
                delivery["status"] = "sent" if ok else "failed"
            elif ch == "email":
                # email delivery requires SES (dormant) — record queued so it flushes when configured
                delivery["status"] = "queued"
            await _db.notif_deliveries.insert_one(dict(delivery))
            deliveries.append({"channel": ch, "status": delivery["status"], "id": delivery["id"]})
            if delivery["status"] in ("sent", "delivered"):
                await _cap(user_id, "notification_sent", {"channel": ch, "category": category})

        for ch, reason in suppressions:
            await _suppress(user_id, category, reason, channel=ch)
        return {"event_id": event["id"], "deliveries": deliveries,
                "suppressed": [{"channel": c, "reason": r} for c, r in suppressions]}
    except Exception as e:
        _sentry("notification_provider_failure", str(e))
        if _logger:
            _logger.error(f"notify failed: {e}")
        return {"error": True}


async def _suppress(user_id, category, reason, channel=None):
    await _db.notif_suppressions.insert_one({
        "id": _nid(), "user_id": user_id, "category": category, "channel": channel,
        "reason": reason, "expires_at": None, "created_at": _now()})


async def _try_push(user_id, title, body, priority) -> bool:
    try:
        import push_engine
        # do not leak private property details on lock screen for non-safety by default
        safe_body = body if priority == "emergency" else (body[:80])
        await push_engine.send_push([user_id], {"title": title[:60], "body": safe_body}, idempotency_key=_nid())
        return True
    except Exception:
        return False


# ============================================================= models
class PrefReq(BaseModel):
    category: str
    channel: str
    enabled: bool
    quiet_hours_start: Optional[int] = None
    quiet_hours_end: Optional[int] = None


class ConsentReq(BaseModel):
    enabled: bool


class TestReq(BaseModel):
    category: str = "product"


class SnoozeReq(BaseModel):
    option: str = "tomorrow"   # tonight | tomorrow | weekend | next_week | custom
    until: Optional[str] = None


# ============================================================= user router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/notifications", dependencies=[Depends(get_current_user)])

    @r.get("/inbox")
    async def inbox(category: Optional[str] = None, unread: bool = False, user: dict = Depends(get_current_user)):
        flt = {"user_id": user["id"], "archived_at": None,
               "$or": [{"snoozed_until": None}, {"snoozed_until": {"$exists": False}}, {"snoozed_until": {"$lte": _now()}}]}
        if category in CATEGORIES:
            flt["category"] = category
        if unread:
            flt["read_at"] = None
        items = await _db.notif_inbox.find(flt, {"_id": 0}).sort("created_at", -1).to_list(200)
        unread_count = await _db.notif_inbox.count_documents({"user_id": user["id"], "archived_at": None, "read_at": None})
        await _cap(user["id"], "inbox_opened", {})
        return {"items": items, "unread_count": unread_count}

    @r.post("/inbox/{iid}/snooze")
    async def snooze(iid: str, req: SnoozeReq, user: dict = Depends(get_current_user)):
        """Doc 61 — postpone a non-critical reminder."""
        item = await _db.notif_inbox.find_one({"id": iid, "user_id": user["id"]}, {"_id": 0, "category": 1})
        if not item:
            raise HTTPException(status_code=404, detail="Not found.")
        if item.get("category") == "safety":
            raise HTTPException(status_code=409, detail="Safety notifications can't be snoozed.")
        now = datetime.now(timezone.utc)
        if req.option == "tonight":
            until = now.replace(hour=19, minute=0, second=0, microsecond=0)
            if until <= now:
                until = now + timedelta(hours=4)
        elif req.option == "tomorrow":
            until = (now + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
        elif req.option == "weekend":
            days_ahead = (5 - now.weekday()) % 7 or 7  # next Saturday
            until = (now + timedelta(days=days_ahead)).replace(hour=9, minute=0, second=0, microsecond=0)
        elif req.option == "next_week":
            until = (now + timedelta(days=7)).replace(hour=9, minute=0, second=0, microsecond=0)
        elif req.option == "custom" and req.until:
            try:
                until = datetime.fromisoformat(req.until.replace("Z", "+00:00"))
            except Exception:
                raise HTTPException(status_code=400, detail="Invalid custom date.")
        else:
            raise HTTPException(status_code=400, detail="Pick tonight, tomorrow, weekend, next_week or custom.")
        await _db.notif_inbox.update_one({"id": iid}, {"$set": {"snoozed_until": until.isoformat()}})
        await _cap(user["id"], "notification_snoozed", {"category": item.get("category"), "option": req.option})
        return {"ok": True, "snoozed_until": until.isoformat()}

    @r.get("/briefing")
    async def daily_briefing(user: dict = Depends(get_current_user)):
        """Doc 61 — concise 'Today with Homie' briefing: never a cluttered dashboard."""
        hour = datetime.now(timezone.utc).hour
        greeting = "Good morning" if 5 <= hour < 12 else ("Good afternoon" if 12 <= hour < 18 else "Good evening")
        name = (user.get("name") or "").split(" ")[0] or None
        items = []
        # 1. safety first — unread safety notifications
        safety = await _db.notif_inbox.find_one({"user_id": user["id"], "category": "safety", "read_at": None,
                                                 "archived_at": None}, {"_id": 0, "title": 1, "deep_link": 1})
        if safety:
            items.append({"kind": "safety", "text": safety.get("title") or "A safety item needs your attention.",
                          "route": safety.get("deep_link") or "/home-intel/inbox"})
        # 2. professional responses waiting
        pro = await _db.pcx_handoffs.find_one({"user_id": user["id"], "status": "professional_responded",
                                               "recommendation_decision": None}, {"_id": 0, "project_id": 1})
        if pro:
            items.append({"kind": "professional", "text": "A professional responded to your help request.",
                          "route": f"/home-intel/projects/pro-help?id={pro['project_id']}"})
        # 3. maintenance due
        today = datetime.now(timezone.utc).date().isoformat()
        due = await _db.hi_maintenance_tasks.find(
            {"user_id": user["id"], "status": "active", "due_date": {"$lte": today}},
            {"_id": 0, "id": 1, "title": 1}).sort("due_date", 1).to_list(2)
        for t in due:
            items.append({"kind": "maintenance", "text": f"{t['title']} is due.",
                          "route": f"/home-intel/maintenance/{t['id']}"})
        # 4. active project continuation
        proj = await _db.hi_projects.find_one({"user_id": user["id"], "status": "active"},
                                              {"_id": 0, "id": 1, "title": 1}, sort=[("updated_at", -1)])
        if proj:
            step = await _db.hi_project_steps.find_one({"project_id": proj["id"], "status": "active"},
                                                       {"_id": 0, "instruction": 1})
            txt = f"{proj['title']} is ready to continue" + (f" — next: {step['instruction'][:80]}" if step else "")
            items.append({"kind": "project", "text": txt, "route": f"/home-intel/projects/{proj['id']}"})
        # 5. materials waiting (ordered but not delivered)
        if proj:
            ordered = await _db.hi_project_materials.count_documents({"project_id": proj["id"], "user_status": "ordered"})
            if ordered:
                items.append({"kind": "delivery", "text": f"{ordered} ordered item(s) to check on for {proj['title']}.",
                              "route": f"/home-intel/projects/materials?id={proj['id']}"})
        await _cap(user["id"], "daily_briefing_generated", {"item_count": len(items)})
        return {"greeting": f"{greeting}{', ' + name if name else ''}.",
                "items": items[:4],
                "empty_message": None if items else "Nothing pressing today — your home is in good shape."}


    @r.get("/unread-count")
    async def unread_count(user: dict = Depends(get_current_user)):
        return {"unread_count": await _db.notif_inbox.count_documents({"user_id": user["id"], "archived_at": None, "read_at": None})}

    @r.post("/inbox/{iid}/read")
    async def mark_read(iid: str, user: dict = Depends(get_current_user)):
        res = await _db.notif_inbox.update_one({"id": iid, "user_id": user["id"]}, {"$set": {"read_at": _now()}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Not found.")
        return {"ok": True}

    @r.post("/inbox/read-all")
    async def read_all(user: dict = Depends(get_current_user)):
        await _db.notif_inbox.update_many({"user_id": user["id"], "read_at": None}, {"$set": {"read_at": _now()}})
        return {"ok": True}

    @r.post("/inbox/{iid}/archive")
    async def archive(iid: str, user: dict = Depends(get_current_user)):
        res = await _db.notif_inbox.update_one({"id": iid, "user_id": user["id"]}, {"$set": {"archived_at": _now()}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Not found.")
        return {"ok": True}

    @r.post("/inbox/{iid}/open")
    async def open_item(iid: str, user: dict = Depends(get_current_user)):
        item = await _db.notif_inbox.find_one({"id": iid, "user_id": user["id"]}, {"_id": 0})
        if not item:
            raise HTTPException(status_code=404, detail="Not found.")
        # validate the user still has access to the related entity (best-effort per type)
        ok = await _validate_access(user["id"], item.get("related_entity_type"), item.get("related_entity_id"))
        await _db.notif_inbox.update_one({"id": iid}, {"$set": {"read_at": item.get("read_at") or _now()}})
        await _db.notif_deliveries.update_one({"id": item["notification_delivery_id"]},
                                              {"$set": {"status": "clicked", "opened_at": _now()}})
        await _cap(user["id"], "notification_clicked", {"category": item.get("category")})
        if not ok:
            _sentry("deep_link_failure", f"{item.get('related_entity_type')}:{item.get('related_entity_id')}")
            return {"deep_link": None, "access": False, "message": "You no longer have access to this item."}
        return {"deep_link": item.get("deep_link"), "access": True}

    @r.get("/preferences")
    async def preferences(user: dict = Depends(get_current_user)):
        p = await _prefs(user["id"])
        s = await _settings()
        return {"matrix": p["matrix"], "marketing_consent": p["marketing_consent"],
                "categories": CATEGORIES, "channels": CHANNELS,
                "quiet_hours": {"start": s["quiet_hours_start"], "end": s["quiet_hours_end"]},
                "essential": ["safety", "billing", "account"]}

    @r.put("/preferences")
    async def set_pref(req: PrefReq, user: dict = Depends(get_current_user)):
        if req.category not in CATEGORIES or req.channel not in CHANNELS:
            raise HTTPException(status_code=400, detail="Invalid category or channel.")
        if req.category == "safety" and not req.enabled:
            raise HTTPException(status_code=400, detail="Safety alerts can't be turned off.")
        upd = {"enabled": req.enabled, "updated_at": _now()}
        if req.quiet_hours_start is not None:
            upd["quiet_hours_start"] = req.quiet_hours_start
        if req.quiet_hours_end is not None:
            upd["quiet_hours_end"] = req.quiet_hours_end
        await _db.notif_preferences.update_one(
            {"user_id": user["id"], "category": req.category, "channel": req.channel},
            {"$set": upd, "$setOnInsert": {"id": _nid(), "user_id": user["id"], "category": req.category,
                                           "channel": req.channel, "created_at": _now()}}, upsert=True)
        await _cap(user["id"], "notification_preference_changed", {"category": req.category, "channel": req.channel, "enabled": req.enabled})
        return await _prefs(user["id"])

    @r.post("/preferences/marketing-consent")
    async def marketing_consent(req: ConsentReq, user: dict = Depends(get_current_user)):
        for ch in CHANNELS:
            await _db.notif_preferences.update_one(
                {"user_id": user["id"], "category": "marketing", "channel": ch},
                {"$set": {"enabled": req.enabled, "updated_at": _now()},
                 "$setOnInsert": {"id": _nid(), "user_id": user["id"], "category": "marketing", "channel": ch, "created_at": _now()}},
                upsert=True)
        await _cap(user["id"], "notification_preference_changed", {"category": "marketing", "enabled": req.enabled})
        return {"marketing_consent": req.enabled}

    @r.post("/test")
    async def test(req: TestReq, user: dict = Depends(get_current_user)):
        res = await notify(user["id"], req.category if req.category in CATEGORIES else "product",
                           "test_notification", "This is a test notification",
                           "If you can see this in your inbox, notifications are working.", channels=["in_app"])
        return {"ok": True, "result": res}

    return r


async def _validate_access(user_id, etype, eid) -> bool:
    if not etype or not eid:
        return True
    try:
        coll = {"project": "hi_projects", "asset": "hi_assets", "room": "hi_rooms",
                "document": "hi_documents", "maintenance_task": "hi_maintenance_tasks",
                "redemption": "reward_redemptions", "exit_case": "asset_exit_cases"}.get(etype)
        if not coll:
            return True
        doc = await _db[coll].find_one({"id": eid}, {"_id": 0, "user_id": 1, "property_id": 1})
        if not doc:
            return False
        if doc.get("user_id") and doc["user_id"] == user_id:
            return True
        if doc.get("property_id"):
            prop = await _db.hi_properties.find_one({"id": doc["property_id"]}, {"_id": 0, "user_id": 1})
            if prop and prop.get("user_id") == user_id:
                return True
            # shared access
            try:
                mem = await _db.prop_members.find_one({"property_id": doc["property_id"], "user_id": user_id, "status": "active"})
            except Exception:
                mem = None
            return bool(mem)
        return True
    except Exception:
        return True


# ============================================================= admin router
class SettingsReq(BaseModel):
    daily_cap_normal: Optional[int] = None
    weekly_cap_normal: Optional[int] = None
    quiet_hours_start: Optional[int] = None
    quiet_hours_end: Optional[int] = None
    pause_nonessential: Optional[bool] = None


class CategoryToggleReq(BaseModel):
    category: str
    enabled: bool


class TemplateReq(BaseModel):
    template_key: str
    category: str
    title_template: str
    body_template: str
    deep_link_template: Optional[str] = None


class TemplateStatusReq(BaseModel):
    status: str  # approved | active | archived | draft


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/notifications", dependencies=[Depends(require_admin)])

    @r.get("/settings")
    async def get_settings(admin: dict = Depends(require_admin)):
        return await _settings()

    @r.put("/settings")
    async def put_settings(req: SettingsReq, admin: dict = Depends(require_admin)):
        upd = {k: v for k, v in req.dict().items() if v is not None}
        if upd:
            upd["updated_at"] = _now()
            await _db.notif_settings.update_one({"id": "singleton"}, {"$set": upd}, upsert=True)
        return await _settings()

    @r.put("/categories")
    async def toggle_category(req: CategoryToggleReq, admin: dict = Depends(require_admin)):
        if req.category not in CATEGORIES:
            raise HTTPException(status_code=400, detail="Unknown category.")
        if req.category == "safety" and not req.enabled:
            raise HTTPException(status_code=400, detail="Safety notifications can't be disabled.")
        s = await _settings()
        cats = s["categories_enabled"]; cats[req.category] = req.enabled
        await _db.notif_settings.update_one({"id": "singleton"}, {"$set": {"categories_enabled": cats, "updated_at": _now()}})
        return {"categories_enabled": cats}

    @r.get("/templates")
    async def list_templates(admin: dict = Depends(require_admin)):
        return {"templates": await _db.notif_templates.find({}, {"_id": 0}).sort("category", 1).to_list(200)}

    @r.post("/templates")
    async def create_template(req: TemplateReq, admin: dict = Depends(require_admin)):
        if req.category not in CATEGORIES:
            raise HTTPException(status_code=400, detail="Unknown category.")
        existing = await _db.notif_templates.find_one({"template_key": req.template_key}, {"_id": 0})
        version = (existing.get("version", 1) + 1) if existing else 1
        if existing:  # version snapshot
            await _db.notif_template_versions.insert_one({**{k: v for k, v in existing.items()}, "snapshot_id": _nid(), "snapshot_at": _now()})
        doc = {"id": existing["id"] if existing else _nid(), "template_key": req.template_key, "category": req.category,
               "title_template": req.title_template, "body_template": req.body_template,
               "deep_link_template": req.deep_link_template, "version": version,
               "status": "draft", "requires_approval": req.category in ("safety", "billing", "marketing"),
               "created_at": existing["created_at"] if existing else _now(), "updated_at": _now()}
        await _db.notif_templates.update_one({"template_key": req.template_key}, {"$set": doc}, upsert=True)
        return {"template": doc}

    @r.put("/templates/{tid}/status")
    async def template_status(tid: str, req: TemplateStatusReq, admin: dict = Depends(require_admin)):
        if req.status not in ("approved", "active", "archived", "draft"):
            raise HTTPException(status_code=400, detail="Invalid status.")
        t = await _db.notif_templates.find_one({"id": tid}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Template not found.")
        if req.status == "active" and t.get("requires_approval") and t.get("status") not in ("approved", "active"):
            raise HTTPException(status_code=409, detail="This template must be approved before it can go active.")
        await _db.notif_templates.update_one({"id": tid}, {"$set": {"status": req.status, "updated_at": _now()}})
        return {"ok": True, "status": req.status}

    @r.get("/dashboard")
    async def dashboard(admin: dict = Depends(require_admin)):
        async def _c(st):
            return await _db.notif_deliveries.count_documents({"status": st})
        by_status = {st: await _c(st) for st in DELIVERY_STATES}
        total = await _db.notif_deliveries.count_documents({})
        opened = by_status.get("opened", 0) + by_status.get("clicked", 0)
        delivered = by_status.get("delivered", 0) + by_status.get("sent", 0) + opened
        agg = await _db.notif_deliveries.aggregate([{"$group": {"_id": "$category", "count": {"$sum": 1}}}]).to_list(50)
        by_category = {a["_id"]: a["count"] for a in agg}
        supp = await _db.notif_suppressions.aggregate([{"$group": {"_id": "$reason", "count": {"$sum": 1}}}]).to_list(50)
        return {"total_deliveries": total, "by_status": by_status, "by_category": by_category,
                "open_rate": round(opened / delivered * 100, 1) if delivered else 0.0,
                "suppressions": {a["_id"]: a["count"] for a in supp},
                "failed": by_status.get("failed", 0), "settings": await _settings()}

    @r.post("/deliveries/{did}/retry")
    async def retry(did: str, admin: dict = Depends(require_admin)):
        d = await _db.notif_deliveries.find_one({"id": did}, {"_id": 0})
        if not d:
            raise HTTPException(status_code=404, detail="Delivery not found.")
        if d["status"] not in ("failed", "queued"):
            raise HTTPException(status_code=400, detail="Only failed/queued deliveries can be retried.")
        ok = False
        if d["channel"] == "push":
            item = await _db.notif_inbox.find_one({"notification_delivery_id": did}, {"_id": 0})
            ok = await _try_push(d["user_id"], (item or {}).get("title", "DIYhomie"), (item or {}).get("body", ""), d["priority"])
        await _db.notif_deliveries.update_one({"id": did}, {"$set": {"status": "sent" if ok else "failed", "sent_at": _now() if ok else None}})
        return {"ok": ok, "status": "sent" if ok else "failed"}

    return r


# ============================================================= seed
async def seed_notifications():
    if _db is None:
        return
    try:
        await _settings()
        if not await _db.notif_templates.find_one({}):
            seeds = [
                ("maintenance_due", "maintenance", "Maintenance due: {task}", "Your {task} is due {when}.", "/home-intel/maintenance", "active"),
                ("project_blocker", "project", "Project needs attention", "'{project}' has a blocker to resolve.", "/home-intel/projects/{project_id}", "active"),
                ("document_ready", "document", "Document ready to review", "'{doc}' finished processing and needs your review.", "/home-intel/documents/{doc_id}", "active"),
                ("collab_invite", "collaboration", "You've been invited", "{inviter} invited you to help with a home.", "/home-intel/collab/shared", "active"),
                ("reward_available", "rewards", "A reward is available", "You have enough points to redeem a reward.", "/home-intel/rewards/redemption", "active"),
                ("redemption_completed", "rewards", "Your reward is on its way", "Your {reward} redemption is complete.", "/home-intel/rewards/redemption", "active"),
                ("security_event", "account", "Security alert", "We noticed a new sign-in to your account.", "/settings/billing", "approved"),
                ("billing_action", "billing", "Billing needs attention", "There was a problem with your latest payment.", "/settings/billing", "approved"),
                ("safety_alert", "safety", "Safety alert", "Stop and review the safety guidance for your current task.", None, "approved"),
                ("product_update", "marketing", "What's new in DIYhomie", "Check out the latest features built for you.", "/home-intel", "draft"),
            ]
            for key, cat, tt, bt, dl, status in seeds:
                await _db.notif_templates.insert_one({
                    "id": _nid(), "template_key": key, "category": cat, "title_template": tt,
                    "body_template": bt, "deep_link_template": dl, "version": 1, "status": status,
                    "requires_approval": cat in ("safety", "billing", "marketing"),
                    "created_at": _now(), "updated_at": _now()})
        await _db.notif_inbox.create_index([("user_id", 1), ("created_at", -1)])
        await _db.notif_deliveries.create_index([("user_id", 1), ("created_at", -1)])
        if _logger:
            _logger.info("notifications (B28) seeded")
    except Exception as e:
        if _logger:
            _logger.error(f"notifications seed failed: {e}")
