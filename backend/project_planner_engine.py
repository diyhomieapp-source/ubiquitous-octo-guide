"""
DIYhomie — AI Project Planner & Guided Project Workspace (Build Blueprint 03).

Enhances Blueprints 01 & 02. Turns a plain-language goal into a structured,
safety-aware project plan tied to a room and/or asset, then guides the user one
step at a time and records the outcome into the property history.

Collections:
  hi_projects, hi_project_phases, hi_project_steps, hi_project_materials,
  hi_project_media, hi_project_notes, hi_project_outcomes
Shares: hi_properties, hi_rooms, hi_assets, hi_asset_documents, hi_analytics
LLM: OpenAI gpt-4o-mini via Emergent LLM key (through the shared _llm_json helper).
"""
import re
import uuid
from datetime import datetime, timezone
from typing import Optional, Callable, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None
_llm_json: Callable = None

PHASES = ["Plan", "Prepare", "Purchase Materials", "Complete Work", "Inspect", "Clean Up", "Maintain"]
CATEGORIES = ["Fix Something", "Maintain Something", "Build Something", "Remodel a Space", "Improve My Yard", "Organize My Home"]
RISK_LEVELS = ["Low Risk", "Moderate Risk", "High Risk", "Professional Recommended"]
SAFETY_STATUS = ["Safe to continue", "Verify first", "Stop and contact a professional"]
MAT_CATEGORIES = ["material", "tool", "safety_equipment", "optional_upgrade"]

# hard emergency signals (mirror Blueprint 01)
DANGER = [r"gas (smell|leak)", r"\bfire\b", r"\bsparks?\b", r"exposed (wire|wiring)",
          r"flood", r"structural (collapse|failure)", r"carbon monoxide"]


def configure(db, logger, llm_json: Callable):
    global _db, _logger, _llm_json
    _db, _logger, _llm_json = db, logger, llm_json


def _now():
    return datetime.now(timezone.utc).isoformat()


def _new_id():
    return str(uuid.uuid4())


def _danger(text: str) -> bool:
    t = (text or "").lower()
    return any(re.search(p, t) for p in DANGER)


async def _track(user_id: str, event: str, meta: dict = None):
    try:
        await _db.hi_analytics.insert_one({"id": _new_id(), "user_id": user_id, "event": event, "meta": meta or {}, "at": _now()})
    except Exception:
        pass


async def _get_or_create_property(user_id: str) -> dict:
    prop = (await _db.hi_properties.find_one({"user_id": user_id, "is_active": True}, {"_id": 0})
            or await _db.hi_properties.find_one({"user_id": user_id}, {"_id": 0}))
    if not prop:
        prop = {"id": _new_id(), "user_id": user_id, "name": "My Home", "address": None,
                "property_type": None, "created_at": _now()}
        await _db.hi_properties.insert_one(dict(prop))
    return prop


async def _context(prop_id: str, room_id: Optional[str], asset_id: Optional[str]) -> str:
    bits = []
    if room_id:
        rm = await _db.hi_rooms.find_one({"id": room_id}, {"_id": 0})
        if rm:
            bits.append(f"Room: {rm.get('name')} ({rm.get('room_type')})")
    if asset_id:
        a = await _db.hi_assets.find_one({"id": asset_id}, {"_id": 0})
        if a:
            bits.append(f"Asset: {a.get('name')} | {a.get('category')} | {a.get('brand') or ''} {a.get('model_number') or ''}")
            docs = await _db.hi_asset_documents.find(
                {"asset_id": asset_id, "processing_status": "done"}, {"_id": 0}).to_list(10)
            ev = " ".join(d.get("extracted_text", "") for d in docs)[:2000]
            if ev:
                bits.append(f"Asset document excerpts: {ev}")
    return "\n".join(bits) or "No specific room/asset context."


# =============================================================== models
class StartReq(BaseModel):
    goal: str
    project_category: Optional[str] = None
    room_id: Optional[str] = None
    asset_id: Optional[str] = None


class DiscoveryReq(BaseModel):
    skill_level: Optional[str] = None
    budget_preference: Optional[str] = None
    timing_preference: Optional[str] = None
    available_tools: Optional[str] = None
    room_id: Optional[str] = None
    asset_id: Optional[str] = None


class MaterialUpdate(BaseModel):
    user_status: str


class MaterialReq(BaseModel):
    name: str
    category: str = "material"
    quantity: Optional[str] = None
    unit: Optional[str] = None
    notes: Optional[str] = None


class StepStatusReq(BaseModel):
    status: str  # completed | skipped | active


class NoteReq(BaseModel):
    note: str
    project_step_id: Optional[str] = None


class MediaReq(BaseModel):
    media_type: str = "photo"
    file_base64: str
    caption: Optional[str] = None
    project_step_id: Optional[str] = None


class OutcomeReq(BaseModel):
    result: str  # completed | unresolved | escalated
    actual_cost: Optional[str] = None
    actual_duration: Optional[str] = None
    completion_notes: Optional[str] = None
    lessons_learned: Optional[str] = None
    completion_photo_base64: Optional[str] = None


class AskReq(BaseModel):
    question: str
    project_step_id: Optional[str] = None


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/projects", dependencies=[Depends(get_current_user)])

    async def _owned(project_id: str, user_id: str) -> dict:
        p = await _db.hi_projects.find_one({"id": project_id, "user_id": user_id}, {"_id": 0})
        if not p:
            raise HTTPException(status_code=404, detail="Project not found.")
        return p

    # ------------------------------------------------------- list
    @r.get("")
    async def list_projects(status: Optional[str] = None, room_id: Optional[str] = None,
                            asset_id: Optional[str] = None, user: dict = Depends(get_current_user)):
        prop = await _get_or_create_property(user["id"])
        q = {"user_id": user["id"], "property_id": prop["id"]}
        if status:
            q["status"] = status
        else:
            q["status"] = {"$ne": "archived"}  # archived projects only appear when explicitly requested
        if room_id:
            q["room_id"] = room_id
        if asset_id:
            q["asset_id"] = asset_id
        rows = await _db.hi_projects.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
        return {"projects": rows}

    # ------------------------------------------------------- start (draft)
    @r.post("/start")
    async def start(req: StartReq, user: dict = Depends(get_current_user)):
        goal = (req.goal or "").strip()
        if not goal:
            raise HTTPException(status_code=400, detail="Tell us what you'd like to do.")
        import subscription_engine
        await subscription_engine.enforce(user, "project")
        prop = await _get_or_create_property(user["id"])
        # classify goal → title + category (or a single clarifying question)
        system = (
            "You turn a homeowner's plain-language goal into a project. Return STRICT JSON: "
            "{\"needs_clarification\": bool, \"clarifying_question\": string, \"title\": string, "
            f"\"project_category\": one of {CATEGORIES}, \"description\": short string}}. "
            "Only ask a clarifying question if the goal is too vague to categorize.")
        data = {}
        try:
            data = await _llm_json(system, f"Goal: {goal}", max_tokens=350)
        except Exception as e:
            if _logger:
                _logger.warning(f"project start llm failed: {e}")
        if isinstance(data, dict) and data.get("needs_clarification") and data.get("clarifying_question"):
            return {"needs_clarification": True, "clarifying_question": str(data["clarifying_question"])[:300]}
        cat = req.project_category or (data.get("project_category") if isinstance(data, dict) else None)
        if cat not in CATEGORIES:
            cat = "Fix Something"
        doc = {
            "id": _new_id(), "user_id": user["id"], "property_id": prop["id"],
            "room_id": req.room_id, "asset_id": req.asset_id,
            "title": (data.get("title") if isinstance(data, dict) else None) or goal[:80],
            "project_category": cat, "project_goal": goal[:1000],
            "description": (data.get("description") if isinstance(data, dict) else "") or "",
            "skill_level": None, "budget_preference": None, "timing_preference": None,
            "available_tools": None, "risk_level": None, "safety_status": None,
            "status": "draft", "estimated_cost_low": None, "estimated_cost_high": None,
            "estimated_duration": None, "actual_cost": None, "actual_duration": None,
            "created_at": _now(), "completed_at": None,
        }
        await _db.hi_projects.insert_one(dict(doc))
        await _track(user["id"], "project_started", {"project_id": doc["id"], "category": cat})
        import analytics_engine
        await analytics_engine.capture(user, "project_started", {
            "project_category": cat, "has_room_context": bool(req.room_id), "has_asset_context": bool(req.asset_id),
            "source": "room" if req.room_id else ("asset" if req.asset_id else "dashboard")}, property_id=prop["id"])
        doc.pop("_id", None)
        return {"needs_clarification": False, "project": doc}

    # ------------------------------------------------------- discovery
    @r.put("/{project_id}/discovery")
    async def discovery(project_id: str, req: DiscoveryReq, user: dict = Depends(get_current_user)):
        await _owned(project_id, user["id"])
        upd = {k: v for k, v in {
            "skill_level": req.skill_level, "budget_preference": req.budget_preference,
            "timing_preference": req.timing_preference, "available_tools": req.available_tools,
            "room_id": req.room_id, "asset_id": req.asset_id,
        }.items() if v is not None}
        if upd:
            await _db.hi_projects.update_one({"id": project_id}, {"$set": upd})
        await _track(user["id"], "project_discovery_completed", {"project_id": project_id})
        return await _db.hi_projects.find_one({"id": project_id}, {"_id": 0})

    # ------------------------------------------------------- generate plan (safety review + plan)
    @r.post("/{project_id}/plan")
    async def generate_plan(project_id: str, user: dict = Depends(get_current_user)):
        p = await _owned(project_id, user["id"])
        # emergency short-circuit
        if _danger(p["project_goal"]):
            await _db.hi_projects.update_one({"id": project_id}, {"$set": {
                "risk_level": "Professional Recommended", "safety_status": "Stop and contact a professional",
                "status": "escalated"}})
            await _track(user["id"], "project_safety_reviewed", {"project_id": project_id, "risk": "emergency"})
            raise HTTPException(status_code=409, detail="This looks unsafe for DIY. Please contact a professional.")

        ctx = await _context(p["property_id"], p.get("room_id"), p.get("asset_id"))
        try:
            import admin_ops_engine
            approved_templates = await admin_ops_engine.get_published_templates(
                category=p.get("project_category"), types=["project", "safety", "tool_list", "material_list"], limit=6)
        except Exception:
            approved_templates = ""
        try:
            import onboarding_engine
            guidance_prefs = await onboarding_engine.get_guidance_context(user["id"])
        except Exception:
            guidance_prefs = ""
        try:
            import accessibility_engine
            access_ctx = await accessibility_engine.get_access_context(user["id"])
            if access_ctx:
                guidance_prefs = f"{guidance_prefs}\n{access_ctx}".strip()
        except Exception:
            pass
        system = (
            "You are DIYhomie's safety-first project planner. Create a structured DIY project plan.\n"
            "SAFETY: Classify risk_level as one of [Low Risk, Moderate Risk, High Risk, Professional "
            "Recommended]. High-risk examples: electrical panel work, gas lines, structural wall changes, "
            "major plumbing, roofing at height, hazardous materials. For High Risk / Professional "
            "Recommended, set safety_status to 'Stop and contact a professional' and provide safe "
            "PREPARATION guidance + escalation instead of hazardous step detail. Do NOT claim permit or "
            "code compliance. Present estimates as ranges, never guarantees.\n"
            f"Organize steps under these phases only: {PHASES}. Keep steps short (one action each), and "
            "explain why when useful.\n"
            "Return STRICT JSON: {\"title\": string, \"summary\": string, \"difficulty\": one of "
            "[Beginner, Intermediate, Advanced], \"risk_level\": string, \"safety_status\": string, "
            "\"estimated_duration\": string, \"estimated_cost_low\": number (USD), \"estimated_cost_high\": "
            "number (USD), \"preparation_checklist\": [string], \"stop_conditions\": [string], "
            "\"cleanup_disposal\": [string], \"maintenance_followup\": string, "
            "\"materials\": [{\"name\": string, \"category\": one of [material, tool, safety_equipment, "
            "optional_upgrade], \"quantity\": string, \"unit\": string, \"why\": string}], "
            "\"phases\": [{\"phase_name\": one of the allowed phases, \"steps\": "
            "[{\"instruction\": string, \"safety_note\": string, \"stop_condition\": string}]}]}")
        user_text = (
            f"Project goal: {p['project_goal']}\nCategory: {p['project_category']}\n"
            f"Skill level: {p.get('skill_level') or 'unknown'}\nBudget: {p.get('budget_preference') or 'unknown'}\n"
            f"Timing: {p.get('timing_preference') or 'unknown'}\nTools on hand: {p.get('available_tools') or 'unknown'}\n"
            f"Context:\n{ctx}")
        if approved_templates:
            user_text += f"\n\nAPPROVED GUIDANCE (vetted templates — prefer when relevant):\n{approved_templates}"
        if guidance_prefs:
            user_text += f"\n\n{guidance_prefs}"
        try:
            data = await _llm_json(system, user_text, max_tokens=2600)
        except Exception as e:
            if _logger:
                _logger.warning(f"project plan llm failed: {e}")
            raise HTTPException(status_code=502, detail="Couldn't generate the plan. Try again.")
        if not isinstance(data, dict) or not data.get("phases"):
            raise HTTPException(status_code=502, detail="Plan generation returned no content.")

        risk = data.get("risk_level") if data.get("risk_level") in RISK_LEVELS else "Moderate Risk"
        safety = data.get("safety_status") if data.get("safety_status") in SAFETY_STATUS else "Verify first"
        # clear any prior generated plan (allow re-generate)
        old = await _db.hi_project_phases.find({"project_id": project_id}, {"_id": 0, "id": 1}).to_list(50)
        if old:
            await _db.hi_project_steps.delete_many({"project_phase_id": {"$in": [o["id"] for o in old]}})
            await _db.hi_project_phases.delete_many({"project_id": project_id})
        await _db.hi_project_materials.delete_many({"project_id": project_id, "source": "generated"})

        # persist phases + steps
        first_step_id = None
        for si, ph in enumerate(data.get("phases", [])):
            pname = ph.get("phase_name") if ph.get("phase_name") in PHASES else PHASES[min(si, len(PHASES) - 1)]
            phase = {"id": _new_id(), "project_id": project_id, "phase_name": pname,
                     "sequence_number": si, "status": "active" if si == 0 else "not_started",
                     "created_at": _now(), "completed_at": None}
            await _db.hi_project_phases.insert_one(dict(phase))
            for sj, st in enumerate(ph.get("steps", [])):
                sid = _new_id()
                if first_step_id is None:
                    first_step_id = sid
                await _db.hi_project_steps.insert_one({
                    "id": sid, "project_phase_id": phase["id"], "project_id": project_id,
                    "sequence_number": sj, "instruction": str(st.get("instruction", ""))[:600],
                    "safety_note": (st.get("safety_note") or None), "stop_condition": (st.get("stop_condition") or None),
                    "status": "active" if (si == 0 and sj == 0) else "not_started",
                    "created_at": _now(), "completed_at": None})
        # materials
        for m in data.get("materials", []):
            mc = m.get("category") if m.get("category") in MAT_CATEGORIES else "material"
            await _db.hi_project_materials.insert_one({
                "id": _new_id(), "project_id": project_id, "name": str(m.get("name", ""))[:120],
                "category": mc, "quantity": str(m.get("quantity") or ""), "unit": str(m.get("unit") or ""),
                "why": str(m.get("why") or ""), "user_status": "unsure", "notes": None,
                "source": "generated", "created_at": _now()})

        await _db.hi_projects.update_one({"id": project_id}, {"$set": {
            "title": data.get("title") or p["title"], "description": data.get("summary") or p["description"],
            "difficulty": data.get("difficulty"), "risk_level": risk, "safety_status": safety,
            "estimated_duration": data.get("estimated_duration"),
            "estimated_cost_low": data.get("estimated_cost_low"), "estimated_cost_high": data.get("estimated_cost_high"),
            "preparation_checklist": data.get("preparation_checklist", []),
            "stop_conditions": data.get("stop_conditions", []),
            "cleanup_disposal": data.get("cleanup_disposal", []),
            "maintenance_followup": data.get("maintenance_followup", ""),
            "status": "active" if risk not in ("High Risk", "Professional Recommended") else "paused",
        }})
        await _track(user["id"], "project_safety_reviewed", {"project_id": project_id, "risk": risk})
        await _track(user["id"], "project_plan_generated", {"project_id": project_id})
        return await _detail(project_id)

    async def _detail(project_id: str) -> dict:
        p = await _db.hi_projects.find_one({"id": project_id}, {"_id": 0})
        phases = await _db.hi_project_phases.find({"project_id": project_id}, {"_id": 0}).sort("sequence_number", 1).to_list(20)
        for ph in phases:
            ph["steps"] = await _db.hi_project_steps.find(
                {"project_phase_id": ph["id"]}, {"_id": 0}).sort("sequence_number", 1).to_list(50)
        steps = [s for ph in phases for s in ph["steps"]]
        total = len(steps)
        done = len([s for s in steps if s["status"] in ("completed", "skipped")])
        current = next((s for s in steps if s["status"] == "active"), None)
        if not current:
            current = next((s for s in steps if s["status"] == "not_started"), None)
        rm = await _db.hi_rooms.find_one({"id": p.get("room_id")}, {"_id": 0, "name": 1, "room_type": 1}) if p.get("room_id") else None
        asset = await _db.hi_assets.find_one({"id": p.get("asset_id")}, {"_id": 0, "name": 1, "category": 1}) if p.get("asset_id") else None
        return {"project": p, "phases": phases, "current_step": current,
                "progress_pct": round(done / total * 100) if total else 0,
                "steps_total": total, "steps_done": done,
                "room": rm, "asset": asset}

    @r.get("/{project_id}")
    async def get_project(project_id: str, user: dict = Depends(get_current_user)):
        await _owned(project_id, user["id"])
        return await _detail(project_id)

    # ------------------------------------------------------- workspace: steps
    @r.put("/steps/{step_id}")
    async def set_step_status(step_id: str, req: StepStatusReq, user: dict = Depends(get_current_user)):
        st = await _db.hi_project_steps.find_one({"id": step_id}, {"_id": 0})
        if not st:
            raise HTTPException(status_code=404, detail="Step not found.")
        await _owned(st["project_id"], user["id"])
        status = req.status if req.status in ("completed", "skipped", "active", "not_started", "waiting") else "completed"
        await _db.hi_project_steps.update_one({"id": step_id}, {"$set": {
            "status": status, "completed_at": _now() if status in ("completed", "skipped") else None}})
        if status in ("completed", "skipped"):
            await _track(user["id"], "project_step_completed", {"project_id": st["project_id"], "step_id": step_id})
        return await _detail(st["project_id"])

    # ------------------------------------------------------- pause / resume
    @r.put("/{project_id}/status")
    async def set_status(project_id: str, req: StepStatusReq, user: dict = Depends(get_current_user)):
        await _owned(project_id, user["id"])
        s = req.status
        if s not in ("active", "paused", "draft", "archived"):
            raise HTTPException(status_code=400, detail="Invalid status.")
        await _db.hi_projects.update_one({"id": project_id}, {"$set": {"status": s}})
        await _track(user["id"], "project_paused" if s == "paused" else "project_resumed", {"project_id": project_id})
        return {"ok": True, "status": s}

    # ------------------------------------------------------- materials
    @r.get("/{project_id}/materials")
    async def list_materials(project_id: str, user: dict = Depends(get_current_user)):
        await _owned(project_id, user["id"])
        await _track(user["id"], "shopping_list_opened", {"project_id": project_id})
        mats = await _db.hi_project_materials.find({"project_id": project_id}, {"_id": 0}).sort("created_at", 1).to_list(200)
        grouped = {c: [m for m in mats if m["category"] == c] for c in MAT_CATEGORIES}
        return {"materials": mats, "grouped": grouped}

    @r.post("/{project_id}/materials")
    async def add_material(project_id: str, req: MaterialReq, user: dict = Depends(get_current_user)):
        await _owned(project_id, user["id"])
        mc = req.category if req.category in MAT_CATEGORIES else "material"
        doc = {"id": _new_id(), "project_id": project_id, "name": req.name[:120], "category": mc,
               "quantity": req.quantity or "", "unit": req.unit or "", "why": "",
               "user_status": "need_it", "notes": req.notes, "source": "user", "created_at": _now()}
        await _db.hi_project_materials.insert_one(dict(doc))
        doc.pop("_id", None)
        return doc

    @r.put("/materials/{material_id}")
    async def update_material(material_id: str, req: MaterialUpdate, user: dict = Depends(get_current_user)):
        m = await _db.hi_project_materials.find_one({"id": material_id}, {"_id": 0})
        if not m:
            raise HTTPException(status_code=404, detail="Material not found.")
        await _owned(m["project_id"], user["id"])
        us = req.user_status if req.user_status in ("have_it", "need_it", "unsure", "use_alternative", "ordered") else "unsure"
        await _db.hi_project_materials.update_one({"id": material_id}, {"$set": {"user_status": us}})
        await _track(user["id"], "project_material_status_updated", {"material_id": material_id, "status": us})
        return {"ok": True, "user_status": us}

    @r.delete("/materials/{material_id}")
    async def delete_material(material_id: str, user: dict = Depends(get_current_user)):
        m = await _db.hi_project_materials.find_one({"id": material_id}, {"_id": 0})
        if not m:
            raise HTTPException(status_code=404, detail="Material not found.")
        await _owned(m["project_id"], user["id"])
        await _db.hi_project_materials.delete_one({"id": material_id})
        return {"ok": True}

    # ------------------------------------------------------- notes / media
    @r.post("/{project_id}/notes")
    async def add_note(project_id: str, req: NoteReq, user: dict = Depends(get_current_user)):
        await _owned(project_id, user["id"])
        doc = {"id": _new_id(), "project_id": project_id, "project_step_id": req.project_step_id,
               "user_id": user["id"], "note": req.note[:2000], "created_at": _now()}
        await _db.hi_project_notes.insert_one(dict(doc))
        doc.pop("_id", None)
        return doc

    @r.get("/{project_id}/notes")
    async def list_notes(project_id: str, user: dict = Depends(get_current_user)):
        await _owned(project_id, user["id"])
        return {"notes": await _db.hi_project_notes.find({"project_id": project_id}, {"_id": 0}).sort("created_at", -1).to_list(200)}

    @r.post("/{project_id}/media")
    async def add_media(project_id: str, req: MediaReq, user: dict = Depends(get_current_user)):
        await _owned(project_id, user["id"])
        mt = req.media_type if req.media_type in ("photo", "video", "receipt", "document") else "photo"
        doc = {"id": _new_id(), "project_id": project_id, "project_step_id": req.project_step_id,
               "media_type": mt, "file_base64": req.file_base64, "caption": req.caption, "created_at": _now()}
        await _db.hi_project_media.insert_one(dict(doc))
        return {"id": doc["id"], "media_type": mt, "created_at": doc["created_at"]}

    @r.get("/{project_id}/media")
    async def list_media(project_id: str, user: dict = Depends(get_current_user)):
        await _owned(project_id, user["id"])
        rows = await _db.hi_project_media.find({"project_id": project_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
        return {"media": rows}

    # ------------------------------------------------------- ask homie
    @r.post("/{project_id}/ask")
    async def ask(project_id: str, req: AskReq, user: dict = Depends(get_current_user)):
        p = await _owned(project_id, user["id"])
        q = (req.question or "").strip()
        if not q:
            raise HTTPException(status_code=400, detail="Ask a question.")
        step = await _db.hi_project_steps.find_one({"id": req.project_step_id}, {"_id": 0}) if req.project_step_id else None
        ctx = await _context(p["property_id"], p.get("room_id"), p.get("asset_id"))
        system = ("You are Homie, a safety-first DIY assistant. Answer the user's question about their "
                  "current project step concisely. If the task is unsafe or code-sensitive, advise "
                  "contacting a professional. Do not claim code/permit compliance. Return STRICT JSON: "
                  "{\"answer\": string}.")
        ut = f"Project: {p['title']} ({p['project_category']}). Context:\n{ctx}\n"
        if step:
            ut += f"Current step: {step['instruction']}\n"
        ut += f"Question: {q}"
        try:
            data = await _llm_json(system, ut, max_tokens=500)
        except Exception:
            raise HTTPException(status_code=502, detail="Couldn't answer right now.")
        return {"answer": data.get("answer", "") if isinstance(data, dict) else str(data)}

    # ------------------------------------------------------- completion / outcome
    @r.post("/{project_id}/outcome")
    async def record_outcome(project_id: str, req: OutcomeReq, user: dict = Depends(get_current_user)):
        p = await _owned(project_id, user["id"])
        result = req.result if req.result in ("completed", "unresolved", "escalated") else "unresolved"
        doc = {"id": _new_id(), "project_id": project_id, "result": result,
               "actual_cost": req.actual_cost, "actual_duration": req.actual_duration,
               "completion_notes": req.completion_notes, "lessons_learned": req.lessons_learned,
               "completion_photo_base64": req.completion_photo_base64, "created_at": _now()}
        await _db.hi_project_outcomes.insert_one(dict(doc))
        status = {"completed": "completed", "unresolved": "unresolved", "escalated": "escalated"}[result]
        upd = {"status": status, "actual_cost": req.actual_cost, "actual_duration": req.actual_duration}
        if result == "completed":
            upd["completed_at"] = _now()
        await _db.hi_projects.update_one({"id": project_id}, {"$set": upd})
        ev = {"completed": "project_completed", "unresolved": "project_abandoned", "escalated": "project_escalated"}[result]
        await _track(user["id"], ev, {"project_id": project_id})
        return {"ok": True, "status": status}

    @r.get("/{project_id}/outcome")
    async def get_outcome(project_id: str, user: dict = Depends(get_current_user)):
        await _owned(project_id, user["id"])
        doc = await _db.hi_project_outcomes.find({"project_id": project_id}, {"_id": 0}) \
            .sort("created_at", -1).to_list(1)
        if not doc:
            raise HTTPException(status_code=404, detail="No outcome recorded yet.")
        return {"outcome": doc[0]}

    return r
