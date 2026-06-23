"""
DIYhomie built-in autoresponder / email engine.

Self-hosted marketing + transactional email system (GetResponse/Mailchimp-style)
that costs $0 to run: the entire engine (contacts, templates, automations,
broadcasts, queue, scheduler, suppression, analytics) lives in our own MongoDB +
FastAPI. Only message *delivery* goes through Amazon SES (cheapest provider).

Design goals: one-person operation, graceful no-keys "draft mode", and a single
background scheduler loop that drains the queue, advances drip automations and
sends scheduled broadcasts while respecting the SES send rate.
"""
import os
import re
import json
import base64
import uuid
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Callable

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, RedirectResponse, PlainTextResponse
from pydantic import BaseModel

# ---------------------------------------------------------------- module state
_db = None
_logger = None
_segment_resolver: Optional[Callable] = None   # async (segment_name) -> [{user_id,email,name}]
_ses = None

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1").strip()
AWS_ACCESS_KEY_ID = os.environ.get("AWS_ACCESS_KEY_ID", "").strip()
AWS_SECRET_ACCESS_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY", "").strip()
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "DIYhomie <noreply@diyhomie.com>").strip()
CONFIGURATION_SET = os.environ.get("SES_CONFIGURATION_SET", "").strip()
APP_PUBLIC_URL = os.environ.get("APP_PUBLIC_URL", "https://step-by-step-diy.preview.emergentagent.com").strip().rstrip("/")
BACKEND_PUBLIC_URL = os.environ.get("BACKEND_PUBLIC_URL", APP_PUBLIC_URL).strip().rstrip("/")

TRANSACTIONAL_EVENTS = ["welcome", "purchase", "renewal", "ticket_reply"]


def configure(db, logger, segment_resolver: Callable):
    global _db, _logger, _segment_resolver
    _db = db
    _logger = logger
    _segment_resolver = segment_resolver


def keys_present() -> bool:
    return bool(AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY)


def _ses_client():
    global _ses
    if _ses is None and keys_present():
        import boto3
        _ses = boto3.client(
            "sesv2", region_name=AWS_REGION,
            aws_access_key_id=AWS_ACCESS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
        )
    return _ses


def _now():
    return datetime.now(timezone.utc)


def _iso(dt=None):
    return (dt or _now()).isoformat()


def _nid():
    return str(uuid.uuid4())


# ---------------------------------------------------------------- rendering
def render(text: str, vars: dict) -> str:
    if not text:
        return ""
    def repl(m):
        key = m.group(1).strip()
        val = vars.get(key)
        return str(val) if val is not None else ""
    return re.sub(r"\{\{\s*([\w_]+)\s*\}\}", repl, text)


def _b64(s: str) -> str:
    return base64.urlsafe_b64encode(s.encode()).decode().rstrip("=")


def _unb64(s: str) -> str:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode((s + pad).encode()).decode()


def _wrap_html(inner: str, unsubscribe_url: Optional[str], queue_id: Optional[str]) -> str:
    """Wrap body in a simple branded shell + tracking pixel + unsubscribe footer."""
    pixel = f'<img src="{BACKEND_PUBLIC_URL}/api/e/o/{queue_id}.png" width="1" height="1" alt="" style="display:none"/>' if queue_id else ""
    footer = ""
    if unsubscribe_url:
        footer = (
            f'<div style="margin-top:28px;padding-top:16px;border-top:1px solid #eee;'
            f'color:#999;font-size:12px;font-family:Arial,sans-serif">'
            f'DIYhomie · You are receiving this because you have an account.<br/>'
            f'<a href="{unsubscribe_url}" style="color:#999">Unsubscribe</a></div>'
        )
    return (
        '<div style="max-width:560px;margin:0 auto;padding:24px;font-family:Arial,Helvetica,sans-serif;'
        'color:#1c1c1e;font-size:15px;line-height:1.6">'
        '<div style="font-size:22px;font-weight:bold;color:#FF5A00;margin-bottom:16px">DIYhomie</div>'
        f'{inner}{footer}{pixel}</div>'
    )


def _vars_for_user(user: dict, ctx: dict) -> dict:
    email = (user or {}).get("email", "")
    v = {
        "name": (user or {}).get("name") or (email.split("@")[0] if email else "there"),
        "email": email,
        "plan": ((user or {}).get("subscription_tier") or "free").title(),
        "credits": (user or {}).get("credits", 0),
        "app_url": APP_PUBLIC_URL,
        "unsubscribe_url": f"{BACKEND_PUBLIC_URL}/api/e/u/{_b64(email)}" if email else APP_PUBLIC_URL,
    }
    v.update({k: ("" if val is None else val) for k, val in (ctx or {}).items()})
    return v


# ---------------------------------------------------------------- suppression
async def is_suppressed(email: str) -> bool:
    if not email:
        return True
    doc = await _db.email_suppression.find_one({"email": email.lower()})
    return bool(doc)


async def suppress(email: str, reason: str):
    if not email:
        return
    await _db.email_suppression.update_one(
        {"email": email.lower()},
        {"$set": {"email": email.lower(), "reason": reason, "at": _iso()}},
        upsert=True,
    )


# ---------------------------------------------------------------- queue + send
async def enqueue(to_email: str, to_user_id: Optional[str], subject: str, html: str,
                  kind: str = "transactional", campaign_id: Optional[str] = None,
                  scheduled_at: Optional[datetime] = None, marketing: bool = False,
                  unsubscribe_url: Optional[str] = None) -> Optional[str]:
    if not to_email:
        return None
    qid = _nid()
    body = _wrap_html(html, unsubscribe_url if marketing else None, qid)
    doc = {
        "id": qid,
        "to_email": to_email,
        "to_user_id": to_user_id,
        "subject": subject,
        "html": body,
        "kind": kind,
        "campaign_id": campaign_id,
        "status": "queued",
        "scheduled_at": _iso(scheduled_at or _now()),
        "created_at": _iso(),
        "sent_at": None,
        "message_id": None,
        "opened": False,
        "error": None,
    }
    await _db.email_queue.insert_one(doc)
    return qid


async def _log_event(queue_id, message_id, to_email, kind, event, meta=None):
    await _db.email_events.insert_one({
        "id": _nid(), "queue_id": queue_id, "message_id": message_id,
        "to_email": to_email, "kind": kind, "event": event,
        "at": _iso(), "meta": meta or {},
    })


async def _send_one(doc) -> bool:
    email = doc["to_email"]
    if await is_suppressed(email):
        await _db.email_queue.update_one({"id": doc["id"]}, {"$set": {"status": "skipped", "error": "suppressed"}})
        return False
    client = _ses_client()
    if not client:
        # No SES keys yet → leave queued in "draft mode" so nothing is lost.
        return False
    try:
        kwargs = dict(
            FromEmailAddress=SENDER_EMAIL,
            Destination={"ToAddresses": [email]},
            Content={"Simple": {
                "Subject": {"Data": doc["subject"]},
                "Body": {"Html": {"Data": doc["html"]}},
            }},
        )
        if CONFIGURATION_SET:
            kwargs["ConfigurationSetName"] = CONFIGURATION_SET
        resp = await asyncio.to_thread(lambda: client.send_email(**kwargs))
        mid = resp.get("MessageId")
        await _db.email_queue.update_one({"id": doc["id"]},
            {"$set": {"status": "sent", "sent_at": _iso(), "message_id": mid}})
        await _log_event(doc["id"], mid, email, doc["kind"], "sent")
        return True
    except Exception as e:
        msg = str(e)
        _logger.warning(f"SES send failed for {email}: {msg}")
        await _db.email_queue.update_one({"id": doc["id"]},
            {"$set": {"status": "failed", "error": msg[:300]}})
        await _log_event(doc["id"], None, email, doc["kind"], "failed", {"error": msg[:300]})
        return False


async def process_queue(limit: int = 15):
    if not keys_present():
        return 0
    now = _iso()
    cur = _db.email_queue.find({"status": "queued", "scheduled_at": {"$lte": now}}).sort("scheduled_at", 1).limit(limit)
    docs = await cur.to_list(limit)
    sent = 0
    for d in docs:
        ok = await _send_one(d)
        if ok:
            sent += 1
        await asyncio.sleep(0.15)   # stay under SES send-rate
    return sent


# ---------------------------------------------------------------- automations
async def _enroll(auto: dict, user: dict, vars: dict):
    steps = auto.get("steps") or []
    if not steps:
        return
    delay = int(steps[0].get("delay_minutes", 0))
    await _db.email_automation_runs.insert_one({
        "id": _nid(),
        "automation_id": auto["id"],
        "automation_name": auto.get("name"),
        "user_id": user.get("id"),
        "to_email": user.get("email"),
        "vars": vars,
        "step_index": 0,
        "next_step_at": _iso(_now() + timedelta(minutes=delay)),
        "active": True,
        "created_at": _iso(),
    })


async def process_automations(limit: int = 50):
    now = _iso()
    runs = await _db.email_automation_runs.find(
        {"active": True, "next_step_at": {"$lte": now}}).limit(limit).to_list(limit)
    for run in runs:
        auto = await _db.email_automations.find_one({"id": run["automation_id"]})
        if not auto or not auto.get("active"):
            await _db.email_automation_runs.update_one({"id": run["id"]}, {"$set": {"active": False}})
            continue
        steps = auto.get("steps") or []
        idx = run["step_index"]
        if idx >= len(steps):
            await _db.email_automation_runs.update_one({"id": run["id"]}, {"$set": {"active": False}})
            continue
        step = steps[idx]
        vars = run.get("vars") or {}
        await enqueue(
            run["to_email"], run.get("user_id"),
            render(step.get("subject", ""), vars), render(step.get("html", ""), vars),
            kind="automation", marketing=True, unsubscribe_url=vars.get("unsubscribe_url"),
        )
        nxt = idx + 1
        if nxt < len(steps):
            d = int(steps[nxt].get("delay_minutes", 0))
            await _db.email_automation_runs.update_one({"id": run["id"]},
                {"$set": {"step_index": nxt, "next_step_at": _iso(_now() + timedelta(minutes=d))}})
        else:
            await _db.email_automation_runs.update_one({"id": run["id"]},
                {"$set": {"step_index": nxt, "active": False}})


# ---------------------------------------------------------------- triggers
async def trigger_event(event: str, user: dict, ctx: dict = None):
    """Fire a transactional template (key==event) and enroll any automations
    whose trigger matches. Safe to call from anywhere; never raises."""
    try:
        if _db is None or not user or not user.get("email"):
            return
        if await is_suppressed(user["email"]):
            return
        vars = _vars_for_user(user, ctx or {})
        tpl = await _db.email_templates.find_one({"key": event, "active": True})
        if tpl:
            await enqueue(user["email"], user.get("id"),
                          render(tpl["subject"], vars), render(tpl["html"], vars),
                          kind="transactional")
        async for auto in _db.email_automations.find({"trigger": event, "active": True}):
            await _enroll(auto, user, vars)
    except Exception as e:
        if _logger:
            _logger.warning(f"trigger_event({event}) failed: {e}")


# ---------------------------------------------------------------- scheduler
_loop_started = False


async def scheduler_loop():
    global _loop_started
    if _loop_started:
        return
    _loop_started = True
    if _logger:
        _logger.info("email scheduler loop started")
    while True:
        try:
            await process_automations()
            await process_queue()
        except Exception as e:
            if _logger:
                _logger.warning(f"email scheduler tick error: {e}")
        await asyncio.sleep(30)


# ---------------------------------------------------------------- default templates
DEFAULT_TEMPLATES = [
    {"key": "welcome", "type": "transactional", "name": "Welcome on signup",
     "subject": "Welcome to DIYhomie, {{name}} 👋",
     "html": "<p>Hey {{name}},</p><p>Welcome to <b>DIYhomie</b> — it's like having a master contractor in your pocket. Your first full step-by-step guide is on the house.</p><p>Tell Homie what you want to fix, build or improve and get an expert, code-aware plan tailored to your tools and budget.</p><p><a href=\"{{app_url}}\" style=\"background:#FF5A00;color:#000;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold\">Start your first project</a></p><p>— Homie</p>"},
    {"key": "purchase", "type": "transactional", "name": "Plan purchase confirmation",
     "subject": "You're on DIYhomie {{plan}} 🎉",
     "html": "<p>Thanks {{name}}!</p><p>Your <b>{{plan}}</b> plan is active. You now have <b>{{credits}}</b> credits to put Homie to work.</p><p><a href=\"{{app_url}}\">Open DIYhomie</a></p>"},
    {"key": "renewal", "type": "transactional", "name": "Subscription renewal receipt",
     "subject": "Your DIYhomie {{plan}} plan renewed",
     "html": "<p>Hi {{name}},</p><p>Your <b>{{plan}}</b> subscription renewed successfully and your credits are topped up. Thanks for building with us!</p><p><a href=\"{{app_url}}\">Open DIYhomie</a></p>"},
    {"key": "ticket_reply", "type": "transactional", "name": "Support ticket reply",
     "subject": "Re: {{ticket_subject}}",
     "html": "<p>Hi {{name}},</p><p>{{reply_message}}</p><hr/><p style=\"color:#999;font-size:13px\">Your original message: {{ticket_subject}}</p><p>— DIYhomie Support</p>"},
]


async def seed_templates():
    try:
        for t in DEFAULT_TEMPLATES:
            await _db.email_templates.update_one(
                {"key": t["key"]},
                {"$setOnInsert": {
                    "id": _nid(), "key": t["key"], "name": t["name"], "type": t["type"],
                    "subject": t["subject"], "html": t["html"], "active": True,
                    "created_at": _iso(), "updated_at": _iso(),
                }},
                upsert=True,
            )
        await _db.email_queue.create_index([("status", 1), ("scheduled_at", 1)])
        await _db.email_automation_runs.create_index([("active", 1), ("next_step_at", 1)])
        await _db.email_events.create_index([("at", -1)])
        await _db.email_suppression.create_index("email", unique=True)
        if _logger:
            _logger.info("email templates seeded")
    except Exception as e:
        if _logger:
            _logger.warning(f"seed_templates: {e}")


# ---------------------------------------------------------------- models
class TemplateReq(BaseModel):
    name: str
    subject: str
    html: str
    type: str = "marketing"
    key: Optional[str] = None
    active: bool = True


class AutomationStep(BaseModel):
    delay_minutes: int = 0
    subject: str
    html: str


class AutomationReq(BaseModel):
    name: str
    trigger: str            # welcome | purchase | renewal | ticket_reply | manual
    active: bool = True
    steps: List[AutomationStep] = []


class CampaignReq(BaseModel):
    name: str
    segment: str
    subject: str
    html: str
    schedule_at: Optional[str] = None   # ISO; null = send now


class TestSendReq(BaseModel):
    to_email: str
    subject: str
    html: str


class SuppressReq(BaseModel):
    email: str
    reason: str = "manual"


# ---------------------------------------------------------------- admin router
def build_admin_router(require_admin) -> APIRouter:
    r = APIRouter(prefix="/api/admin/email", dependencies=[Depends(require_admin)])

    @r.get("/overview")
    async def overview():
        today = _now().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        total_sent = await _db.email_queue.count_documents({"status": "sent"})
        sent_today = await _db.email_queue.count_documents({"status": "sent", "sent_at": {"$gte": today}})
        queued = await _db.email_queue.count_documents({"status": "queued"})
        failed = await _db.email_queue.count_documents({"status": "failed"})
        opens = await _db.email_queue.count_documents({"opened": True})
        bounces = await _db.email_events.count_documents({"event": "bounce"})
        complaints = await _db.email_events.count_documents({"event": "complaint"})
        delivered = await _db.email_events.count_documents({"event": "delivery"})
        suppressed = await _db.email_suppression.count_documents({})
        active_automations = await _db.email_automations.count_documents({"active": True})
        open_rate = round((opens / total_sent) * 100, 1) if total_sent else 0.0
        return {
            "configured": keys_present(),
            "sender": SENDER_EMAIL,
            "region": AWS_REGION,
            "total_sent": total_sent, "sent_today": sent_today, "queued": queued,
            "failed": failed, "opens": opens, "open_rate": open_rate,
            "delivered": delivered, "bounces": bounces, "complaints": complaints,
            "suppressed": suppressed, "active_automations": active_automations,
        }

    # ---- templates
    @r.get("/templates")
    async def list_templates():
        return await _db.email_templates.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)

    @r.post("/templates")
    async def create_template(req: TemplateReq):
        doc = {"id": _nid(), **req.dict(), "created_at": _iso(), "updated_at": _iso()}
        await _db.email_templates.insert_one(dict(doc))
        doc.pop("_id", None)
        return doc

    @r.put("/templates/{tid}")
    async def update_template(tid: str, req: TemplateReq):
        upd = {**req.dict(), "updated_at": _iso()}
        res = await _db.email_templates.update_one({"id": tid}, {"$set": upd})
        if not res.matched_count:
            raise HTTPException(404, "Template not found")
        return await _db.email_templates.find_one({"id": tid}, {"_id": 0})

    @r.delete("/templates/{tid}")
    async def delete_template(tid: str):
        t = await _db.email_templates.find_one({"id": tid})
        if t and t.get("key") in TRANSACTIONAL_EVENTS:
            raise HTTPException(400, "Built-in transactional templates can't be deleted (you can edit or deactivate them).")
        await _db.email_templates.delete_one({"id": tid})
        return {"ok": True}

    # ---- automations
    @r.get("/automations")
    async def list_automations():
        autos = await _db.email_automations.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
        for a in autos:
            a["enrolled"] = await _db.email_automation_runs.count_documents({"automation_id": a["id"]})
            a["active_runs"] = await _db.email_automation_runs.count_documents({"automation_id": a["id"], "active": True})
        return autos

    @r.post("/automations")
    async def create_automation(req: AutomationReq):
        doc = {"id": _nid(), "name": req.name, "trigger": req.trigger, "active": req.active,
               "steps": [s.dict() for s in req.steps], "created_at": _iso()}
        await _db.email_automations.insert_one(dict(doc))
        doc.pop("_id", None)
        return doc

    @r.put("/automations/{aid}")
    async def update_automation(aid: str, req: AutomationReq):
        upd = {"name": req.name, "trigger": req.trigger, "active": req.active,
               "steps": [s.dict() for s in req.steps]}
        res = await _db.email_automations.update_one({"id": aid}, {"$set": upd})
        if not res.matched_count:
            raise HTTPException(404, "Automation not found")
        return await _db.email_automations.find_one({"id": aid}, {"_id": 0})

    @r.delete("/automations/{aid}")
    async def delete_automation(aid: str):
        await _db.email_automations.delete_one({"id": aid})
        await _db.email_automation_runs.update_many({"automation_id": aid}, {"$set": {"active": False}})
        return {"ok": True}

    # ---- campaigns (broadcasts to a CRM segment)
    @r.get("/segments")
    async def segments():
        # surface the same smart segments the CRM uses
        from_server = await _segment_resolver(None) if _segment_resolver else {}
        return from_server or {"segments": []}

    @r.get("/campaigns")
    async def list_campaigns():
        return await _db.email_campaigns.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)

    @r.post("/campaigns")
    async def create_campaign(req: CampaignReq):
        doc = {"id": _nid(), "name": req.name, "segment": req.segment, "subject": req.subject,
               "html": req.html, "status": "draft", "schedule_at": req.schedule_at,
               "created_at": _iso(), "sent_at": None, "stats": {"queued": 0, "sent": 0}}
        await _db.email_campaigns.insert_one(dict(doc))
        doc.pop("_id", None)
        return doc

    @r.post("/campaigns/{cid}/send")
    async def send_campaign(cid: str):
        camp = await _db.email_campaigns.find_one({"id": cid}, {"_id": 0})
        if not camp:
            raise HTTPException(404, "Campaign not found")
        if camp["status"] == "sent":
            raise HTTPException(400, "Campaign already sent")
        contacts = await _segment_resolver(camp["segment"]) if _segment_resolver else []
        if isinstance(contacts, dict):
            contacts = contacts.get("contacts", [])
        n = 0
        for c in contacts:
            email = c.get("email")
            if not email or await is_suppressed(email):
                continue
            vars = _vars_for_user(
                {"email": email, "name": c.get("name"), "subscription_tier": c.get("plan"), "id": c.get("user_id")},
                {})
            await enqueue(email, c.get("user_id"),
                          render(camp["subject"], vars), render(camp["html"], vars),
                          kind="campaign", campaign_id=cid, marketing=True,
                          unsubscribe_url=vars["unsubscribe_url"])
            n += 1
        await _db.email_campaigns.update_one({"id": cid},
            {"$set": {"status": "sent", "sent_at": _iso(), "stats.queued": n}})
        return {"ok": True, "queued": n}

    @r.delete("/campaigns/{cid}")
    async def delete_campaign(cid: str):
        await _db.email_campaigns.delete_one({"id": cid})
        return {"ok": True}

    # ---- suppression list
    @r.get("/suppression")
    async def list_suppression():
        return await _db.email_suppression.find({}, {"_id": 0}).sort("at", -1).to_list(500)

    @r.post("/suppression")
    async def add_suppression(req: SuppressReq):
        await suppress(req.email, req.reason)
        return {"ok": True}

    @r.delete("/suppression/{email_b64}")
    async def remove_suppression(email_b64: str):
        try:
            email = _unb64(email_b64)
        except Exception:
            email = email_b64
        await _db.email_suppression.delete_one({"email": email.lower()})
        return {"ok": True}

    # ---- recent activity
    @r.get("/events")
    async def recent_events():
        return await _db.email_events.find({}, {"_id": 0}).sort("at", -1).limit(100).to_list(100)

    @r.get("/queue")
    async def recent_queue():
        return await _db.email_queue.find({}, {"_id": 0, "html": 0}).sort("created_at", -1).limit(100).to_list(100)

    # ---- test send (uses the verified sandbox path)
    @r.post("/test")
    async def test_send(req: TestSendReq):
        if not keys_present():
            raise HTTPException(503, "Amazon SES isn't connected yet. Add AWS keys to go live.")
        vars = _vars_for_user({"email": req.to_email, "name": req.to_email.split("@")[0]}, {})
        qid = await enqueue(req.to_email, None, render(req.subject, vars), render(req.html, vars), kind="test")
        ok = False
        doc = await _db.email_queue.find_one({"id": qid})
        if doc:
            ok = await _send_one(doc)
        return {"ok": ok, "queued_id": qid}

    return r


# ---------------------------------------------------------------- public router (no auth)
def build_public_router() -> APIRouter:
    r = APIRouter(prefix="/api/e")

    _PIXEL = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    )

    @r.get("/o/{queue_id}.png")
    async def open_pixel(queue_id: str):
        try:
            doc = await _db.email_queue.find_one({"id": queue_id})
            if doc and not doc.get("opened"):
                await _db.email_queue.update_one({"id": queue_id}, {"$set": {"opened": True, "opened_at": _iso()}})
                await _log_event(queue_id, doc.get("message_id"), doc.get("to_email"), doc.get("kind"), "open")
        except Exception:
            pass
        return Response(content=_PIXEL, media_type="image/png",
                        headers={"Cache-Control": "no-store, max-age=0"})

    @r.get("/u/{email_b64}")
    async def unsubscribe(email_b64: str):
        try:
            email = _unb64(email_b64)
            await suppress(email, "unsubscribe")
        except Exception:
            pass
        return PlainTextResponse(
            "You've been unsubscribed from DIYhomie marketing emails. "
            "You'll still get important account emails."
        )

    @r.post("/webhooks/ses")
    async def ses_webhook(request: Request):
        """Amazon SNS notifications for SES bounces/complaints/deliveries."""
        try:
            payload = await request.json()
        except Exception:
            return {"status": "ignored"}
        t = payload.get("Type")
        if t == "SubscriptionConfirmation":
            sub_url = payload.get("SubscribeURL")
            if sub_url:
                try:
                    import httpx
                    async with httpx.AsyncClient(timeout=10) as h:
                        await h.get(sub_url)
                except Exception:
                    pass
            return {"status": "subscribed"}
        if t == "Notification":
            try:
                message = json.loads(payload.get("Message", "{}"))
            except Exception:
                message = {}
            etype = (message.get("eventType") or message.get("notificationType") or "").lower()
            mail = message.get("mail", {}) or {}
            mid = mail.get("messageId")
            recipients = mail.get("destination", []) or []
            for em in recipients:
                await _log_event(None, mid, em, "ses", etype or "event", {})
                if etype in ("bounce", "complaint"):
                    await suppress(em, etype)
        return {"status": "ok"}

    return r
