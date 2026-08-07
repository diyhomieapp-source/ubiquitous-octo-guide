"""
DIYhomie — Home Intelligence MVP (Build Blueprint 01).

A standalone, mobile-first DIY home-maintenance assistant. Isolated FastAPI
router + its own data model so it does not touch existing Home Profile / Projects.

Core workflow:
  1. User creates a home asset (optionally with a photo).
  2. User uploads a document (manual / receipt / warranty) — AI vision extracts
     the text so guidance can be grounded in it.
  3. User describes an issue in plain language (optional photo / voice).
  4. Danger signals (gas, fire, sparks, flooding, exposed wiring, structural)
     immediately short-circuit to an emergency response.
  5. Otherwise the app returns a safety-first guidance card grounded on the
     asset + its documents, with a confidence label and source evidence.
  6. User marks the outcome: completed / unresolved / needs a professional
     (which produces a shareable job summary).

Collections: hi_properties, hi_rooms, hi_assets, hi_asset_documents,
             hi_issues, hi_guidance_sessions, hi_task_outcomes
LLM: OpenAI gpt-4o via the Emergent LLM key (text guidance + vision extraction);
     OpenAI Whisper (whisper-1) for optional voice transcription.
"""
import base64
import os
import re
import tempfile
import uuid
from datetime import datetime, timezone
from typing import Optional, Callable, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None
_llm_json: Callable = None
_llm_key: str = ""

# Hard danger signals — any match forces an emergency response, no DIY steps.
DANGER_PATTERNS = [
    r"gas (smell|leak|odou?r)", r"smell.*gas", r"rotten egg",
    r"\bspark(s|ing)?\b", r"\bfire\b", r"\bflame", r"\bsmoke\b", r"burning smell",
    r"carbon monoxide", r"\bco alarm", r"\belectric(al)? shock", r"shocked me", r"got shocked",
    r"exposed (wire|wiring)", r"bare wire", r"live wire",
    r"flood(ing|ed)?", r"water everywhere", r"gushing water", r"burst pipe",
    r"structural", r"ceiling (sagging|collapsing|falling)", r"wall (cracking|bulging)",
    r"foundation crack", r"collapse", r"gas line",
]

RISK_LEVELS = {"emergency", "high", "medium", "low"}
OUTCOMES = {"completed", "unresolved", "escalated"}
DOC_TYPES = {"manual", "receipt", "warranty", "other"}


def configure(db, logger, llm_json: Callable, llm_key: str):
    global _db, _logger, _llm_json, _llm_key
    _db = db
    _logger = logger
    _llm_json = llm_json
    _llm_key = llm_key or os.environ.get("EMERGENT_LLM_KEY", "")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _new_id():
    return str(uuid.uuid4())


def _keyword_danger(text: str) -> bool:
    t = (text or "").lower()
    return any(re.search(p, t) for p in DANGER_PATTERNS)


# --------------------------------------------------------------- LLM helpers
async def _extract_image_text(image_base64: str) -> str:
    """OCR / read a photographed manual, receipt or warranty via gpt-4o vision."""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
        chat = LlmChat(
            api_key=_llm_key, session_id=_new_id(),
            system_message=(
                "You extract useful text from a photographed home-appliance document "
                "(manual, spec plate, receipt or warranty). Return the readable text, "
                "including any brand, model number, serial number, ratings, part numbers, "
                "maintenance instructions and warranty terms you can see. If the image is "
                "not a document, briefly describe what it shows. Plain text only."),
        ).with_model("openai", "gpt-4o")
        out = await chat.send_message(UserMessage(
            text="Extract all readable text and key details from this document photo.",
            file_contents=[ImageContent(image_base64)]))
        return (out or "").strip()[:6000]
    except Exception as e:
        if _logger:
            _logger.warning(f"home-intel image extract failed: {e}")
        return ""


async def transcribe_audio(file_path: str) -> str:
    from emergentintegrations.llm.openai.speech_to_text import OpenAISpeechToText
    stt = OpenAISpeechToText(api_key=_llm_key)
    resp = await stt.transcribe(file=file_path, model="whisper-1", response_format="json")
    return (getattr(resp, "text", None) or (resp.get("text") if isinstance(resp, dict) else "") or "").strip()


# --------------------------------------------------------------- data helpers
async def _get_or_create_property(user_id: str) -> dict:
    prop = await _db.hi_properties.find_one({"user_id": user_id}, {"_id": 0})
    if not prop:
        prop = {"id": _new_id(), "user_id": user_id, "address": None,
                "home_type": None, "created_at": _now()}
        await _db.hi_properties.insert_one(dict(prop))
    return prop


async def _asset_public(a: dict) -> dict:
    a.pop("_id", None)
    return a


# =============================================================== USER ROUTER
class PropertyReq(BaseModel):
    address: Optional[str] = None
    home_type: Optional[str] = None


class AssetReq(BaseModel):
    name: str
    category: str
    room_id: Optional[str] = None
    room_name: Optional[str] = None      # convenience: create/find room by name
    brand: Optional[str] = None
    model_number: Optional[str] = None
    installation_date: Optional[str] = None
    photo_base64: Optional[str] = None


class DocumentReq(BaseModel):
    document_type: str = "other"
    file_base64: str
    filename: Optional[str] = None


class IssueReq(BaseModel):
    asset_id: Optional[str] = None
    room_id: Optional[str] = None
    user_description: str
    image_base64: Optional[str] = None


class Clarification(BaseModel):
    question: str
    answer: str


class GuidanceReq(BaseModel):
    clarifications: List[Clarification] = []


class OutcomeReq(BaseModel):
    outcome: str
    notes: Optional[str] = None
    completion_photo_base64: Optional[str] = None


def build_user_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi", dependencies=[Depends(get_current_user)])

    # ---------------------------------------------------------- property/rooms
    @r.get("/property")
    async def get_property(user: dict = Depends(get_current_user)):
        return await _get_or_create_property(user["id"])

    @r.put("/property")
    async def update_property(req: PropertyReq, user: dict = Depends(get_current_user)):
        prop = await _get_or_create_property(user["id"])
        await _db.hi_properties.update_one(
            {"id": prop["id"]}, {"$set": {"address": req.address, "home_type": req.home_type}})
        return await _db.hi_properties.find_one({"id": prop["id"]}, {"_id": 0})

    # NOTE: Room CRUD is fully owned by room_intelligence_engine (Blueprint 02).
    # The legacy GET/POST /rooms here were removed to avoid a route collision that
    # shadowed B02's rich room-create. Asset room assignment below creates
    # B02-compatible room docs via _resolve_room.

    async def _resolve_room(prop_id: str, room_id: Optional[str], room_name: Optional[str]) -> Optional[str]:
        if room_id:
            return room_id
        if room_name and room_name.strip():
            nm = room_name.strip()[:60]
            existing = await _db.hi_rooms.find_one({"property_id": prop_id, "name": nm})
            if existing:
                return existing["id"]
            floor = await _db.hi_floors.find_one({"property_id": prop_id}, sort=[("sequence_number", 1)])
            if not floor:
                floor = {"id": _new_id(), "property_id": prop_id, "name": "Main Floor",
                         "sequence_number": 1, "created_at": _now()}
                await _db.hi_floors.insert_one(dict(floor))
            rid = _new_id()
            doc = {"id": rid, "property_id": prop_id, "floor_id": floor["id"], "persistent_room_id": rid,
                   "name": nm, "room_type": "Other", "classification_confidence": "Needs Confirmation",
                   "cover_photo_base64": None, "notes": None, "status": "active",
                   "created_at": _now(), "updated_at": _now()}
            await _db.hi_rooms.insert_one(doc)
            return rid
        return None

    # ---------------------------------------------------------------- assets
    @r.get("/assets")
    async def list_assets(user: dict = Depends(get_current_user)):
        prop = await _get_or_create_property(user["id"])
        assets = await _db.hi_assets.find(
            {"property_id": prop["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
        rooms = {rm["id"]: rm for rm in await _db.hi_rooms.find({"property_id": prop["id"]}, {"_id": 0}).to_list(200)}
        for a in assets:
            a["room_name"] = rooms.get(a.get("room_id"), {}).get("name") or "Unassigned"
        return {"assets": assets, "rooms": list(rooms.values())}

    @r.post("/assets")
    async def create_asset(req: AssetReq, user: dict = Depends(get_current_user)):
        name = (req.name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Asset name is required.")
        prop = await _get_or_create_property(user["id"])
        room_id = await _resolve_room(prop["id"], req.room_id, req.room_name)
        doc = {
            "id": _new_id(), "property_id": prop["id"], "room_id": room_id,
            "name": name[:80], "category": (req.category or "Other")[:50],
            "brand": (req.brand or None), "model_number": (req.model_number or None),
            "installation_date": (req.installation_date or None),
            "photo_base64": (req.photo_base64 or None),
            "status": "ok", "created_at": _now(),
        }
        await _db.hi_assets.insert_one(dict(doc))
        return await _asset_public(doc)

    async def _owned_asset(asset_id: str, user_id: str) -> dict:
        prop = await _get_or_create_property(user_id)
        a = await _db.hi_assets.find_one({"id": asset_id, "property_id": prop["id"]}, {"_id": 0})
        if not a:
            raise HTTPException(status_code=404, detail="Asset not found.")
        return a

    @r.get("/assets/{asset_id}")
    async def asset_detail(asset_id: str, user: dict = Depends(get_current_user)):
        a = await _owned_asset(asset_id, user["id"])
        docs = await _db.hi_asset_documents.find(
            {"asset_id": asset_id}, {"_id": 0, "file_base64": 0, "extracted_text": 0}
        ).sort("uploaded_at", -1).to_list(100)
        # maintenance history = resolved issues + outcomes for this asset
        issues = await _db.hi_issues.find({"asset_id": asset_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
        history = []
        for iss in issues:
            out = await _db.hi_task_outcomes.find_one(
                {"issue_id": iss["id"]}, {"_id": 0}, sort=[("completed_at", -1)])
            history.append({"issue_id": iss["id"], "description": iss["user_description"],
                            "status": iss["status"], "risk_level": iss.get("risk_level"),
                            "created_at": iss["created_at"],
                            "outcome": out.get("outcome") if out else None,
                            "notes": out.get("notes") if out else None,
                            "completed_at": out.get("completed_at") if out else None})
        rm = await _db.hi_rooms.find_one({"id": a.get("room_id")}, {"_id": 0}) if a.get("room_id") else None
        a["room_name"] = rm["name"] if rm else "Unassigned"
        return {"asset": a, "documents": docs, "history": history}

    @r.put("/assets/{asset_id}")
    async def update_asset(asset_id: str, req: AssetReq, user: dict = Depends(get_current_user)):
        a = await _owned_asset(asset_id, user["id"])
        room_id = await _resolve_room(a["property_id"], req.room_id, req.room_name) or a.get("room_id")
        upd = {"name": (req.name or a["name"])[:80], "category": (req.category or a["category"])[:50],
               "room_id": room_id, "brand": req.brand, "model_number": req.model_number,
               "installation_date": req.installation_date}
        if req.photo_base64:
            upd["photo_base64"] = req.photo_base64
        await _db.hi_assets.update_one({"id": asset_id}, {"$set": upd})
        return await _db.hi_assets.find_one({"id": asset_id}, {"_id": 0})

    @r.delete("/assets/{asset_id}")
    async def delete_asset(asset_id: str, user: dict = Depends(get_current_user)):
        await _owned_asset(asset_id, user["id"])
        await _db.hi_assets.delete_one({"id": asset_id})
        await _db.hi_asset_documents.delete_many({"asset_id": asset_id})
        return {"ok": True}

    # -------------------------------------------------------------- documents
    @r.post("/assets/{asset_id}/documents")
    async def add_document(asset_id: str, req: DocumentReq, user: dict = Depends(get_current_user)):
        await _owned_asset(asset_id, user["id"])
        if not req.file_base64:
            raise HTTPException(status_code=400, detail="A document image is required.")
        dtype = req.document_type if req.document_type in DOC_TYPES else "other"
        doc = {"id": _new_id(), "asset_id": asset_id, "document_type": dtype,
               "file_base64": req.file_base64, "filename": (req.filename or None),
               "extracted_text": "", "processing_status": "processing", "uploaded_at": _now()}
        await _db.hi_asset_documents.insert_one(dict(doc))
        # Synchronous AI-vision extraction (photographed document).
        text = await _extract_image_text(req.file_base64)
        status = "done" if text else "failed"
        await _db.hi_asset_documents.update_one(
            {"id": doc["id"]}, {"$set": {"extracted_text": text, "processing_status": status}})
        # If we learned a brand/model and the asset lacks one, backfill it.
        return {"id": doc["id"], "document_type": dtype, "processing_status": status,
                "has_text": bool(text), "uploaded_at": doc["uploaded_at"]}

    @r.get("/assets/{asset_id}/documents")
    async def list_documents(asset_id: str, user: dict = Depends(get_current_user)):
        await _owned_asset(asset_id, user["id"])
        docs = await _db.hi_asset_documents.find(
            {"asset_id": asset_id}, {"_id": 0, "file_base64": 0}).sort("uploaded_at", -1).to_list(100)
        for d in docs:
            d["excerpt"] = (d.pop("extracted_text", "") or "")[:280]
        return {"documents": docs}

    # ---------------------------------------------------------------- issues
    @r.post("/issues")
    async def create_issue(req: IssueReq, user: dict = Depends(get_current_user)):
        desc = (req.user_description or "").strip()
        if not desc:
            raise HTTPException(status_code=400, detail="Please describe what is happening.")
        prop = await _get_or_create_property(user["id"])
        asset = None
        if req.asset_id:
            asset = await _db.hi_assets.find_one({"id": req.asset_id, "property_id": prop["id"]}, {"_id": 0})

        # --- Safety triage FIRST
        risk = "low"
        is_emergency = False
        danger_type = None
        if _keyword_danger(desc):
            risk, is_emergency = "emergency", True
        else:
            system = (
                "You are a home-safety triage assistant. Classify the homeowner's reported issue "
                "for immediate physical danger. Danger signals that are ALWAYS an emergency: gas "
                "smell/leak, sparks, fire, smoke, carbon monoxide, electric shock, exposed/live "
                "wiring, major flooding/burst pipe, or structural instability (sagging/collapsing/"
                "cracking structure or foundation). Return STRICT JSON: {\"risk_level\": one of "
                "[emergency, high, medium, low], \"is_emergency\": boolean, \"danger_type\": string|null, "
                "\"category\": short string (e.g. electrical, plumbing, hvac, appliance, structural, general)}.")
            ctx = f"Asset: {asset['name']} ({asset.get('category')})\n" if asset else ""
            try:
                data = await _llm_json(system, ctx + f"Reported issue: {desc}", max_tokens=300)
                if isinstance(data, dict):
                    rl = str(data.get("risk_level", "low")).lower()
                    risk = rl if rl in RISK_LEVELS else "low"
                    is_emergency = bool(data.get("is_emergency")) or risk == "emergency"
                    danger_type = data.get("danger_type")
            except Exception as e:
                if _logger:
                    _logger.warning(f"home-intel triage failed: {e}")

        issue = {"id": _new_id(), "user_id": user["id"], "asset_id": req.asset_id,
                 "room_id": req.room_id, "user_description": desc[:2000],
                 "image_base64": (req.image_base64 or None), "risk_level": risk,
                 "danger_type": danger_type, "is_emergency": is_emergency,
                 "status": "escalated" if is_emergency else "active", "created_at": _now()}
        await _db.hi_issues.insert_one(dict(issue))
        return {"id": issue["id"], "risk_level": risk, "is_emergency": is_emergency,
                "danger_type": danger_type, "status": issue["status"],
                "asset_id": req.asset_id}

    @r.get("/issues")
    async def list_issues(limit: int = 20, user: dict = Depends(get_current_user)):
        rows = await _db.hi_issues.find(
            {"user_id": user["id"]}, {"_id": 0, "image_base64": 0}
        ).sort("created_at", -1).limit(min(limit, 100)).to_list(100)
        # attach asset name
        aids = list({r["asset_id"] for r in rows if r.get("asset_id")})
        amap = {}
        if aids:
            for a in await _db.hi_assets.find({"id": {"$in": aids}}, {"_id": 0, "id": 1, "name": 1}).to_list(500):
                amap[a["id"]] = a["name"]
        for r_ in rows:
            r_["asset_name"] = amap.get(r_.get("asset_id"))
        return {"issues": rows}

    @r.get("/issues/{issue_id}")
    async def get_issue(issue_id: str, user: dict = Depends(get_current_user)):
        iss = await _db.hi_issues.find_one({"id": issue_id, "user_id": user["id"]}, {"_id": 0})
        if not iss:
            raise HTTPException(status_code=404, detail="Issue not found.")
        sessions = await _db.hi_guidance_sessions.find(
            {"issue_id": issue_id}, {"_id": 0}).sort("created_at", -1).to_list(20)
        return {"issue": iss, "guidance_sessions": sessions}

    # -------------------------------------------------------------- guidance
    @r.post("/issues/{issue_id}/guidance")
    async def generate_guidance(issue_id: str, req: GuidanceReq, user: dict = Depends(get_current_user)):
        iss = await _db.hi_issues.find_one({"id": issue_id, "user_id": user["id"]}, {"_id": 0})
        if not iss:
            raise HTTPException(status_code=404, detail="Issue not found.")
        if iss.get("is_emergency"):
            raise HTTPException(status_code=409, detail="This is an emergency — DIY guidance is disabled.")

        asset = await _db.hi_assets.find_one({"id": iss.get("asset_id")}, {"_id": 0}) if iss.get("asset_id") else None
        # gather grounding evidence from asset documents
        evidence = ""
        has_source = False
        if asset:
            docs = await _db.hi_asset_documents.find(
                {"asset_id": asset["id"], "processing_status": "done"}, {"_id": 0}).to_list(20)
            chunks = [f"[{d['document_type']}] {d.get('extracted_text','')}" for d in docs if d.get("extracted_text")]
            evidence = "\n\n".join(chunks)[:5000]
            has_source = bool(evidence)

        asset_ctx = ("No specific asset selected." if not asset else
                     f"Asset: {asset['name']} | category: {asset.get('category')} | "
                     f"brand: {asset.get('brand') or 'unknown'} | model: {asset.get('model_number') or 'unknown'} | "
                     f"installed: {asset.get('installation_date') or 'unknown'}")
        clar = "\n".join(f"Q: {c.question}\nA: {c.answer}" for c in req.clarifications) or "None yet."

        system = (
            "You are DIYhomie's safety-first home-repair guide. Produce guidance for a homeowner.\n"
            "SAFETY RULES (non-negotiable):\n"
            "- NEVER give DIY repair steps for gas leaks, fire, active electrical hazards, major "
            "flooding, suspected structural failure, or medical emergencies — set safety_status to "
            "'Stop and contact a professional'.\n"
            "- For high-risk electrical, plumbing, structural or code-sensitive work, set "
            "safety_status to 'Verify first' or 'Stop and contact a professional' and include a "
            "professional-escalation recommendation before any detailed steps.\n"
            "- Do NOT claim code compliance. Clearly state uncertainty when no asset model or "
            "reliable source document is available.\n"
            "GROUNDING:\n"
            "- Use the provided document evidence FIRST. Quote the relevant excerpt in source_evidence.\n"
            "- If NO document evidence exists, give only LOW-RISK general guidance and set "
            "confidence_level to 'Needs verification'.\n"
            "CLARIFICATION: Ask at MOST one short follow-up question, and only if it is essential to "
            "give safe guidance and fewer than 2 clarifications already exist. If you need it, set "
            "needs_clarification=true and put the single question in clarifying_question (leave other "
            "fields empty). Otherwise set needs_clarification=false and fill the full card.\n"
            "Return STRICT JSON with keys: needs_clarification (bool), clarifying_question (string), "
            "recognized_asset_details (string), assumptions (array of strings), confidence_level "
            "(one of [Confirmed, Likely, Needs verification]), safety_status (one of [Safe to "
            "continue, Verify first, Stop and contact a professional]), recommended_action (string), "
            "tools_required (array of strings), safety_equipment (array of strings), steps (array of "
            "strings), stop_conditions (array of strings), source_evidence (string).")
        user_text = (
            f"{asset_ctx}\n\nReported issue: {iss['user_description']}\n"
            f"Assessed risk level: {iss.get('risk_level')}\n\n"
            f"Prior clarifications:\n{clar}\n\n"
            f"Document evidence ({'present' if has_source else 'NONE'}):\n{evidence or '(none)'}")
        try:
            data = await _llm_json(system, user_text, max_tokens=1600)
        except Exception as e:
            if _logger:
                _logger.warning(f"home-intel guidance failed: {e}")
            raise HTTPException(status_code=502, detail="Couldn't build guidance. Please try again.")
        if not isinstance(data, dict):
            raise HTTPException(status_code=502, detail="Guidance returned no content.")

        if data.get("needs_clarification") and len(req.clarifications) < 2 and data.get("clarifying_question"):
            return {"needs_clarification": True, "clarifying_question": str(data["clarifying_question"])[:300]}

        # normalize / enforce safety when no source
        conf = data.get("confidence_level") if data.get("confidence_level") in ("Confirmed", "Likely", "Needs verification") else "Needs verification"
        if not has_source and conf == "Confirmed":
            conf = "Needs verification"
        safety = data.get("safety_status") if data.get("safety_status") in ("Safe to continue", "Verify first", "Stop and contact a professional") else "Verify first"
        session = {
            "id": _new_id(), "issue_id": issue_id, "user_id": user["id"],
            "recognized_asset_details": data.get("recognized_asset_details", ""),
            "assumptions": data.get("assumptions", []),
            "confidence_level": conf, "safety_status": safety,
            "recommended_action": data.get("recommended_action", ""),
            "tools_required": data.get("tools_required", []),
            "safety_equipment": data.get("safety_equipment", []),
            "steps": data.get("steps", []),
            "stop_conditions": data.get("stop_conditions", []),
            "source_evidence": (data.get("source_evidence") or "")[:1200],
            "has_source": has_source,
            "created_at": _now(),
        }
        await _db.hi_guidance_sessions.insert_one(dict(session))
        session.pop("_id", None)
        session["needs_clarification"] = False
        return session

    # -------------------------------------------------------------- outcomes
    @r.post("/guidance/{session_id}/outcome")
    async def record_outcome(session_id: str, req: OutcomeReq, user: dict = Depends(get_current_user)):
        sess = await _db.hi_guidance_sessions.find_one(
            {"id": session_id, "user_id": user["id"]}, {"_id": 0})
        if not sess:
            raise HTTPException(status_code=404, detail="Guidance session not found.")
        outcome = req.outcome if req.outcome in OUTCOMES else "unresolved"
        doc = {"id": _new_id(), "guidance_session_id": session_id, "issue_id": sess["issue_id"],
               "user_id": user["id"], "outcome": outcome, "notes": (req.notes or None)[:1000] if req.notes else None,
               "completion_photo_base64": (req.completion_photo_base64 or None),
               "completed_at": _now()}
        await _db.hi_task_outcomes.insert_one(dict(doc))
        status = {"completed": "completed", "unresolved": "unresolved", "escalated": "escalated"}[outcome]
        await _db.hi_issues.update_one({"id": sess["issue_id"]}, {"$set": {"status": status}})
        return {"ok": True, "id": doc["id"], "issue_status": status}

    @r.get("/issues/{issue_id}/job-summary")
    async def job_summary(issue_id: str, user: dict = Depends(get_current_user)):
        iss = await _db.hi_issues.find_one({"id": issue_id, "user_id": user["id"]}, {"_id": 0})
        if not iss:
            raise HTTPException(status_code=404, detail="Issue not found.")
        asset = await _db.hi_assets.find_one({"id": iss.get("asset_id")}, {"_id": 0}) if iss.get("asset_id") else None
        docs = []
        if asset:
            docs = await _db.hi_asset_documents.find(
                {"asset_id": asset["id"]}, {"_id": 0, "file_base64": 0, "extracted_text": 0}).to_list(50)
        sessions = await _db.hi_guidance_sessions.find(
            {"issue_id": issue_id}, {"_id": 0}).sort("created_at", 1).to_list(20)
        attempted = []
        for s in sessions:
            if s.get("recommended_action"):
                attempted.append(s["recommended_action"])
        outcomes = await _db.hi_task_outcomes.find(
            {"issue_id": issue_id}, {"_id": 0, "completion_photo_base64": 0}).sort("completed_at", 1).to_list(20)
        return {
            "issue": {"description": iss["user_description"], "risk_level": iss.get("risk_level"),
                      "created_at": iss["created_at"], "status": iss["status"]},
            "asset": ({"name": asset["name"], "category": asset.get("category"), "brand": asset.get("brand"),
                       "model_number": asset.get("model_number"),
                       "installation_date": asset.get("installation_date")} if asset else None),
            "documents": [{"document_type": d["document_type"], "filename": d.get("filename"),
                           "uploaded_at": d["uploaded_at"]} for d in docs],
            "symptoms": iss["user_description"],
            "attempted_actions": attempted,
            "outcomes": outcomes,
            "generated_at": _now(),
        }

    # -------------------------------------------------------------- dashboard
    @r.get("/dashboard")
    async def dashboard(user: dict = Depends(get_current_user)):
        prop = await _get_or_create_property(user["id"])
        recent_assets = await _db.hi_assets.find(
            {"property_id": prop["id"]}, {"_id": 0, "photo_base64": 0}
        ).sort("created_at", -1).limit(6).to_list(6)
        recent_issues = await _db.hi_issues.find(
            {"user_id": user["id"]}, {"_id": 0, "image_base64": 0}
        ).sort("created_at", -1).limit(6).to_list(6)
        return {
            "asset_count": await _db.hi_assets.count_documents({"property_id": prop["id"]}),
            "recent_assets": recent_assets,
            "recent_tasks": recent_issues,
        }

    return r


def build_public_router() -> APIRouter:
    """Voice transcription (multipart) — used by the Issue Intake mic button."""
    from fastapi import UploadFile, File
    r = APIRouter(prefix="/api/hi")

    @r.post("/transcribe")
    async def transcribe(file: UploadFile = File(...)):
        suffix = os.path.splitext(file.filename or "audio.m4a")[1] or ".m4a"
        try:
            data = await file.read()
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp.write(data)
                path = tmp.name
            text = await transcribe_audio(path)
            return {"text": text}
        except Exception as e:
            if _logger:
                _logger.warning(f"home-intel transcribe failed: {e}")
            raise HTTPException(status_code=502, detail="Couldn't transcribe audio.")
        finally:
            try:
                os.unlink(path)
            except Exception:
                pass

    return r
