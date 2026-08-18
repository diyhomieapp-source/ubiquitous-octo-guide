"""
Build Doc 31 — Onboarding, Activation & First-Project Success Engine.
Namespaces: /api/hi/start (public intent capture) + /api/hi/start (user claim/checklists).

Core principle: deliver value BEFORE asking for account/setup.
- POST /intent is PUBLIC: free-text "What are you working on?" → safety triage first,
  then classification + immediate value (likely diagnosis, safe action, next step).
- Authenticated users claim an intent → first gr_issue project is created.
- First Project Success Checklist + activation status derived from real actions.
- New Homeowner pathway checklist (ob_new_home) with auto-derived + manual items.

Collections: ob_intents, ob_new_home, ob_activation
"""
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None
_llm_json = None

NEED_TYPES = ["repair", "maintenance", "build", "remodel", "design", "emergency", "diagnosis", "learn"]

_KEYWORD_NEED = [
    (["fix", "leak", "broken", "keeps running", "won't", "wont", "stopped working", "cracked", "stuck"], "repair"),
    (["maintain", "maintenance", "filter", "gutter", "winterize", "tune-up", "seasonal"], "maintenance"),
    (["build", "shelves", "shelf", "deck", "workbench", "fence", "shed"], "build"),
    (["remodel", "renovate", "gut", "replace the", "new kitchen", "new bathroom"], "remodel"),
    (["paint", "design", "decorate", "style", "color", "colour", "look of"], "design"),
    (["why", "what is", "how do", "how to", "learn", "understand"], "learn"),
]

_KEYWORD_CAT = [
    (["toilet", "sink", "faucet", "drain", "pipe", "water heater", "leak"], "plumbing"),
    (["outlet", "switch", "breaker", "light", "wiring", "electrical"], "electrical_concern"),
    (["furnace", "ac ", "air condition", "hvac", "thermostat", "heat"], "hvac"),
    (["fridge", "dishwasher", "washer", "dryer", "oven", "appliance", "microwave"], "appliance"),
    (["mold", "damp", "moisture", "water stain", "wet spot"], "water_moisture"),
    (["drywall", "wall", "ceiling", "paint", "trim"], "drywall_interior_surface"),
    (["door", "window"], "doors_windows"),
    (["floor", "tile", "carpet", "hardwood"], "flooring"),
    (["roof", "siding", "gutter", "deck", "fence", "yard"], "exterior"),
    (["mice", "rat", "ant", "termite", "pest", "bug"], "pest_unknown_condition"),
]

NEW_HOME_ITEMS = [
    {"key": "add_address", "label": "Add your home address", "auto": True, "route": "/home-intel/account"},
    {"key": "locate_water_shutoff", "label": "Locate your main water shutoff", "auto": False, "route": None},
    {"key": "locate_electrical_panel", "label": "Locate your electrical panel", "auto": False, "route": None},
    {"key": "test_smoke_co", "label": "Test smoke and CO alarms", "auto": False, "route": None},
    {"key": "document_hvac", "label": "Document your HVAC system", "auto": True, "route": "/home-intel/asset-add"},
    {"key": "add_appliances", "label": "Add major appliance information", "auto": True, "route": "/home-intel/asset-add"},
    {"key": "upload_inspection", "label": "Upload your inspection report", "auto": True, "route": "/home-intel/documents"},
    {"key": "maintenance_calendar", "label": "Create your first maintenance calendar", "auto": True, "route": "/home-intel/maintenance"},
]


def configure(db, logger, llm_json):
    global _db, _logger, _llm_json
    _db, _logger, _llm_json = db, logger, llm_json


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


async def _cap(user, event, props=None, guest=None):
    try:
        import analytics_engine
        await analytics_engine.capture(user, event, props or {}, guest_session_id=guest)
    except Exception:
        pass


def _keyword_classify(text: str) -> dict:
    t = (text or "").lower()
    need = next((n for kws, n in _KEYWORD_NEED if any(k in t for k in kws)), "diagnosis")
    cat = next((c for kws, c in _KEYWORD_CAT if any(k in t for k in kws)), "other_unsure")
    return {"need_type": need, "category": cat,
            "likely_diagnosis": "I need a little more detail to narrow this down, but we can start now.",
            "safe_immediate_action": "Nothing hazardous detected — it's safe to take a closer look.",
            "next_step": "Take one clear photo of the area so I can see exactly what you're working with.",
            "first_questions": ["Which room or area is this in?", "When did you first notice it?"],
            "outline": ["Confirm what's happening", "Gather a photo or measurement", "Review your plan", "Do the work step by step"]}


async def _classify(text: str) -> dict:
    system = (
        "You are DIYhomie, a friendly master contractor. A homeowner just told you what they're working on. "
        "Return STRICT JSON with keys: "
        "'need_type' one of [repair, maintenance, build, remodel, design, emergency, diagnosis, learn]; "
        "'category' one of [water_moisture, plumbing, electrical_concern, appliance, hvac, drywall_interior_surface, "
        "doors_windows, flooring, exterior, pest_unknown_condition, other_unsure]; "
        "'likely_diagnosis' 1-2 plain sentences on the most likely cause or framing of the job; "
        "'safe_immediate_action' one short sentence, the safest thing to do right now; "
        "'next_step' ONE clear, small next action (e.g. take one photo, one measurement); "
        "'first_questions' array of at most 2 short clarifying questions; "
        "'outline' array of 3-5 short phase names for this job. Plain language, no jargon."
    )
    try:
        out = await _llm_json(system, text[:1200], max_tokens=700, feature_area="onboarding")
        if not isinstance(out, dict) or not out.get("next_step"):
            raise ValueError("bad shape")
        if out.get("need_type") not in NEED_TYPES:
            out["need_type"] = "diagnosis"
        return out
    except Exception:
        return _keyword_classify(text)


class IntentReq(BaseModel):
    text: str
    guest_token: Optional[str] = None


class ClaimReq(BaseModel):
    intent_id: str


class ToggleReq(BaseModel):
    key: str
    done: bool = True


def build_public_router() -> APIRouter:
    r = APIRouter(prefix="/api/hi/start", tags=["activation-public"])

    @r.post("/intent")
    async def capture_intent(req: IntentReq):
        text = (req.text or "").strip()
        if len(text) < 3:
            raise HTTPException(status_code=400, detail="Tell me a little more about what you're working on.")
        guest = (req.guest_token or "").strip()[:64] or f"guest_{_nid()[:12]}"
        from guided_repair_engine import _triage
        triage = _triage(text, None)
        doc = {"id": _nid(), "guest_token": guest, "text": text[:2000], "claimed": False,
               "claimed_by": None, "issue_id": None, "created_at": _now()}
        if triage["hard_stop"]:
            # Safety before onboarding: no classification, no conversion prompts.
            doc.update({"need_type": "emergency", "category": "other_unsure", "result": None, "triage": triage})
            await _db.ob_intents.insert_one(dict(doc))
            await _cap(None, "project_intent_captured", {"need_type": "emergency", "is_emergency": True}, guest=guest)
            return {"intent_id": doc["id"], "guest_token": guest, "is_emergency": True,
                    "safety": {"message": triage["message"], "guidance": triage["guidance"]},
                    "need_type": "emergency"}
        result = await _classify(text)
        doc.update({"need_type": result["need_type"], "category": result.get("category", "other_unsure"),
                    "result": result, "triage": triage})
        await _db.ob_intents.insert_one(dict(doc))
        await _cap(None, "project_intent_captured",
                   {"need_type": result["need_type"], "is_emergency": False}, guest=guest)
        return {"intent_id": doc["id"], "guest_token": guest, "is_emergency": False,
                "need_type": result["need_type"], "category": doc["category"], "result": result,
                "triage": {"risk_level": triage["risk_level"], "message": triage["message"]},
                "save_prompt": "Create your free DIYhomie account so I can save this project and remember where we left off."}

    return r


def build_user_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/start", tags=["activation"])

    @r.post("/claim")
    async def claim_intent(req: ClaimReq, user: dict = Depends(get_current_user)):
        intent = await _db.ob_intents.find_one({"id": req.intent_id}, {"_id": 0})
        if not intent:
            raise HTTPException(status_code=404, detail="That conversation has expired. Tell me again what you're working on.")
        if intent.get("claimed") and intent.get("claimed_by") != user["id"]:
            raise HTTPException(status_code=409, detail="This intent was already saved by another account.")
        if intent.get("issue_id"):
            return {"issue_id": intent["issue_id"], "already_claimed": True}
        uid = user["id"]
        triage = intent.get("triage") or {}
        prop = await _db.hi_properties.find_one({"user_id": uid, "is_active": True}, {"_id": 0})
        issue = {
            "id": _nid(), "user_id": uid, "property_id": prop["id"] if prop else None,
            "room_id": None, "asset_id": None,
            "description": intent["text"][:4000], "category": intent.get("category", "other_unsure"),
            "urgency": "emergency_review" if triage.get("hard_stop") else "soon",
            "status": "submitted",
            "phase": "BLOCKED_ESCALATED" if triage.get("hard_stop") else "ISSUE_REPORTED",
            "triage": triage, "risk_flags": triage.get("matched", []),
            "assessment_version": 0, "plan_version": 0, "position_id": None,
            "source": "onboarding_intent", "need_type": intent.get("need_type"),
            "created_at": _now(), "updated_at": _now(),
        }
        await _db.gr_issues.insert_one(dict(issue)); issue.pop("_id", None)
        await _db.ob_intents.update_one({"id": intent["id"]},
                                        {"$set": {"claimed": True, "claimed_by": uid, "issue_id": issue["id"]}})
        prior = await _db.gr_issues.count_documents({"user_id": uid})
        await _cap(user, "first_project_created" if prior <= 1 else "project_created",
                   {"project_category": issue["category"], "source": "ask_homie", "need_type": intent.get("need_type")})
        return {"issue_id": issue["id"], "issue": issue, "is_first_project": prior <= 1}

    @r.get("/checklist")
    async def first_project_checklist(user: dict = Depends(get_current_user)):
        uid = user["id"]
        issue = await _db.gr_issues.find_one({"user_id": uid}, {"_id": 0}, sort=[("created_at", 1)])
        if not issue:
            return {"has_project": False, "steps": [], "progress": 0}
        iid = issue["id"]
        evidence = await _db.gr_evidence.count_documents({"issue_id": iid})
        plan = await _db.gr_plans.find_one({"issue_id": iid}, {"_id": 0, "id": 1})
        bom = await _db.rd_boms.find_one({"issue_id": iid}, {"_id": 0, "id": 1})
        in_progress = issue.get("phase") in ("IN_PROGRESS", "VERIFICATION", "COMPLETED", "DOCUMENTED")
        completed = issue.get("phase") in ("COMPLETED", "DOCUMENTED") or issue.get("status") == "completed"
        steps = [
            {"key": "intent", "label": "Tell Homie what you need", "done": True},
            {"key": "created", "label": "Create project", "done": True},
            {"key": "evidence", "label": "Add photo or measurement", "done": evidence > 0},
            {"key": "plan", "label": "Review plan", "done": bool(plan)},
            {"key": "readiness", "label": "Gather tools & materials", "done": bool(bom)},
            {"key": "first_task", "label": "Complete first task", "done": in_progress or completed},
            {"key": "saved", "label": "Save project progress", "done": completed or in_progress or bool(plan)},
        ]
        done = sum(1 for s in steps if s["done"])
        return {"has_project": True, "issue_id": iid, "issue_description": issue.get("description", "")[:140],
                "category": issue.get("category"), "phase": issue.get("phase"),
                "steps": steps, "progress": round(done / len(steps) * 100)}

    @r.get("/activation")
    async def activation_status(user: dict = Depends(get_current_user)):
        uid = user["id"]
        prop = await _db.hi_properties.find_one({"user_id": uid, "is_active": True}, {"_id": 0, "id": 1})
        signals = {
            "first_project": await _db.gr_issues.count_documents({"user_id": uid}) > 0,
            "plan_generated": await _db.gr_plans.count_documents({"user_id": uid}) > 0,
            "asset_added": (await _db.hi_assets.count_documents({"property_id": prop["id"]}) > 0) if prop else False,
            "evidence_uploaded": await _db.gr_evidence.count_documents({"user_id": uid}) > 0,
            "material_list": await _db.rd_boms.count_documents({"user_id": uid}) > 0,
            "maintenance_done": await _db.hi_maintenance_occurrences.count_documents({"user_id": uid}) > 0,
        }
        activated = any(signals.values())
        rec = await _db.ob_activation.find_one({"user_id": uid}, {"_id": 0})
        if activated and not rec:
            await _db.ob_activation.insert_one({"id": _nid(), "user_id": uid, "activated_at": _now()})
            await _cap(user, "activation_completed", {"signals": [k for k, v in signals.items() if v][:5]})
        return {"activated": activated, "activated_at": (rec or {}).get("activated_at"), "signals": signals}

    # ---------------- New homeowner pathway
    @r.get("/new-homeowner")
    async def new_homeowner(user: dict = Depends(get_current_user)):
        uid = user["id"]
        rec = await _db.ob_new_home.find_one({"user_id": uid}, {"_id": 0}) or {"items": {}}
        manual = rec.get("items", {})
        prop = await _db.hi_properties.find_one({"user_id": uid, "is_active": True}, {"_id": 0})
        # auto-derived completion
        auto = {"add_address": bool(prop and prop.get("address"))}
        if prop:
            auto["document_hvac"] = await _db.hi_assets.count_documents(
                {"property_id": prop["id"], "category": {"$regex": "hvac|heating|cooling", "$options": "i"}}) > 0
            auto["add_appliances"] = await _db.hi_assets.count_documents({"property_id": prop["id"]}) > 0
        auto["upload_inspection"] = await _db.hi_documents.count_documents({"user_id": uid}) > 0
        auto["maintenance_calendar"] = await _db.hi_maintenance_tasks.count_documents({"user_id": uid}) > 0
        items = []
        for it in NEW_HOME_ITEMS:
            done = bool(auto.get(it["key"])) if it["auto"] else bool(manual.get(it["key"]))
            items.append({**it, "done": done or bool(manual.get(it["key"]))})
        done_n = sum(1 for i in items if i["done"])
        return {"items": items, "progress": round(done_n / len(items) * 100),
                "started_at": rec.get("started_at")}

    @r.post("/new-homeowner/toggle")
    async def toggle_new_homeowner(req: ToggleReq, user: dict = Depends(get_current_user)):
        if req.key not in {i["key"] for i in NEW_HOME_ITEMS}:
            raise HTTPException(status_code=400, detail="Unknown checklist item.")
        uid = user["id"]
        existing = await _db.ob_new_home.find_one({"user_id": uid})
        if not existing:
            await _db.ob_new_home.insert_one({"id": _nid(), "user_id": uid, "items": {},
                                              "started_at": _now(), "updated_at": _now()})
            await _cap(user, "new_homeowner_pathway_started", {})
        await _db.ob_new_home.update_one({"user_id": uid},
                                         {"$set": {f"items.{req.key}": bool(req.done), "updated_at": _now()}})
        return {"ok": True}

    return r
