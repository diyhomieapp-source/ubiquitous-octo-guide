"""
DIYhomie — Tool, Material & Supply Inventory (Build Blueprint 07).

Track the tools, materials and supplies a user already owns (with storage
locations, quantities and photos), identify items from a photo, and match a
project's shopping list against the inventory into Already Have / Need to Buy /
Need Verification — writing back to the project material statuses (B03).

Collections: hi_inventory_items
Shares: hi_properties, hi_project_materials, hi_analytics
LLM: OpenAI gpt-4o vision (photo identify) via Emergent LLM key.
"""
import re
import uuid
from datetime import datetime, timezone
from typing import Optional, Callable, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None
_llm_key = ""

CATEGORIES = ["Tool", "Material", "Supply", "Safety", "Hardware", "Paint", "Other"]
STATUSES = ["have", "low", "out"]
CONSUMABLE = {"Material", "Supply", "Paint", "Hardware"}


def configure(db, logger, llm_key: str):
    global _db, _logger, _llm_key
    _db, _logger, _llm_key = db, logger, (llm_key or "")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _new_id():
    return str(uuid.uuid4())


async def _get_or_create_property(user_id):
    prop = await _db.hi_properties.find_one({"user_id": user_id}, {"_id": 0})
    if not prop:
        prop = {"id": _new_id(), "user_id": user_id, "name": "My Home", "address": None,
                "property_type": None, "created_at": _now()}
        await _db.hi_properties.insert_one(dict(prop))
    return prop


async def _track(user_id, event, meta=None):
    try:
        await _db.hi_analytics.insert_one({"id": _new_id(), "user_id": user_id, "event": event, "meta": meta or {}, "at": _now()})
    except Exception:
        pass


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", (s or "").lower()).strip()


STOP = {"the", "a", "an", "of", "for", "and", "with", "set", "pack", "kit", "inch", "in", "ft", "x"}


def _tokens(s: str) -> set:
    return {w for w in _norm(s).split() if len(w) >= 3 and w not in STOP}


def _matches(material_name: str, item_name: str) -> bool:
    a, b = _norm(material_name), _norm(item_name)
    if not a or not b:
        return False
    if a in b or b in a:
        return True
    ta, tb = _tokens(material_name), _tokens(item_name)
    return bool(ta & tb)


async def _identify(image_base64: str) -> dict:
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
        chat = LlmChat(api_key=_llm_key, session_id=_new_id(), system_message=(
            "Identify a tool, material or supply from a photo. Return STRICT JSON: "
            "{\"name\": short label, \"category\": one of [Tool, Material, Supply, Safety, Hardware, "
            "Paint, Other], \"brand\": string|null, \"quantity\": string|null, \"unit\": string|null, "
            "\"description\": one honest sentence, \"confidence\": one of [High, Medium, Low]}. If unsure, "
            "use Low confidence.")).with_model("openai", "gpt-4o")
        out = await chat.send_message(UserMessage(text="Identify this item. Return only JSON.", file_contents=[ImageContent(image_base64)]))
        from json import loads
        s = (out or "").strip()
        if s.startswith("```"):
            s = re.sub(r"^```[a-zA-Z]*\n?|\n?```$", "", s).strip()
        return loads(s)
    except Exception as e:
        if _logger:
            _logger.warning(f"inventory identify failed: {e}")
        return {}


# =============================================================== models
class ItemReq(BaseModel):
    name: str
    category: str = "Tool"
    brand: Optional[str] = None
    model_number: Optional[str] = None
    quantity: Optional[str] = None
    unit: Optional[str] = None
    storage_location: Optional[str] = None
    status: str = "have"
    photo_base64: Optional[str] = None
    notes: Optional[str] = None


class ItemEditReq(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    brand: Optional[str] = None
    model_number: Optional[str] = None
    quantity: Optional[str] = None
    unit: Optional[str] = None
    storage_location: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class IdentifyReq(BaseModel):
    image_base64: str


class ApplyMatchReq(BaseModel):
    apply: bool = True


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/inventory", dependencies=[Depends(get_current_user)])

    async def _owned(item_id, user_id):
        it = await _db.hi_inventory_items.find_one({"id": item_id, "user_id": user_id}, {"_id": 0})
        if not it:
            raise HTTPException(status_code=404, detail="Item not found.")
        return it

    @r.get("")
    async def list_items(q: Optional[str] = None, category: Optional[str] = None,
                         location: Optional[str] = None, user: dict = Depends(get_current_user)):
        query = {"user_id": user["id"], "status": {"$ne": "archived"}}
        if category:
            query["category"] = category
        if location:
            query["storage_location"] = location
        if q:
            query["name"] = {"$regex": q, "$options": "i"}
        items = await _db.hi_inventory_items.find(query, {"_id": 0, "photo_base64": 0}).sort("updated_at", -1).to_list(500)
        return {"items": items, "total": len(items)}

    @r.get("/locations")
    async def locations(user: dict = Depends(get_current_user)):
        locs = await _db.hi_inventory_items.distinct("storage_location", {"user_id": user["id"], "status": {"$ne": "archived"}})
        return {"locations": [l for l in locs if l]}

    @r.post("")
    async def add_item(req: ItemReq, user: dict = Depends(get_current_user)):
        if not req.name.strip():
            raise HTTPException(status_code=400, detail="Name is required.")
        prop = await _get_or_create_property(user["id"])
        doc = {"id": _new_id(), "user_id": user["id"], "property_id": prop["id"],
               "name": req.name.strip()[:120], "category": req.category if req.category in CATEGORIES else "Other",
               "brand": req.brand, "model_number": req.model_number, "quantity": req.quantity, "unit": req.unit,
               "storage_location": (req.storage_location or "").strip() or None,
               "status": req.status if req.status in STATUSES else "have",
               "photo_base64": req.photo_base64, "notes": req.notes,
               "created_at": _now(), "updated_at": _now()}
        await _db.hi_inventory_items.insert_one(dict(doc))
        await _track(user["id"], "inventory_item_added", {"category": doc["category"]})
        doc.pop("_id", None)
        doc.pop("photo_base64", None)
        return doc

    @r.post("/identify")
    async def identify(req: IdentifyReq, user: dict = Depends(get_current_user)):
        if not req.image_base64:
            raise HTTPException(status_code=400, detail="A photo is required.")
        result = await _identify(req.image_base64)
        return {"identification": result or {}}

    @r.get("/{item_id}")
    async def item_detail(item_id: str, user: dict = Depends(get_current_user)):
        it = await _owned(item_id, user["id"])
        return it

    @r.put("/{item_id}")
    async def edit_item(item_id: str, req: ItemEditReq, user: dict = Depends(get_current_user)):
        await _owned(item_id, user["id"])
        upd = {"updated_at": _now()}
        for f in ("name", "brand", "model_number", "quantity", "unit", "notes"):
            v = getattr(req, f)
            if v is not None:
                upd[f] = v
        if req.category in CATEGORIES:
            upd["category"] = req.category
        if req.status in STATUSES:
            upd["status"] = req.status
        if req.storage_location is not None:
            upd["storage_location"] = req.storage_location.strip() or None
        await _db.hi_inventory_items.update_one({"id": item_id}, {"$set": upd})
        return await _db.hi_inventory_items.find_one({"id": item_id}, {"_id": 0, "photo_base64": 0})

    @r.delete("/{item_id}")
    async def archive_item(item_id: str, user: dict = Depends(get_current_user)):
        await _owned(item_id, user["id"])
        await _db.hi_inventory_items.update_one({"id": item_id}, {"$set": {"status": "archived", "updated_at": _now()}})
        return {"ok": True}

    # -------------------------------------------------- project shopping-list matching
    @r.get("/match/{project_id}")
    async def match(project_id: str, user: dict = Depends(get_current_user)):
        proj = await _db.hi_projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0, "id": 1})
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found.")
        mats = await _db.hi_project_materials.find({"project_id": project_id}, {"_id": 0}).to_list(300)
        inv = await _db.hi_inventory_items.find({"user_id": user["id"], "status": {"$ne": "archived"}}, {"_id": 0, "photo_base64": 0}).to_list(500)
        already_have, need_to_buy, need_verification = [], [], []
        for m in mats:
            hit = next((it for it in inv if _matches(m.get("name", ""), it.get("name", ""))), None)
            entry = {"material": m, "matched_item": hit}
            if not hit:
                need_to_buy.append({"material": m})
            elif hit.get("status") == "out":
                need_to_buy.append({"material": m})
            elif m.get("category") in {"material", "safety_equipment", "optional_upgrade"} and hit.get("status") == "low":
                need_verification.append(entry)
            else:
                already_have.append(entry)
        return {"already_have": already_have, "need_to_buy": need_to_buy, "need_verification": need_verification,
                "counts": {"already_have": len(already_have), "need_to_buy": len(need_to_buy),
                           "need_verification": len(need_verification), "total": len(mats)}}

    @r.post("/match/{project_id}/apply")
    async def apply_match(project_id: str, req: ApplyMatchReq, user: dict = Depends(get_current_user)):
        proj = await _db.hi_projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0, "id": 1})
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found.")
        data = await match(project_id, user)  # type: ignore
        updated = 0
        for e in data["already_have"]:
            await _db.hi_project_materials.update_one({"id": e["material"]["id"]}, {"$set": {"user_status": "have_it"}})
            updated += 1
        for e in data["need_to_buy"]:
            await _db.hi_project_materials.update_one({"id": e["material"]["id"]}, {"$set": {"user_status": "need_it"}})
            updated += 1
        for e in data["need_verification"]:
            await _db.hi_project_materials.update_one({"id": e["material"]["id"]}, {"$set": {"user_status": "unsure"}})
            updated += 1
        await _track(user["id"], "inventory_matched_to_project", {"project_id": project_id, "updated": updated})
        return {"ok": True, "updated": updated, "counts": data["counts"]}

    return r
