"""
Build Doc 28 — Design Studio, Visualization & Design-to-Build Engine (MVP).
Namespace /api/hi/design-studio/*.

Inspiration → concept image (Gemini Nano Banana via Emergent key; room-photo-aware
edits) → written design direction → versions → buildability review (taste vs
buildability vs safety vs budget vs permit) → approve → convert to a real repair/build
project (gr_issues) that flows into assessment/plan/readiness (Doc 7).

Honest labels everywhere: concepts are inspiration, NOT construction-ready plans.
Collections: ds_projects, ds_versions, ds_inspirations.
"""
from datetime import datetime, timezone
from typing import Callable, Optional, List
import os
import uuid

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

_db = None
_logger = None
_llm_json: Optional[Callable] = None

DESIGN_TYPES = ("room_refresh", "remodel_concept", "exterior", "build_to_fit")
STATUSES = ("collecting_context", "concept_generated", "buildability_reviewed", "approved", "converted", "archived")
CONCEPT_DISCLAIMER = "Inspiration concept — not dimensionally accurate or construction-ready. Verify measurements before building or buying."
IMAGE_MODEL = "gemini-3.1-flash-image-preview"


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


def configure(db, logger, llm_json: Callable):
    global _db, _logger, _llm_json
    _db, _logger, _llm_json = db, logger, llm_json


async def _cap(user_id, event, props=None):
    try:
        from analytics_engine import capture
        await capture(user_id, event, props or {})
    except Exception:
        pass


async def _owned(pid, uid, projection=None):
    proj = await _db.ds_projects.find_one({"id": pid, "user_id": uid}, projection or {"_id": 0})
    if not proj:
        raise HTTPException(status_code=404, detail="Design project not found.")
    return proj


async def _generate_image(prompt: str, reference_b64: Optional[str] = None) -> Optional[str]:
    """Nano Banana image generation/editing per Emergent playbook. Returns base64 PNG or None."""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
        chat = LlmChat(api_key=os.environ.get("EMERGENT_LLM_KEY", ""), session_id=f"ds-{_nid()}",
                       system_message="You generate realistic, achievable home interior/exterior design concept images.")
        chat.with_model("gemini", IMAGE_MODEL).with_params(modalities=["image", "text"])
        msg = UserMessage(text=prompt, file_contents=[ImageContent(reference_b64)]) if reference_b64 else UserMessage(text=prompt)
        _text, images = await chat.send_message_multimodal_response(msg)
        if images:
            return images[0]["data"]
    except Exception as e:
        if _logger:
            _logger.warning(f"design image generation failed: {e}")
    return None


class ProjectReq(BaseModel):
    design_type: str
    title: str
    objective: str
    feel_goals: Optional[List[str]] = None
    style_preferences: Optional[str] = None
    budget_range: Optional[str] = None
    room_id: Optional[str] = None
    source_photo_base64: Optional[str] = None


class InspirationReq(BaseModel):
    base64: Optional[str] = None
    notes: Optional[str] = None


class RefineReq(BaseModel):
    instruction: str


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/design-studio", tags=["design-studio"])

    @r.get("/projects")
    async def list_projects(user: dict = Depends(get_current_user)):
        rows = await _db.ds_projects.find({"user_id": user["id"], "status": {"$ne": "archived"}},
                                          {"_id": 0, "source_photo_base64": 0}).sort("updated_at", -1).to_list(50)
        return {"projects": rows}

    @r.post("/projects")
    async def create_project(req: ProjectReq, user: dict = Depends(get_current_user)):
        if req.design_type not in DESIGN_TYPES:
            raise HTTPException(status_code=400, detail="Invalid design type.")
        if not req.title.strip() or not req.objective.strip():
            raise HTTPException(status_code=400, detail="Give the design a name and a plain-words goal.")
        proj = {"id": _nid(), "user_id": user["id"], "design_type": req.design_type,
                "title": req.title.strip()[:120], "objective": req.objective.strip()[:600],
                "feel_goals": [g[:40] for g in (req.feel_goals or [])][:6],
                "style_preferences": (req.style_preferences or "")[:300] or None,
                "budget_range": (req.budget_range or "")[:60] or None,
                "room_id": req.room_id, "source_photo_base64": req.source_photo_base64,
                "status": "collecting_context", "current_version": 0, "buildability": None,
                "linked_issue_id": None, "created_at": _now(), "updated_at": _now()}
        await _db.ds_projects.insert_one(dict(proj))
        proj.pop("_id", None); proj.pop("source_photo_base64", None)
        proj["has_source_photo"] = bool(req.source_photo_base64)
        await _cap(user["id"], "DESIGN_PROJECT_CREATED", {"type": req.design_type})
        return {"project": proj}

    @r.get("/projects/{pid}")
    async def get_project(pid: str, user: dict = Depends(get_current_user)):
        proj = await _owned(pid, user["id"], {"_id": 0, "source_photo_base64": 0})
        proj["has_source_photo"] = bool(await _db.ds_projects.find_one({"id": pid, "source_photo_base64": {"$nin": [None, ""]}}, {"_id": 1}))
        versions = await _db.ds_versions.find({"project_id": pid}, {"_id": 0}).sort("version", -1).to_list(10)
        inspirations = await _db.ds_inspirations.find({"project_id": pid}, {"_id": 0, "base64": 0}).to_list(20)
        return {"project": proj, "versions": versions, "inspirations": inspirations,
                "disclaimer": CONCEPT_DISCLAIMER}

    @r.post("/projects/{pid}/inspiration")
    async def add_inspiration(pid: str, req: InspirationReq, user: dict = Depends(get_current_user)):
        await _owned(pid, user["id"], {"_id": 0, "id": 1})
        if not req.base64 and not (req.notes or "").strip():
            raise HTTPException(status_code=400, detail="Add a photo or a note.")
        doc = {"id": _nid(), "project_id": pid, "user_id": user["id"], "base64": req.base64,
               "notes": (req.notes or "")[:400] or None, "created_at": _now()}
        await _db.ds_inspirations.insert_one(dict(doc))
        # Style-pattern summary from accumulated notes (text-grounded, honest).
        notes = [i["notes"] for i in await _db.ds_inspirations.find({"project_id": pid}, {"_id": 0, "notes": 1}).to_list(20) if i.get("notes")]
        summary = None
        if notes:
            try:
                data = await _llm_json(
                    "Summarize the style pattern in these homeowner inspiration notes in ONE friendly sentence "
                    "starting with 'You seem drawn to'. Return STRICT JSON {summary: string}",
                    "\n".join(notes[:15]), max_tokens=150, feature_area="design_style_summary")
                summary = str(data.get("summary") or "")[:300] or None
            except Exception:
                pass
        if summary:
            await _db.ds_projects.update_one({"id": pid}, {"$set": {"style_summary": summary, "updated_at": _now()}})
        await _cap(user["id"], "INSPIRATION_ITEM_ADDED", {})
        return {"ok": True, "style_summary": summary}

    async def _make_version(proj: dict, uid: str, extra_instruction: Optional[str] = None,
                            base_image_b64: Optional[str] = None, on_progress: Optional[Callable] = None):
        async def _prog(pct, msg, status="running"):
            if on_progress:
                await on_progress(pct, msg, status)
        # 1. Written design direction (grounded in the user's goals).
        await _prog(15, "Sketching the design direction…")
        system = (
            "You are Homie creating an achievable DESIGN DIRECTION for a homeowner. Practical, buildable, "
            "budget-conscious — no fantasy renovations. Return STRICT JSON {style_name: short, "
            "palette: [3-4 color names], key_changes: [3-5 short achievable changes], materials: [2-4 items], "
            "lighting: short, image_prompt: one vivid but realistic sentence describing the finished space for an "
            "image generator (mention it should look like a real lived-in home photo)}"
        )
        ctx = (f"DESIGN TYPE: {proj['design_type']}\nGOAL: {proj['objective']}\n"
               f"FEEL: {proj.get('feel_goals')}\nSTYLE PREFS: {proj.get('style_preferences')}\n"
               f"STYLE PATTERN: {proj.get('style_summary')}\nBUDGET: {proj.get('budget_range') or 'not set'}\n"
               f"REFINEMENT REQUEST: {extra_instruction or '(initial concept)'}")
        try:
            d = await _llm_json(system, ctx, max_tokens=500, feature_area="design_direction")
            direction = {"style_name": str(d.get("style_name") or "Concept")[:80],
                         "palette": [str(p)[:40] for p in (d.get("palette") or [])][:4],
                         "key_changes": [str(k)[:200] for k in (d.get("key_changes") or [])][:5],
                         "materials": [str(m)[:80] for m in (d.get("materials") or [])][:4],
                         "lighting": str(d.get("lighting") or "")[:200]}
            image_prompt = str(d.get("image_prompt") or "")[:500]
        except Exception:
            direction = {"style_name": "Concept", "palette": [], "key_changes": [proj["objective"][:150]],
                         "materials": [], "lighting": ""}
            image_prompt = f"A realistic photo of a {proj['design_type'].replace('_', ' ')}: {proj['objective'][:200]}"
        # 2. Concept image (room-photo-aware edit when a photo exists).
        ref = base_image_b64
        if not ref:
            full = await _db.ds_projects.find_one({"id": proj["id"]}, {"_id": 0, "source_photo_base64": 1})
            ref = (full or {}).get("source_photo_base64")
        if ref:
            prompt = (f"Redesign the space in this photo, keeping the room's real layout, windows and doors. "
                      f"Apply: {image_prompt}" + (f" Additional change: {extra_instruction}" if extra_instruction else ""))
        else:
            prompt = image_prompt + (f" Additional change: {extra_instruction}" if extra_instruction else "")
        await _prog(55, "Rendering your concept image — usually under a minute…", "waiting_provider")
        image_b64 = await _generate_image(prompt, ref)
        await _prog(90, "Finishing up…")
        version_num = (proj.get("current_version") or 0) + 1
        ver = {"id": _nid(), "project_id": proj["id"], "user_id": uid, "version": version_num,
               "direction": direction, "changes": extra_instruction or "Initial concept",
               "image_base64": image_b64, "image_available": bool(image_b64),
               "disclaimer": CONCEPT_DISCLAIMER, "created_at": _now()}
        await _db.ds_versions.insert_one(dict(ver)); ver.pop("_id", None)
        await _db.ds_projects.update_one({"id": proj["id"]}, {"$set": {
            "current_version": version_num, "status": "concept_generated", "updated_at": _now()}})
        return ver

    @r.post("/projects/{pid}/concept")
    async def generate_concept(pid: str, user: dict = Depends(get_current_user)):
        proj = await _owned(pid, user["id"], {"_id": 0, "source_photo_base64": 0})
        import reliability_engine
        await reliability_engine.enforce_ai_budget(user["id"], "design_concept")
        job = await reliability_engine.create_job(user["id"], "design_concept", resource_id=pid)

        async def _work(progress):
            ver = await _make_version(proj, user["id"], on_progress=progress)
            await _cap(user["id"], "DESIGN_CONCEPT_GENERATED", {"has_image": ver["image_available"]})
            return {"version_id": ver["id"], "version": ver["version"]}

        reliability_engine.run_job(job["id"], _work,
                                   "The concept couldn't finish rendering. Your design brief is saved — try again in a moment.")
        return {"job_id": job["id"], "status": "queued", "message": job["message"]}

    @r.post("/projects/{pid}/refine")
    async def refine(pid: str, req: RefineReq, user: dict = Depends(get_current_user)):
        if not (req.instruction or "").strip():
            raise HTTPException(status_code=400, detail="Tell Homie what to change.")
        proj = await _owned(pid, user["id"], {"_id": 0, "source_photo_base64": 0})
        if proj.get("linked_issue_id"):
            raise HTTPException(status_code=409, detail="This design was already converted to a project — refining it won't change the build plan. Start a new design instead.")
        import reliability_engine
        await reliability_engine.enforce_ai_budget(user["id"], "design_refine")
        latest = await _db.ds_versions.find_one({"project_id": pid}, {"_id": 0, "image_base64": 1}, sort=[("version", -1)])
        job = await reliability_engine.create_job(user["id"], "design_refine", resource_id=pid)
        instruction = req.instruction.strip()[:300]
        base_img = (latest or {}).get("image_base64")

        async def _work(progress):
            ver = await _make_version(proj, user["id"], instruction, base_img, on_progress=progress)
            await _cap(user["id"], "DESIGN_VERSION_CREATED", {"has_image": ver["image_available"]})
            return {"version_id": ver["id"], "version": ver["version"]}

        reliability_engine.run_job(job["id"], _work,
                                   "The refinement couldn't finish. Your previous versions are safe — try again in a moment.")
        return {"job_id": job["id"], "status": "queued", "message": job["message"]}

    @r.post("/projects/{pid}/buildability")
    async def buildability(pid: str, user: dict = Depends(get_current_user)):
        proj = await _owned(pid, user["id"], {"_id": 0, "source_photo_base64": 0})
        latest = await _db.ds_versions.find_one({"project_id": pid}, {"_id": 0, "image_base64": 0}, sort=[("version", -1)])
        if not latest:
            raise HTTPException(status_code=400, detail="Generate a concept first.")
        system = (
            "You are Homie doing an honest BUILDABILITY REVIEW of a design concept for a homeowner. "
            "Strictly separate categories — never blend taste with safety. Return STRICT JSON "
            "{verdict: one of [looks_buildable, needs_review, professional_recommended], "
            "taste: [personal-preference notes], buildability: [practical fit/effort concerns], "
            "safety: [safety concerns, empty if none], budget: [cost concerns vs their budget], "
            "permit: [likely permit/professional flags, empty if none], "
            "measure_first: [2-4 specific measurements to take before buying anything]}"
        )
        ctx = (f"DESIGN TYPE: {proj['design_type']}\nGOAL: {proj['objective']}\nBUDGET: {proj.get('budget_range') or 'not set'}\n"
               f"DIRECTION: {latest.get('direction')}")
        try:
            d = await _llm_json(system, ctx, max_tokens=600, feature_area="design_buildability")
            review = {"verdict": d.get("verdict") if d.get("verdict") in ("looks_buildable", "needs_review", "professional_recommended") else "needs_review",
                      "taste": [str(x)[:200] for x in (d.get("taste") or [])][:4],
                      "buildability": [str(x)[:200] for x in (d.get("buildability") or [])][:4],
                      "safety": [str(x)[:200] for x in (d.get("safety") or [])][:4],
                      "budget": [str(x)[:200] for x in (d.get("budget") or [])][:3],
                      "permit": [str(x)[:200] for x in (d.get("permit") or [])][:3],
                      "measure_first": [str(x)[:200] for x in (d.get("measure_first") or [])][:4],
                      "reviewed_at": _now()}
        except Exception:
            raise HTTPException(status_code=502, detail="Couldn't run the review right now — try again shortly.")
        await _db.ds_projects.update_one({"id": pid}, {"$set": {"buildability": review, "status": "buildability_reviewed", "updated_at": _now()}})
        await _cap(user["id"], "DESIGN_BUILDABILITY_REVIEWED", {"verdict": review["verdict"]})
        return {"buildability": review}

    @r.post("/projects/{pid}/approve")
    async def approve(pid: str, user: dict = Depends(get_current_user)):
        proj = await _owned(pid, user["id"], {"_id": 0, "id": 1, "current_version": 1})
        if not proj.get("current_version"):
            raise HTTPException(status_code=400, detail="Generate a concept before approving.")
        await _db.ds_projects.update_one({"id": pid}, {"$set": {"status": "approved", "updated_at": _now()}})
        await _cap(user["id"], "DESIGN_APPROVED", {})
        return {"ok": True}

    @r.post("/projects/{pid}/convert")
    async def convert(pid: str, user: dict = Depends(get_current_user)):
        proj = await _owned(pid, user["id"], {"_id": 0, "source_photo_base64": 0})
        if proj.get("linked_issue_id"):
            return {"issue_id": proj["linked_issue_id"], "route": f"/home-intel/repair/{proj['linked_issue_id']}", "already": True}
        latest = await _db.ds_versions.find_one({"project_id": pid}, {"_id": 0, "image_base64": 0}, sort=[("version", -1)])
        direction = (latest or {}).get("direction") or {}
        changes = "; ".join(direction.get("key_changes") or [])[:400]
        desc = f"Design build: {proj['title']} — {proj['objective'][:200]}" + (f". Plan: {changes}" if changes else "")
        issue = {"id": _nid(), "user_id": user["id"], "description": desc[:600],
                 "category": "other_unsure" if proj["design_type"] != "exterior" else "exterior",
                 "phase": "ISSUE_REPORTED", "status": "active", "room_id": proj.get("room_id"),
                 "property_id": None, "triage": {"hard_stop": False, "matched": []},
                 "source": "design_studio", "design_project_id": pid,
                 "created_at": _now(), "updated_at": _now()}
        await _db.gr_issues.insert_one(dict(issue))
        await _db.ds_projects.update_one({"id": pid}, {"$set": {"status": "converted", "linked_issue_id": issue["id"], "updated_at": _now()}})
        await _cap(user["id"], "DESIGN_CONVERTED_TO_PROJECT", {})
        return {"issue_id": issue["id"], "route": f"/home-intel/repair/{issue['id']}"}

    return r
