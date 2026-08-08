"""
DIYhomie — Account, Property Onboarding & Guidance Preferences (Build Blueprint 08).

Extends the existing JWT auth (does NOT duplicate it). Adds:
- Guidance preferences (experience, budget sensitivity, risk tolerance, tone, units)
  that Homie chat + the project planner adapt to.
- Rich property profiles with multi-property SETUP (create/manage several homes,
  mark one active). Cross-feature "active-home switching" is a planned follow-up.
- A lightweight onboarding status/checklist + guest marker.

Collections: hi_user_prefs   Shares/extends: hi_properties, hi_rooms, hi_assets, hi_analytics
"""
import uuid
from datetime import datetime, timezone
from typing import Optional, Callable

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

EXPERIENCE = ["beginner", "intermediate", "advanced"]
BUDGET = ["low", "medium", "high"]
RISK = ["cautious", "balanced", "hands_on"]
TONE = ["friendly", "concise", "detailed"]
UNITS = ["imperial", "metric"]
PROP_TYPES = ["House", "Apartment", "Condo", "Townhouse", "Mobile Home", "Other"]


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


def _now():
    return datetime.now(timezone.utc).isoformat()


def _new_id():
    return str(uuid.uuid4())


async def _track(user_id, event, meta=None):
    try:
        await _db.hi_analytics.insert_one({"id": _new_id(), "user_id": user_id, "event": event, "meta": meta or {}, "at": _now()})
    except Exception:
        pass


async def _get_prefs(user_id: str) -> dict:
    p = await _db.hi_user_prefs.find_one({"user_id": user_id}, {"_id": 0})
    if not p:
        p = {"user_id": user_id, "experience_level": "beginner", "budget_sensitivity": "medium",
             "risk_tolerance": "balanced", "tone": "friendly", "units": "imperial",
             "onboarding_complete": False, "is_guest": False, "created_at": _now(), "updated_at": _now()}
        await _db.hi_user_prefs.insert_one(dict(p))
        p.pop("_id", None)
    return p


async def _ensure_active_property(user_id: str):
    """Make sure exactly one property is flagged active; create a default if none."""
    props = await _db.hi_properties.find({"user_id": user_id}, {"_id": 0}).to_list(50)
    if not props:
        doc = {"id": _new_id(), "user_id": user_id, "name": "My Home", "address": None,
               "property_type": None, "year_built": None, "square_footage": None,
               "climate_zone": None, "is_active": True, "created_at": _now(), "updated_at": _now()}
        await _db.hi_properties.insert_one(dict(doc))
        return
    if not any(p.get("is_active") for p in props):
        await _db.hi_properties.update_one({"id": props[0]["id"]}, {"$set": {"is_active": True}})


# ---------------------------------------------------------------- external hook
async def get_guidance_context(user_id: str) -> str:
    """Short guidance-preference block for Homie chat + project planner prompts."""
    if _db is None:
        return ""
    try:
        p = await _db.hi_user_prefs.find_one({"user_id": user_id}, {"_id": 0})
        if not p:
            return ""
        return (f"USER GUIDANCE PREFERENCES — adapt to these: experience={p.get('experience_level')}, "
                f"budget_sensitivity={p.get('budget_sensitivity')} (higher = prefer cheaper options), "
                f"risk_tolerance={p.get('risk_tolerance')} (cautious = recommend a pro sooner), "
                f"tone={p.get('tone')}, units={p.get('units')} (use these measurement units).")
    except Exception:
        return ""


async def default_skill_level(user_id: str) -> Optional[str]:
    p = await _db.hi_user_prefs.find_one({"user_id": user_id}, {"_id": 0, "experience_level": 1})
    return p.get("experience_level") if p else None


# =============================================================== models
class PrefsReq(BaseModel):
    experience_level: Optional[str] = None
    budget_sensitivity: Optional[str] = None
    risk_tolerance: Optional[str] = None
    tone: Optional[str] = None
    units: Optional[str] = None
    is_guest: Optional[bool] = None


class PropertyReq(BaseModel):
    name: str
    address: Optional[str] = None
    property_type: Optional[str] = None
    year_built: Optional[int] = None
    square_footage: Optional[int] = None
    climate_zone: Optional[str] = None


class PropertyEditReq(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    property_type: Optional[str] = None
    year_built: Optional[int] = None
    square_footage: Optional[int] = None
    climate_zone: Optional[str] = None


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/account", dependencies=[Depends(get_current_user)])

    @r.get("/overview")
    async def overview(user: dict = Depends(get_current_user)):
        prefs = await _get_prefs(user["id"])
        await _ensure_active_property(user["id"])
        props = await _db.hi_properties.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", 1).to_list(50)
        room_count = await _db.hi_rooms.count_documents({"user_id": user["id"]})
        active = next((p for p in props if p.get("is_active")), props[0] if props else None)
        asset_count = await _db.hi_assets.count_documents({"property_id": active["id"]}) if active else 0
        steps = [
            {"key": "profile", "label": "Set your DIY experience", "done": prefs.get("experience_level") is not None},
            {"key": "property", "label": "Add your home details", "done": bool(active and active.get("property_type"))},
            {"key": "rooms", "label": "Map a room", "done": room_count > 0},
            {"key": "assets", "label": "Add a home asset", "done": asset_count > 0},
        ]
        done = sum(1 for s in steps if s["done"])
        return {"preferences": prefs, "properties": props, "active_property_id": active["id"] if active else None,
                "onboarding": {"complete": prefs.get("onboarding_complete", False), "steps": steps,
                               "progress": round(done / len(steps) * 100)}}

    @r.get("/preferences")
    async def get_preferences(user: dict = Depends(get_current_user)):
        return await _get_prefs(user["id"])

    @r.put("/preferences")
    async def set_preferences(req: PrefsReq, user: dict = Depends(get_current_user)):
        await _get_prefs(user["id"])
        upd = {"updated_at": _now()}
        mapping = {"experience_level": EXPERIENCE, "budget_sensitivity": BUDGET,
                   "risk_tolerance": RISK, "tone": TONE, "units": UNITS}
        for f, valid in mapping.items():
            v = getattr(req, f)
            if v is not None and v in valid:
                upd[f] = v
        if req.is_guest is not None:
            upd["is_guest"] = bool(req.is_guest)
        await _db.hi_user_prefs.update_one({"user_id": user["id"]}, {"$set": upd})
        await _track(user["id"], "guidance_preferences_updated", {k: upd[k] for k in upd if k != "updated_at"})
        return await _db.hi_user_prefs.find_one({"user_id": user["id"]}, {"_id": 0})

    @r.post("/onboarding/complete")
    async def complete_onboarding(user: dict = Depends(get_current_user)):
        await _get_prefs(user["id"])
        await _db.hi_user_prefs.update_one({"user_id": user["id"]}, {"$set": {"onboarding_complete": True, "updated_at": _now()}})
        await _track(user["id"], "onboarding_completed")
        return {"ok": True}

    # ---------------- properties (multi-property setup)
    @r.get("/properties")
    async def list_properties(user: dict = Depends(get_current_user)):
        await _ensure_active_property(user["id"])
        props = await _db.hi_properties.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", 1).to_list(50)
        return {"properties": props}

    @r.post("/properties")
    async def create_property(req: PropertyReq, user: dict = Depends(get_current_user)):
        if not req.name.strip():
            raise HTTPException(status_code=400, detail="Give this home a name.")
        existing = await _db.hi_properties.count_documents({"user_id": user["id"]})
        doc = {"id": _new_id(), "user_id": user["id"], "name": req.name.strip()[:80], "address": req.address,
               "property_type": req.property_type if req.property_type in PROP_TYPES else req.property_type,
               "year_built": req.year_built, "square_footage": req.square_footage, "climate_zone": req.climate_zone,
               "is_active": existing == 0, "created_at": _now(), "updated_at": _now()}
        await _db.hi_properties.insert_one(dict(doc))
        await _track(user["id"], "property_added", {"property_id": doc["id"]})
        doc.pop("_id", None)
        return doc

    @r.put("/properties/{pid}")
    async def edit_property(pid: str, req: PropertyEditReq, user: dict = Depends(get_current_user)):
        p = await _db.hi_properties.find_one({"id": pid, "user_id": user["id"]}, {"_id": 0})
        if not p:
            raise HTTPException(status_code=404, detail="Home not found.")
        upd = {"updated_at": _now()}
        for f in ("name", "address", "property_type", "year_built", "square_footage", "climate_zone"):
            v = getattr(req, f)
            if v is not None:
                upd[f] = v
        await _db.hi_properties.update_one({"id": pid}, {"$set": upd})
        return await _db.hi_properties.find_one({"id": pid}, {"_id": 0})

    @r.post("/properties/{pid}/activate")
    async def activate_property(pid: str, user: dict = Depends(get_current_user)):
        p = await _db.hi_properties.find_one({"id": pid, "user_id": user["id"]}, {"_id": 0})
        if not p:
            raise HTTPException(status_code=404, detail="Home not found.")
        await _db.hi_properties.update_many({"user_id": user["id"]}, {"$set": {"is_active": False}})
        await _db.hi_properties.update_one({"id": pid}, {"$set": {"is_active": True, "updated_at": _now()}})
        await _track(user["id"], "property_activated", {"property_id": pid})
        return {"ok": True, "active_property_id": pid}

    @r.delete("/properties/{pid}")
    async def delete_property(pid: str, user: dict = Depends(get_current_user)):
        count = await _db.hi_properties.count_documents({"user_id": user["id"]})
        if count <= 1:
            raise HTTPException(status_code=409, detail="You need at least one home. Add another before removing this one.")
        p = await _db.hi_properties.find_one({"id": pid, "user_id": user["id"]}, {"_id": 0})
        if not p:
            raise HTTPException(status_code=404, detail="Home not found.")
        await _db.hi_properties.delete_one({"id": pid})
        if p.get("is_active"):
            await _ensure_active_property(user["id"])
        return {"ok": True}

    return r
