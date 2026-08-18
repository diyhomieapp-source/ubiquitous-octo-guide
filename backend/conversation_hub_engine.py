"""
DIYhomie — Homie AI Assistant & Conversation Hub (Build Blueprint 05).

A central chat front-door to Homie. Conversations are grounded on the user's
real home context (selected rooms / assets / projects / documents). The user can
attach a photo for AI identification. Homie is safety-first and, when useful,
proposes structured "suggested actions" (add an asset, schedule maintenance,
start a project) that the user must explicitly APPROVE before any record is
created — nothing is written to the home automatically.

Collections: hi_conversations, hi_conversation_messages
Shares:      hi_properties, hi_rooms, hi_assets, hi_projects,
             hi_documents / hi_asset_documents, hi_maintenance_tasks,
             hi_maintenance_occurrences, hi_analytics
LLM: OpenAI gpt-4o (vision) + gpt-4o-mini (chat) via the Emergent LLM key.
"""
import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, Callable, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None
_llm_json: Callable = None
_llm_key: str = ""

# hard emergency signals (mirror Blueprints 01 & 03)
DANGER = [r"gas (smell|leak)", r"\bfire\b", r"\bsparks?\b", r"exposed (wire|wiring)",
          r"flood(ing)?", r"structural (collapse|failure)", r"carbon monoxide",
          r"electric(al)? shock", r"can'?t breathe", r"smoke filling"]

ACTION_TYPES = ["create_asset", "create_maintenance_task", "start_project"]


def configure(db, logger, llm_json: Callable, llm_key: str):
    global _db, _logger, _llm_json, _llm_key
    _db, _logger, _llm_json, _llm_key = db, logger, llm_json, (llm_key or "")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _today_iso():
    return datetime.now(timezone.utc).date().isoformat()


def _new_id():
    return str(uuid.uuid4())


def _danger(text: str) -> bool:
    t = (text or "").lower()
    return any(re.search(p, t) for p in DANGER)


async def _track(user_id, event, meta=None):
    try:
        await _db.hi_analytics.insert_one({"id": _new_id(), "user_id": user_id, "event": event, "meta": meta or {}, "at": _now()})
    except Exception:
        pass


async def _get_or_create_property(user_id):
    prop = (await _db.hi_properties.find_one({"user_id": user_id, "is_active": True}, {"_id": 0})
            or await _db.hi_properties.find_one({"user_id": user_id}, {"_id": 0}))
    if not prop:
        prop = {"id": _new_id(), "user_id": user_id, "name": "My Home", "address": None,
                "property_type": None, "created_at": _now()}
        await _db.hi_properties.insert_one(dict(prop))
    return prop


async def _plain_chat(system: str, user_text: str, max_tokens: int = 700) -> str:
    """Fallback plain-text reply when structured JSON parsing fails."""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(api_key=_llm_key, session_id=_new_id(), system_message=system).with_model("openai", "gpt-4o-mini")
        return ((await chat.send_message(UserMessage(text=user_text))) or "").strip()
    except Exception as e:
        if _logger:
            _logger.warning(f"homie plain-chat fallback failed: {e}")
        return ""


async def _identify_image(image_base64: str) -> dict:
    """gpt-4o vision — identify a home item / appliance / part from a photo."""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
        chat = LlmChat(
            api_key=_llm_key, session_id=_new_id(),
            system_message=(
                "You identify a home item, appliance, fixture, tool or part from a photo. "
                "Return STRICT JSON: {\"name\": short label, \"category\": one of [Plumbing, "
                "HVAC, Electrical, Appliances, Exterior, Structure, Safety, Tools, Other], "
                "\"brand\": string|null, \"model_hint\": string|null, \"description\": one honest "
                "sentence, \"confidence\": one of [High, Medium, Low]}. If you cannot tell, say so "
                "in description and use Low confidence. Never guess a model number you can't read."),
        ).with_model("openai", "gpt-4o")
        out = await chat.send_message(UserMessage(
            text="Identify what this is. Return only the JSON.",
            file_contents=[ImageContent(image_base64)]))
        from json import loads
        s = (out or "").strip()
        if s.startswith("```"):
            s = re.sub(r"^```[a-zA-Z]*\n?|\n?```$", "", s).strip()
        return loads(s)
    except Exception as e:
        if _logger:
            _logger.warning(f"homie photo-id failed: {e}")
        return {}


async def _build_context(prop_id: str, ctx: dict) -> str:
    """Turn selected rooms/assets/projects/documents into a grounding text block."""
    bits: List[str] = []
    ctx = ctx or {}
    rids = ctx.get("room_ids") or []
    aids = ctx.get("asset_ids") or []
    pids = ctx.get("project_ids") or []
    dids = ctx.get("document_ids") or []

    if rids:
        rooms = await _db.hi_rooms.find({"id": {"$in": rids}}, {"_id": 0, "name": 1, "room_type": 1}).to_list(50)
        if rooms:
            bits.append("Rooms: " + "; ".join(f"{r.get('name')} ({r.get('room_type')})" for r in rooms))
    if aids:
        assets = await _db.hi_assets.find({"id": {"$in": aids}}, {"_id": 0}).to_list(50)
        for a in assets:
            bits.append(f"Asset: {a.get('name')} | {a.get('category')} | {a.get('brand') or ''} {a.get('model_number') or ''}".strip())
            docs = await _db.hi_asset_documents.find(
                {"asset_id": a["id"], "processing_status": "done"}, {"_id": 0, "extracted_text": 1}).to_list(5)
            ev = " ".join(d.get("extracted_text", "") for d in docs)[:1500]
            if ev:
                bits.append(f"  Manual/receipt excerpt: {ev}")
    if pids:
        projs = await _db.hi_projects.find({"id": {"$in": pids}}, {"_id": 0, "title": 1, "status": 1, "project_category": 1}).to_list(50)
        if projs:
            bits.append("Projects: " + "; ".join(f"{p.get('title')} [{p.get('status')}]" for p in projs))
    if dids:
        docs = await _db.hi_documents.find({"id": {"$in": dids}}, {"_id": 0, "title": 1, "category": 1, "extracted_text": 1}).to_list(20)
        for d in docs:
            bits.append(f"Document: {d.get('title')} ({d.get('category')}) — {(d.get('extracted_text') or '')[:1200]}")
    return "\n".join(bits) or "No specific context selected. Answer generally about home care."


# =============================================================== models
class NewConvReq(BaseModel):
    title: Optional[str] = None
    room_ids: Optional[List[str]] = None
    asset_ids: Optional[List[str]] = None
    project_ids: Optional[List[str]] = None
    document_ids: Optional[List[str]] = None


class ContextReq(BaseModel):
    title: Optional[str] = None
    room_ids: Optional[List[str]] = None
    asset_ids: Optional[List[str]] = None
    project_ids: Optional[List[str]] = None
    document_ids: Optional[List[str]] = None


class MessageReq(BaseModel):
    text: str = ""
    image_base64: Optional[str] = None


class ApproveReq(BaseModel):
    message_id: str
    action_index: int = 0


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/chat", dependencies=[Depends(get_current_user)])

    async def _owned(cid, user_id):
        c = await _db.hi_conversations.find_one({"id": cid, "user_id": user_id}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Conversation not found.")
        return c

    # ------------------------------------------------ context options
    @r.get("/context-options")
    async def context_options(user: dict = Depends(get_current_user)):
        prop = await _get_or_create_property(user["id"])
        rooms = await _db.hi_rooms.find({"user_id": user["id"], "status": {"$ne": "archived"}}, {"_id": 0, "id": 1, "name": 1, "room_type": 1}).to_list(200)
        if not rooms:
            rooms = await _db.hi_rooms.find({"property_id": prop["id"]}, {"_id": 0, "id": 1, "name": 1, "room_type": 1}).to_list(200)
        assets = await _db.hi_assets.find({"property_id": prop["id"]}, {"_id": 0, "id": 1, "name": 1, "category": 1}).to_list(300)
        projects = await _db.hi_projects.find({"user_id": user["id"]}, {"_id": 0, "id": 1, "title": 1, "status": 1}).sort("created_at", -1).to_list(100)
        documents = await _db.hi_documents.find({"user_id": user["id"]}, {"_id": 0, "id": 1, "title": 1, "category": 1}).sort("created_at", -1).to_list(200)
        return {"rooms": rooms, "assets": assets, "projects": projects, "documents": documents}

    # ------------------------------------------------ conversations
    @r.get("/conversations")
    async def list_conversations(user: dict = Depends(get_current_user)):
        rows = await _db.hi_conversations.find({"user_id": user["id"]}, {"_id": 0}).sort("updated_at", -1).to_list(200)
        return {"conversations": rows}

    @r.post("/conversations")
    async def create_conversation(req: NewConvReq, user: dict = Depends(get_current_user)):
        prop = await _get_or_create_property(user["id"])
        doc = {
            "id": _new_id(), "user_id": user["id"], "property_id": prop["id"],
            "title": (req.title or "New chat").strip()[:80],
            "context": {"room_ids": req.room_ids or [], "asset_ids": req.asset_ids or [],
                        "project_ids": req.project_ids or [], "document_ids": req.document_ids or []},
            "last_preview": None, "message_count": 0,
            "created_at": _now(), "updated_at": _now(),
        }
        await _db.hi_conversations.insert_one(dict(doc))
        await _track(user["id"], "conversation_started", {"conversation_id": doc["id"]})
        doc.pop("_id", None)
        return doc

    @r.get("/conversations/{cid}")
    async def conversation_detail(cid: str, user: dict = Depends(get_current_user)):
        c = await _owned(cid, user["id"])
        msgs = await _db.hi_conversation_messages.find(
            {"conversation_id": cid}, {"_id": 0, "image_base64": 0}).sort("created_at", 1).to_list(500)
        # resolve context labels for display
        ctx = c.get("context", {})
        labels = {}
        if ctx.get("asset_ids"):
            for a in await _db.hi_assets.find({"id": {"$in": ctx["asset_ids"]}}, {"_id": 0, "id": 1, "name": 1}).to_list(100):
                labels[a["id"]] = a["name"]
        if ctx.get("room_ids"):
            for rm in await _db.hi_rooms.find({"id": {"$in": ctx["room_ids"]}}, {"_id": 0, "id": 1, "name": 1}).to_list(100):
                labels[rm["id"]] = rm["name"]
        if ctx.get("project_ids"):
            for p in await _db.hi_projects.find({"id": {"$in": ctx["project_ids"]}}, {"_id": 0, "id": 1, "title": 1}).to_list(100):
                labels[p["id"]] = p["title"]
        if ctx.get("document_ids"):
            for d in await _db.hi_documents.find({"id": {"$in": ctx["document_ids"]}}, {"_id": 0, "id": 1, "title": 1}).to_list(100):
                labels[d["id"]] = d["title"]
        return {"conversation": c, "messages": msgs, "context_labels": labels}

    @r.put("/conversations/{cid}")
    async def update_conversation(cid: str, req: ContextReq, user: dict = Depends(get_current_user)):
        await _owned(cid, user["id"])
        upd = {"updated_at": _now()}
        if req.title is not None:
            upd["title"] = req.title.strip()[:80] or "New chat"
        ctx_fields = {"room_ids": req.room_ids, "asset_ids": req.asset_ids,
                      "project_ids": req.project_ids, "document_ids": req.document_ids}
        for k, v in ctx_fields.items():
            if v is not None:
                upd[f"context.{k}"] = v
        await _db.hi_conversations.update_one({"id": cid}, {"$set": upd})
        return await _db.hi_conversations.find_one({"id": cid}, {"_id": 0})

    @r.delete("/conversations/{cid}")
    async def delete_conversation(cid: str, user: dict = Depends(get_current_user)):
        await _owned(cid, user["id"])
        await _db.hi_conversation_messages.delete_many({"conversation_id": cid})
        await _db.hi_conversations.delete_one({"id": cid})
        await _track(user["id"], "conversation_deleted", {"conversation_id": cid})
        return {"ok": True}

    # ------------------------------------------------ send a message
    @r.post("/conversations/{cid}/message")
    async def send_message(cid: str, req: MessageReq, user: dict = Depends(get_current_user)):
        c = await _owned(cid, user["id"])
        text = (req.text or "").strip()
        if not text and not req.image_base64:
            raise HTTPException(status_code=400, detail="Type a message or attach a photo.")
        import subscription_engine
        await subscription_engine.enforce(user, "chat")
        import reliability_engine
        await reliability_engine.enforce_ai_budget(user["id"], "homie_chat")

        # persist the user's message (store image if present)
        photo_id = None
        if req.image_base64:
            photo_id = await _identify_image(req.image_base64)
        user_msg = {"id": _new_id(), "conversation_id": cid, "user_id": user["id"], "role": "user",
                    "text": text, "image_base64": req.image_base64,
                    "photo_identification": photo_id or None, "created_at": _now()}
        await _db.hi_conversation_messages.insert_one(dict(user_msg))
        await _track(user["id"], "conversation_message_sent", {"conversation_id": cid, "has_photo": bool(req.image_base64)})

        # emergency short-circuit — never coach through a hazard
        if _danger(text):
            reply = ("⚠️ This sounds like an emergency. Please stop, get to safety, and contact "
                     "your local emergency services or a licensed professional right now. I can't "
                     "safely guide you through this one.")
            a = {"id": _new_id(), "conversation_id": cid, "user_id": user["id"], "role": "assistant",
                 "text": reply, "suggested_actions": [], "emergency": True, "created_at": _now()}
            await _db.hi_conversation_messages.insert_one(dict(a))
            await _db.hi_conversations.update_one({"id": cid}, {"$set": {"last_preview": reply[:120], "updated_at": _now()}, "$inc": {"message_count": 2}})
            await _track(user["id"], "conversation_safety_flagged", {"conversation_id": cid})
            try:
                import admin_ops_engine
                await admin_ops_engine.record_safety_escalation(
                    user["id"], risk_level="emergency", trigger_type="conversation_emergency_keyword",
                    ai_response_reference=reply[:300], conversation_id=cid)
            except Exception:
                pass
            a.pop("_id", None)
            return {"assistant": a, "photo_identification": photo_id or None}

        ctx_text = await _build_context(c["property_id"], c.get("context", {}))
        # Doc 35 §8 — AI privacy controls: user can withhold home context / personalization.
        try:
            import data_governance_engine
            _ai_priv = await data_governance_engine.get_ai_privacy(user["id"])
        except Exception:
            _ai_priv = {}
        if _ai_priv and not _ai_priv.get("allow_home_context", True):
            ctx_text = "The user has disabled sharing their home profile with AI. Do not assume home details; ask when needed."
        try:
            import admin_ops_engine
            approved_templates = await admin_ops_engine.get_published_templates(limit=6)
        except Exception:
            approved_templates = ""
        try:
            import onboarding_engine
            guidance_prefs = await onboarding_engine.get_guidance_context(user["id"])
        except Exception:
            guidance_prefs = ""
        if _ai_priv and not _ai_priv.get("ai_personalization", True):
            guidance_prefs = ""
        try:
            import accessibility_engine
            access_ctx = await accessibility_engine.get_access_context(user["id"])
            if access_ctx:
                guidance_prefs = f"{guidance_prefs}\n{access_ctx}".strip()
        except Exception:
            pass
        # recent history (last 8 turns)
        hist = await _db.hi_conversation_messages.find(
            {"conversation_id": cid}, {"_id": 0, "role": 1, "text": 1}).sort("created_at", -1).to_list(9)
        hist = list(reversed(hist))[:-1]  # drop the just-inserted user msg
        hist_text = "\n".join(f"{m['role']}: {m['text']}" for m in hist if m.get("text"))

        system = (
            "You are Homie, a safety-first master-contractor assistant inside the DIYhomie app. "
            "Use the HOME CONTEXT below to give specific, practical answers grounded in the user's "
            "real rooms, assets and documents. Be concise and honest. If a task is unsafe, code-"
            "sensitive, or needs a licensed pro (gas, major electrical, structural, roofing at "
            "height), say so and recommend a professional — never provide hazardous step detail and "
            "never claim code/permit/warranty/insurance compliance.\n"
            "When it would genuinely help, you MAY propose up to 2 structured actions the user can "
            "approve. Allowed action types: create_asset (payload: {name, category, brand?, "
            "model_number?}), create_maintenance_task (payload: {title, category, priority, "
            "frequency_type in [one_time,monthly,quarterly,biannual,annual], due_in_days:int}), "
            "start_project (payload: {goal, project_category}). Only propose actions clearly implied "
            "by the conversation; otherwise return an empty list.\n"
            "If APPROVED GUIDANCE templates are provided, treat them as vetted house rules and prefer "
            "them when relevant.\n"
            "Return STRICT JSON: {\"reply\": string, \"suggested_actions\": [{\"type\": string, "
            "\"label\": short button text, \"payload\": object}]}.")
        ut = f"HOME CONTEXT:\n{ctx_text}\n\nRECENT CONVERSATION:\n{hist_text or '(none)'}\n\nUSER MESSAGE: {text or '(sent a photo)'}"
        if guidance_prefs:
            ut += f"\n\n{guidance_prefs}"
        if approved_templates:
            ut += f"\n\nAPPROVED GUIDANCE (vetted templates — prefer when relevant):\n{approved_templates}"
        if photo_id:
            ut += f"\n\nPHOTO IDENTIFICATION (from the attached image): {photo_id}"

        try:
            data = await _llm_json(system, ut, max_tokens=900)
        except Exception as e:
            if _logger:
                _logger.warning(f"homie chat failed: {e}")
            data = {}
        reply = (data.get("reply") if isinstance(data, dict) else None)
        raw_actions = data.get("suggested_actions", []) if isinstance(data, dict) else []
        if not reply:
            # structured JSON failed — still give the user a real answer (no actions)
            reply = await _plain_chat(
                "You are Homie, a concise, safety-first master-contractor assistant. If a task is "
                "unsafe or needs a licensed pro, say so. Never claim code/permit/warranty compliance.",
                ut, max_tokens=700) or "I'm having trouble responding right now — please try again."
            raw_actions = []
        actions = []
        for act in raw_actions[:2]:
            if isinstance(act, dict) and act.get("type") in ACTION_TYPES and isinstance(act.get("payload"), dict):
                actions.append({"type": act["type"], "label": str(act.get("label") or act["type"])[:60],
                                "payload": act["payload"], "approved": False, "created_id": None})

        a = {"id": _new_id(), "conversation_id": cid, "user_id": user["id"], "role": "assistant",
             "text": reply, "suggested_actions": actions, "emergency": False, "created_at": _now()}
        await _db.hi_conversation_messages.insert_one(dict(a))
        await _db.hi_conversations.update_one({"id": cid}, {"$set": {"last_preview": reply[:120], "updated_at": _now()}, "$inc": {"message_count": 2}})
        a.pop("_id", None)
        return {"assistant": a, "photo_identification": photo_id or None}

    # ------------------------------------------------ approve a suggested action
    @r.post("/conversations/{cid}/approve")
    async def approve_action(cid: str, req: ApproveReq, user: dict = Depends(get_current_user)):
        c = await _owned(cid, user["id"])
        msg = await _db.hi_conversation_messages.find_one({"id": req.message_id, "conversation_id": cid}, {"_id": 0})
        if not msg:
            raise HTTPException(status_code=404, detail="Message not found.")
        actions = msg.get("suggested_actions", []) or []
        if req.action_index < 0 or req.action_index >= len(actions):
            raise HTTPException(status_code=400, detail="Invalid action.")
        act = actions[req.action_index]
        if act.get("approved"):
            raise HTTPException(status_code=409, detail="Already added.")
        p = act.get("payload", {}) or {}
        prop = await _get_or_create_property(user["id"])
        created_id = None
        result_kind = act["type"]

        if act["type"] == "create_asset":
            created_id = _new_id()
            await _db.hi_assets.insert_one({
                "id": created_id, "user_id": user["id"], "property_id": prop["id"], "room_id": None,
                "name": str(p.get("name") or "New asset")[:120], "category": str(p.get("category") or "Other")[:50],
                "brand": p.get("brand"), "model_number": p.get("model_number"),
                "installation_date": None, "photo_base64": None, "status": "ok",
                "created_at": _now(), "updated_at": _now()})
        elif act["type"] == "create_maintenance_task":
            created_id = _new_id()
            freq = p.get("frequency_type") if p.get("frequency_type") in ("one_time", "monthly", "quarterly", "biannual", "annual") else "one_time"
            days = int(p.get("due_in_days") or 7)
            due = (datetime.now(timezone.utc).date() + timedelta(days=max(0, days))).isoformat()
            await _db.hi_maintenance_tasks.insert_one({
                "id": created_id, "user_id": user["id"], "property_id": prop["id"], "room_id": None,
                "asset_id": None, "project_id": None, "title": str(p.get("title") or "Maintenance task")[:120],
                "category": str(p.get("category") or "General")[:50], "description": None,
                "priority": p.get("priority") if p.get("priority") in ("low", "medium", "high") else "medium",
                "frequency_type": freq, "custom_interval_days": None, "due_date": due, "status": "active",
                "source": "homie_chat", "source_reason": "Created from a Homie chat suggestion", "season": None,
                "created_at": _now(), "updated_at": _now()})
            await _db.hi_maintenance_occurrences.insert_one({
                "id": _new_id(), "maintenance_task_id": created_id, "user_id": user["id"],
                "scheduled_date": due, "completed_date": None, "status": "upcoming", "notes": None, "cost": None, "created_at": _now()})
        elif act["type"] == "start_project":
            created_id = _new_id()
            cat = p.get("project_category")
            valid_cats = ["Fix Something", "Maintain Something", "Build Something", "Remodel a Space", "Improve My Yard", "Organize My Home"]
            if cat not in valid_cats:
                cat = "Fix Something"
            goal = str(p.get("goal") or "New project")[:1000]
            await _db.hi_projects.insert_one({
                "id": created_id, "user_id": user["id"], "property_id": prop["id"], "room_id": None, "asset_id": None,
                "title": goal[:80], "project_category": cat, "project_goal": goal, "description": "",
                "skill_level": None, "budget_preference": None, "timing_preference": None, "available_tools": None,
                "risk_level": None, "safety_status": None, "status": "draft",
                "estimated_cost_low": None, "estimated_cost_high": None, "estimated_duration": None,
                "actual_cost": None, "actual_duration": None, "created_at": _now(), "completed_at": None})

        actions[req.action_index]["approved"] = True
        actions[req.action_index]["created_id"] = created_id
        await _db.hi_conversation_messages.update_one({"id": req.message_id}, {"$set": {"suggested_actions": actions}})
        await _track(user["id"], "conversation_record_created", {"conversation_id": cid, "kind": result_kind, "created_id": created_id})
        return {"ok": True, "kind": result_kind, "created_id": created_id}

    return r
