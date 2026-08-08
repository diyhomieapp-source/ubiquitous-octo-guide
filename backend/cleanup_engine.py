"""
DIYhomie — Project Cleanup, Leftover Materials & Disposal Guidance (Blueprint 16).

Completes the project lifecycle: after a project is done, help the user organise
leftovers and waste and pick a next step (keep / reuse / donate / recycle /
dispose). Disposal guidance is conservative, safety-first, GENERAL guidance — it
never claims local legal compliance, recycling acceptance, or facility lookup.

NOT in scope: municipal disposal lookup, hazardous-waste facility search, resale
marketplace, donation valuation, legal guarantees.

Collections: hi_cleanup_sessions, hi_leftover_materials, hi_waste_items,
hi_disposal_guidance, hi_cleanup_outcomes.
"""
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

WASTE_CATEGORIES = ["Clean cardboard", "Metal", "Untreated wood", "Treated wood", "Paint",
                    "Chemical or solvent", "Adhesive or caulk", "Concrete or masonry", "Drywall",
                    "Tile", "Electronics", "Batteries", "Yard waste", "Other"]

# category -> (risk_level, safety_note, guidance_text, local_verification_required)
GUIDANCE = {
    "Clean cardboard": ("low", "No special handling needed.", "Flatten and recycle with paper/cardboard, or reuse for storage.", True),
    "Metal": ("low", "Watch for sharp edges.", "Most metals are recyclable. Keep usable offcuts for future projects.", True),
    "Untreated wood": ("low", "Watch for nails and splinters.", "Keep usable pieces for future projects or dispose according to local waste rules.", True),
    "Treated wood": ("medium", "Do not burn treated wood — it can release harmful chemicals.", "Treated/painted wood usually can't go in yard waste or be burned. Check local disposal rules.", True),
    "Paint": ("high", "Do not pour paint into drains or put liquid paint in the trash.", "Dry out small amounts of latex paint, or check local household hazardous-waste / dried-paint guidance for oil-based paint.", True),
    "Chemical or solvent": ("high", "Do not mix, pour down drains, or place in ordinary trash. Keep away from children, heat and flames.", "Keep the container sealed and labelled. Verify disposal with a local household hazardous-waste program.", True),
    "Adhesive or caulk": ("medium", "Avoid skin contact with wet product; ensure ventilation.", "Fully cured adhesive is usually trash-safe; liquid/uncured product may be hazardous — check local rules.", True),
    "Concrete or masonry": ("low", "Heavy — lift carefully.", "Often accepted at construction-debris drop-off. Reuse small pieces as fill where appropriate.", True),
    "Drywall": ("medium", "Dust can irritate lungs — wear a mask.", "Some areas restrict drywall (gypsum) disposal. Check local construction-waste rules.", True),
    "Tile": ("low", "Sharp edges — handle with care.", "Keep spare tiles for repairs, or dispose as construction debris.", True),
    "Electronics": ("medium", "May contain batteries or hazardous components.", "Use an e-waste recycler; don't put electronics in ordinary trash.", True),
    "Batteries": ("high", "Do not puncture, crush, or incinerate. Tape terminals of lithium batteries.", "Take to a battery/e-waste drop-off. Never place in household trash or recycling.", True),
    "Yard waste": ("low", "Watch for thorns/allergens.", "Compost or use a local yard-waste program.", True),
    "Other": ("unknown", "If you're unsure what this is, treat it as potentially hazardous.", "Do not mix or dispose of unidentified items. Keep away from children, heat and drains, and verify locally.", True),
}
HAZARD_KEYWORDS = ["propane", "cylinder", "fluorescent", "asbestos", "lead", "leak", "solvent", "acid", "gasoline"]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


async def _cap(user, event, props=None):
    try:
        import analytics_engine
        await analytics_engine.capture(user, event, props or {})
    except Exception:
        pass


async def _session(sid: str, user_id: str) -> dict:
    s = await _db.hi_cleanup_sessions.find_one({"id": sid, "user_id": user_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Cleanup session not found.")
    return s


# ------------------------------------------------------------- models
class StartReq(BaseModel):
    project_id: str


class LeftoverReq(BaseModel):
    name: str
    material_category: str = "Other"
    quantity: Optional[float] = None
    unit: Optional[str] = None
    condition: Optional[str] = "good"
    storage_location: Optional[str] = None
    photo_url: Optional[str] = None
    user_selected_action: Optional[str] = None


class LeftoverUpdateReq(BaseModel):
    user_selected_action: Optional[str] = None
    status: Optional[str] = None
    storage_location: Optional[str] = None


class WasteReq(BaseModel):
    name: str
    waste_category: str = "Other"
    estimated_quantity: Optional[float] = None
    unit: Optional[str] = None
    condition: str = "unknown"
    photo_url: Optional[str] = None


class WasteUpdateReq(BaseModel):
    user_selected_action: Optional[str] = None
    guidance_status: Optional[str] = None


def _recommend_action(category: str, condition: Optional[str]) -> str:
    hazardous = category in ("Paint", "Chemical or solvent", "Batteries", "Electronics", "Treated wood")
    if hazardous:
        return "dispose"
    if (condition or "good") in ("good", "new", "usable"):
        return "keep"
    return "recycle"


# ============================================================= router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/cleanup", dependencies=[Depends(get_current_user)])

    @r.post("/sessions")
    async def start(req: StartReq, user: dict = Depends(get_current_user)):
        proj = await _db.hi_projects.find_one({"id": req.project_id, "user_id": user["id"]}, {"_id": 0})
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found.")
        existing = await _db.hi_cleanup_sessions.find_one({"project_id": req.project_id, "user_id": user["id"], "status": {"$ne": "completed"}}, {"_id": 0})
        if existing:
            return existing
        s = {"id": _nid(), "project_id": req.project_id, "user_id": user["id"],
             "property_id": proj.get("property_id"), "status": "active",
             "created_at": _now(), "completed_at": None}
        await _db.hi_cleanup_sessions.insert_one(dict(s))
        await _cap(user, "cleanup_session_started", {})
        s.pop("_id", None)
        return s

    @r.get("/sessions/by-project/{project_id}")
    async def by_project(project_id: str, user: dict = Depends(get_current_user)):
        s = await _db.hi_cleanup_sessions.find_one({"project_id": project_id, "user_id": user["id"]}, {"_id": 0}, sort=[("created_at", -1)])
        return {"session": s}

    @r.get("/sessions/{sid}")
    async def get_session(sid: str, user: dict = Depends(get_current_user)):
        s = await _session(sid, user["id"])
        leftovers = await _db.hi_leftover_materials.find({"cleanup_session_id": sid}, {"_id": 0}).sort("created_at", 1).to_list(200)
        waste = await _db.hi_waste_items.find({"cleanup_session_id": sid}, {"_id": 0}).sort("created_at", 1).to_list(200)
        outcome = await _db.hi_cleanup_outcomes.find_one({"cleanup_session_id": sid}, {"_id": 0})
        return {"session": s, "leftovers": leftovers, "waste": waste, "outcome": outcome}

    @r.post("/sessions/{sid}/leftovers")
    async def add_leftover(sid: str, req: LeftoverReq, user: dict = Depends(get_current_user)):
        await _session(sid, user["id"])
        if not req.name.strip():
            raise HTTPException(status_code=400, detail="Give the material a name.")
        rec = _recommend_action(req.material_category, req.condition)
        m = {"id": _nid(), "cleanup_session_id": sid, "inventory_item_id": None, "name": req.name.strip()[:120],
             "material_category": req.material_category, "quantity": req.quantity, "unit": req.unit,
             "condition": req.condition, "storage_location": req.storage_location, "photo_url": req.photo_url,
             "recommended_action": rec, "user_selected_action": req.user_selected_action,
             "status": "active", "created_at": _now(), "updated_at": _now()}
        await _db.hi_leftover_materials.insert_one(dict(m))
        await _cap(user, "leftover_material_added", {"material_category": req.material_category, "recommended_action": rec})
        m.pop("_id", None)
        return m

    @r.put("/leftovers/{lid}")
    async def update_leftover(lid: str, req: LeftoverUpdateReq, user: dict = Depends(get_current_user)):
        lo = await _db.hi_leftover_materials.find_one({"id": lid}, {"_id": 0})
        if not lo or not await _db.hi_cleanup_sessions.find_one({"id": lo["cleanup_session_id"], "user_id": user["id"]}):
            raise HTTPException(status_code=404, detail="Item not found.")
        upd = {"updated_at": _now()}
        for f in ("user_selected_action", "status", "storage_location"):
            v = getattr(req, f)
            if v is not None:
                upd[f] = v
        await _db.hi_leftover_materials.update_one({"id": lid}, {"$set": upd})
        return await _db.hi_leftover_materials.find_one({"id": lid}, {"_id": 0})

    @r.post("/leftovers/{lid}/to-inventory")
    async def to_inventory(lid: str, user: dict = Depends(get_current_user)):
        lo = await _db.hi_leftover_materials.find_one({"id": lid}, {"_id": 0})
        if not lo:
            raise HTTPException(status_code=404, detail="Item not found.")
        sess = await _db.hi_cleanup_sessions.find_one({"id": lo["cleanup_session_id"], "user_id": user["id"]}, {"_id": 0})
        if not sess:
            raise HTTPException(status_code=404, detail="Item not found.")
        if lo.get("inventory_item_id"):
            raise HTTPException(status_code=400, detail="Already in inventory.")
        inv = {"id": _nid(), "user_id": user["id"], "property_id": sess.get("property_id"),
               "name": lo["name"], "category": "material", "item_type": lo.get("material_category"),
               "quantity": lo.get("quantity") or 1, "unit": lo.get("unit"),
               "location": lo.get("storage_location"), "condition": lo.get("condition"),
               "photo_base64": None, "source_project_id": sess.get("project_id"),
               "status": "active", "created_at": _now(), "updated_at": _now()}
        await _db.hi_inventory_items.insert_one(dict(inv))
        await _db.hi_leftover_materials.update_one({"id": lid}, {"$set": {"inventory_item_id": inv["id"], "status": "moved_to_inventory", "updated_at": _now()}})
        await _cap(user, "material_moved_to_inventory", {})
        return {"ok": True, "inventory_item_id": inv["id"]}

    @r.post("/sessions/{sid}/waste")
    async def add_waste(sid: str, req: WasteReq, user: dict = Depends(get_current_user)):
        await _session(sid, user["id"])
        cat = req.waste_category if req.waste_category in WASTE_CATEGORIES else "Other"
        risk, safety, text, verify = GUIDANCE.get(cat, GUIDANCE["Other"])
        # escalate risk if hazard keywords appear in the name
        if any(k in (req.name or "").lower() for k in HAZARD_KEYWORDS):
            risk = "high"
            safety = "This may be hazardous. Do not puncture, burn, mix, or pour down drains. Keep away from children and heat."
        w = {"id": _nid(), "cleanup_session_id": sid, "name": req.name.strip()[:120], "waste_category": cat,
             "estimated_quantity": req.estimated_quantity, "unit": req.unit, "condition": req.condition,
             "photo_url": req.photo_url, "risk_level": risk, "guidance_status": "pending",
             "user_selected_action": None, "created_at": _now(), "updated_at": _now()}
        await _db.hi_waste_items.insert_one(dict(w))
        g = {"id": _nid(), "waste_item_id": w["id"], "guidance_text": text, "safety_note": safety,
             "confidence_level": "high" if cat != "Other" else "low",
             "source_type": "general_guidance", "local_verification_required": verify, "created_at": _now()}
        await _db.hi_disposal_guidance.insert_one(dict(g))
        await _cap(user, "waste_item_added", {"waste_category": cat})
        await _cap(user, "waste_item_classified", {"risk_level": risk})
        w.pop("_id", None); g.pop("_id", None)
        return {"waste": w, "guidance": g}

    @r.get("/waste/{wid}/guidance")
    async def get_guidance(wid: str, user: dict = Depends(get_current_user)):
        w = await _db.hi_waste_items.find_one({"id": wid}, {"_id": 0})
        if not w or not await _db.hi_cleanup_sessions.find_one({"id": w["cleanup_session_id"], "user_id": user["id"]}):
            raise HTTPException(status_code=404, detail="Item not found.")
        g = await _db.hi_disposal_guidance.find_one({"waste_item_id": wid}, {"_id": 0})
        await _cap(user, "disposal_guidance_viewed", {"waste_category": w["waste_category"]})
        return {"waste": w, "guidance": g}

    @r.put("/waste/{wid}")
    async def update_waste(wid: str, req: WasteUpdateReq, user: dict = Depends(get_current_user)):
        w = await _db.hi_waste_items.find_one({"id": wid}, {"_id": 0})
        if not w or not await _db.hi_cleanup_sessions.find_one({"id": w["cleanup_session_id"], "user_id": user["id"]}):
            raise HTTPException(status_code=404, detail="Item not found.")
        upd = {"updated_at": _now()}
        if req.user_selected_action is not None:
            upd["user_selected_action"] = req.user_selected_action
        if req.guidance_status is not None:
            upd["guidance_status"] = req.guidance_status
            if req.guidance_status == "handled":
                await _cap(user, "waste_item_marked_handled", {})
        await _db.hi_waste_items.update_one({"id": wid}, {"$set": upd})
        return await _db.hi_waste_items.find_one({"id": wid}, {"_id": 0})

    @r.post("/sessions/{sid}/complete")
    async def complete(sid: str, user: dict = Depends(get_current_user)):
        s = await _session(sid, user["id"])
        leftovers = await _db.hi_leftover_materials.find({"cleanup_session_id": sid}, {"_id": 0}).to_list(500)
        waste = await _db.hi_waste_items.find({"cleanup_session_id": sid}, {"_id": 0}).to_list(500)
        saved = len([l for l in leftovers if l["status"] in ("active", "handled", "moved_to_inventory")])
        to_inv = len([l for l in leftovers if l["status"] == "moved_to_inventory"])
        handled = len([w for w in waste if w["guidance_status"] == "handled"])
        unresolved = len([w for w in waste if w["guidance_status"] != "handled"]) + len([l for l in leftovers if l["status"] == "active"])
        outcome = {"id": _nid(), "cleanup_session_id": sid, "materials_saved_count": saved,
                   "materials_added_to_inventory_count": to_inv, "waste_items_handled_count": handled,
                   "unresolved_items_count": unresolved, "created_at": _now()}
        await _db.hi_cleanup_outcomes.update_one({"cleanup_session_id": sid}, {"$set": outcome}, upsert=True)
        await _db.hi_cleanup_sessions.update_one({"id": sid}, {"$set": {"status": "completed", "completed_at": _now()}})
        # record into property history
        try:
            await _db.hi_property_history.insert_one({
                "id": _nid(), "user_id": user["id"], "property_id": s.get("property_id"),
                "kind": "project_cleanup", "project_id": s.get("project_id"),
                "note": f"Cleanup complete: {saved} materials kept, {to_inv} to inventory, {handled} waste items handled, {unresolved} unresolved.",
                "at": _now()})
        except Exception:
            pass
        await _cap(user, "cleanup_session_completed", {"unresolved_items": unresolved})
        outcome.pop("_id", None)
        return outcome

    return r
