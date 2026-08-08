"""
DIYhomie — Room Intelligence & Guided Home Capture (Build Blueprint 02).

Enhances Blueprint 01. Organizes a user's property into persistent rooms/floors
with a simple relationship map — ready for future AR/LiDAR/Unity imports (via
capture_type + measurement_source fields) but NO geometry generation in this phase.

Shares collections with home_intelligence_engine:
  hi_properties, hi_rooms (evolved in place), hi_assets, hi_issues
Adds:
  hi_floors, hi_room_connections, hi_room_captures, hi_room_history, hi_analytics
"""
import uuid
from datetime import datetime, timezone
from typing import Optional, Callable, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None
_llm_json: Callable = None
_llm_key: str = ""

ROOM_TYPES = ["Kitchen", "Living Room", "Bedroom", "Bathroom", "Laundry Room", "Garage",
              "Basement", "Office", "Dining Room", "Hallway", "Closet", "Storage Room",
              "Workshop", "Exterior", "Other"]
CONNECTION_TYPES = ["Doorway", "Open Passage", "Stairs", "Exterior Access", "Unknown"]
CAPTURE_TYPES = ["photo", "upload", "voice_note", "manual_entry", "future_ar_scan"]


def configure(db, logger, llm_json: Callable, llm_key: str):
    global _db, _logger, _llm_json, _llm_key
    _db = db
    _logger = logger
    _llm_json = llm_json
    _llm_key = llm_key or ""


def _now():
    return datetime.now(timezone.utc).isoformat()


def _new_id():
    return str(uuid.uuid4())


async def _track(user_id: str, event: str, meta: dict = None):
    try:
        await _db.hi_analytics.insert_one(
            {"id": _new_id(), "user_id": user_id, "event": event, "meta": meta or {}, "at": _now()})
    except Exception:
        pass


async def _get_or_create_property(user_id: str) -> dict:
    prop = (await _db.hi_properties.find_one({"user_id": user_id, "is_active": True}, {"_id": 0})
            or await _db.hi_properties.find_one({"user_id": user_id}, {"_id": 0}))
    if not prop:
        prop = {"id": _new_id(), "user_id": user_id, "name": "My Home", "address": None,
                "property_type": None, "created_at": _now()}
        await _db.hi_properties.insert_one(dict(prop))
        await _track(user_id, "property_created", {})
    return prop


async def _get_or_create_default_floor(property_id: str) -> dict:
    fl = await _db.hi_floors.find_one({"property_id": property_id}, {"_id": 0}, sort=[("sequence_number", 1)])
    if not fl:
        fl = {"id": _new_id(), "property_id": property_id, "name": "Main Floor",
              "sequence_number": 1, "created_at": _now()}
        await _db.hi_floors.insert_one(dict(fl))
    return fl


async def _classify_room(photo_base64: Optional[str], description: Optional[str]) -> dict:
    """Suggest a room type + confidence. Never asserts certainty (user must confirm)."""
    system = (
        "You identify what type of home room a photo/description most likely shows. "
        f"Choose ONE from: {', '.join(ROOM_TYPES)}. Return STRICT JSON: "
        "{\"suggested_room_type\": string, \"confidence_score\": number 0-1, "
        "\"confidence_level\": one of [Confirmed, Likely, Needs Confirmation]}. "
        "Never use 'Confirmed' unless the evidence is unmistakable; prefer 'Likely' or "
        "'Needs Confirmation' when unsure.")
    try:
        if photo_base64:
            from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
            import json as _json
            chat = LlmChat(api_key=_llm_key, session_id=_new_id(), system_message=system).with_model("openai", "gpt-4o")
            txt = (description or "").strip() or "Identify this room."
            out = await chat.send_message(UserMessage(text=txt, file_contents=[ImageContent(photo_base64)]))
            raw = (out or "").strip().lstrip("`")
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip("`").strip()
            try:
                data = _json.loads(raw[raw.find("{"): raw.rfind("}") + 1])
            except Exception:
                data = {}
        else:
            data = await _llm_json(system, f"Description: {description or 'unknown'}", max_tokens=200)
    except Exception as e:
        if _logger:
            _logger.warning(f"room classify failed: {e}")
        data = {}
    rt = data.get("suggested_room_type") if isinstance(data, dict) else None
    if rt not in ROOM_TYPES:
        rt = "Other"
    lvl = data.get("confidence_level") if isinstance(data, dict) else None
    if lvl not in ("Confirmed", "Likely", "Needs Confirmation"):
        lvl = "Needs Confirmation"
    if lvl == "Confirmed":  # only the user may confirm
        lvl = "Likely"
    score = data.get("confidence_score") if isinstance(data, dict) else 0.0
    try:
        score = round(float(score), 2)
    except Exception:
        score = 0.0
    return {"suggested_room_type": rt, "confidence_level": lvl, "confidence_score": score}


# =============================================================== models
class FloorReq(BaseModel):
    name: str
    sequence_number: Optional[int] = None


class ClassifyReq(BaseModel):
    photo_base64: Optional[str] = None
    description: Optional[str] = None


class RoomReq(BaseModel):
    name: str
    room_type: str = "Other"
    floor_id: Optional[str] = None
    floor_name: Optional[str] = None
    classification_confidence: Optional[str] = None
    cover_photo_base64: Optional[str] = None
    approximate_length: Optional[str] = None
    approximate_width: Optional[str] = None
    approximate_ceiling_height: Optional[str] = None
    notes: Optional[str] = None
    capture_type: str = "manual_entry"
    description: Optional[str] = None


class RoomUpdateReq(BaseModel):
    name: Optional[str] = None
    room_type: Optional[str] = None
    floor_id: Optional[str] = None
    cover_photo_base64: Optional[str] = None
    notes: Optional[str] = None
    approximate_length: Optional[str] = None
    approximate_width: Optional[str] = None
    approximate_ceiling_height: Optional[str] = None


class ConnectionReq(BaseModel):
    room_id: str
    connected_room_id: Optional[str] = None
    new_room_name: Optional[str] = None
    connection_type: str = "Unknown"
    notes: Optional[str] = None


def build_rooms_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/rooms", dependencies=[Depends(get_current_user)])

    async def _owned_room(room_id: str, user_id: str) -> dict:
        prop = await _get_or_create_property(user_id)
        rm = await _db.hi_rooms.find_one({"id": room_id, "property_id": prop["id"]}, {"_id": 0})
        if not rm:
            raise HTTPException(status_code=404, detail="Room not found.")
        return rm

    # ----------------------------------------------------------- floors
    @r.get("/floors")
    async def list_floors(user: dict = Depends(get_current_user)):
        prop = await _get_or_create_property(user["id"])
        await _get_or_create_default_floor(prop["id"])
        floors = await _db.hi_floors.find({"property_id": prop["id"]}, {"_id": 0}).sort("sequence_number", 1).to_list(50)
        return {"floors": floors}

    @r.post("/floors")
    async def create_floor(req: FloorReq, user: dict = Depends(get_current_user)):
        prop = await _get_or_create_property(user["id"])
        seq = req.sequence_number
        if seq is None:
            last = await _db.hi_floors.find_one({"property_id": prop["id"]}, sort=[("sequence_number", -1)])
            seq = (last["sequence_number"] + 1) if last else 1
        doc = {"id": _new_id(), "property_id": prop["id"], "name": req.name[:40],
               "sequence_number": seq, "created_at": _now()}
        await _db.hi_floors.insert_one(dict(doc))
        return doc

    # ----------------------------------------------------------- classify
    @r.post("/classify")
    async def classify(req: ClassifyReq, user: dict = Depends(get_current_user)):
        await _track(user["id"], "room_capture_started", {})
        return await _classify_room(req.photo_base64, req.description)

    # ----------------------------------------------------------- create room
    @r.post("")
    async def create_room(req: RoomReq, user: dict = Depends(get_current_user)):
        name = (req.name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Room name is required.")
        prop = await _get_or_create_property(user["id"])
        floor_id = req.floor_id
        if not floor_id:
            if req.floor_name and req.floor_name.strip():
                existing = await _db.hi_floors.find_one({"property_id": prop["id"], "name": req.floor_name.strip()})
                if existing:
                    floor_id = existing["id"]
                else:
                    last = await _db.hi_floors.find_one({"property_id": prop["id"]}, sort=[("sequence_number", -1)])
                    seq = (last["sequence_number"] + 1) if last else 1
                    fl = {"id": _new_id(), "property_id": prop["id"], "name": req.floor_name.strip()[:40],
                          "sequence_number": seq, "created_at": _now()}
                    await _db.hi_floors.insert_one(fl)
                    floor_id = fl["id"]
            else:
                floor_id = (await _get_or_create_default_floor(prop["id"]))["id"]
        rid = _new_id()
        rt = req.room_type if req.room_type in ROOM_TYPES else "Other"
        doc = {
            "id": rid, "property_id": prop["id"], "floor_id": floor_id,
            "persistent_room_id": rid, "name": name[:60], "room_type": rt,
            "classification_confidence": req.classification_confidence or "Confirmed",
            "cover_photo_base64": req.cover_photo_base64,
            "approximate_length": req.approximate_length, "approximate_width": req.approximate_width,
            "approximate_ceiling_height": req.approximate_ceiling_height,
            "measurement_source": "manual" if (req.approximate_length or req.approximate_width) else None,
            "notes": req.notes, "status": "active", "created_at": _now(), "updated_at": _now(),
        }
        await _db.hi_rooms.insert_one(dict(doc))
        # capture record (future AR-ready)
        ct = req.capture_type if req.capture_type in CAPTURE_TYPES else "manual_entry"
        await _db.hi_room_captures.insert_one({
            "id": _new_id(), "room_id": rid, "capture_type": ct if not req.cover_photo_base64 else "photo",
            "file_base64": req.cover_photo_base64, "transcript": req.description, "created_at": _now()})
        await _track(user["id"], "room_capture_completed", {"room_id": rid, "room_type": rt})
        if req.classification_confidence:
            await _track(user["id"], "room_classification_confirmed", {"room_id": rid, "room_type": rt})
        doc.pop("_id", None)
        return doc

    # ----------------------------------------------------------- list / map
    @r.get("/map")
    async def room_map(user: dict = Depends(get_current_user)):
        prop = await _get_or_create_property(user["id"])
        await _get_or_create_default_floor(prop["id"])
        floors = await _db.hi_floors.find({"property_id": prop["id"]}, {"_id": 0}).sort("sequence_number", 1).to_list(50)
        rooms = await _db.hi_rooms.find(
            {"property_id": prop["id"], "status": {"$ne": "archived"}},
            {"_id": 0, "cover_photo_base64": 0}).to_list(500)
        conns = await _db.hi_room_connections.find({"property_id": prop["id"]}, {"_id": 0}).to_list(1000)
        return {"property": {"name": prop.get("name"), "address": prop.get("address")},
                "floors": floors, "rooms": rooms, "connections": conns,
                "room_count": len(rooms)}

    @r.get("/walkthrough")
    async def walkthrough(user: dict = Depends(get_current_user)):
        prop = await _get_or_create_property(user["id"])
        count = await _db.hi_rooms.count_documents({"property_id": prop["id"], "status": {"$ne": "archived"}})
        return {"property": {"name": prop.get("name"), "address": prop.get("address")},
                "room_count": count, "room_types": ROOM_TYPES}

    # ----------------------------------------------------------- profile
    @r.get("/{room_id}/profile")
    async def room_profile(room_id: str, user: dict = Depends(get_current_user)):
        rm = await _owned_room(room_id, user["id"])
        await _track(user["id"], "room_profile_opened", {"room_id": room_id})
        floor = await _db.hi_floors.find_one({"id": rm.get("floor_id")}, {"_id": 0}) if rm.get("floor_id") else None
        conns = await _db.hi_room_connections.find({"room_id": room_id}, {"_id": 0}).to_list(100)
        cids = [c["connected_room_id"] for c in conns if c.get("connected_room_id")]
        cmap = {}
        if cids:
            for c in await _db.hi_rooms.find({"id": {"$in": cids}}, {"_id": 0, "id": 1, "name": 1, "room_type": 1}).to_list(100):
                cmap[c["id"]] = c
        connected = [{"connection_type": c["connection_type"], **cmap.get(c["connected_room_id"], {"name": "Unknown"})}
                     for c in conns]
        assets = await _db.hi_assets.find(
            {"room_id": room_id}, {"_id": 0, "photo_base64": 0}).to_list(200)
        issues = await _db.hi_issues.find(
            {"room_id": room_id, "status": {"$in": ["active", "escalated"]}}, {"_id": 0, "image_base64": 0}).to_list(100)
        # documents associated via assets in this room
        aids = [a["id"] for a in assets]
        docs = []
        if aids:
            docs = await _db.hi_asset_documents.find(
                {"asset_id": {"$in": aids}}, {"_id": 0, "file_base64": 0, "extracted_text": 0}).to_list(200)
        projects = await _db.hi_projects.find(
            {"room_id": room_id}, {"_id": 0}).sort("created_at", -1).to_list(100) if "hi_projects" in await _db.list_collection_names() else []
        rm["floor_name"] = floor["name"] if floor else None
        return {"room": rm, "connected_rooms": connected, "assets": assets,
                "open_issues": issues, "documents": docs, "projects": projects}

    # ----------------------------------------------------------- update
    @r.put("/{room_id}")
    async def update_room(room_id: str, req: RoomUpdateReq, user: dict = Depends(get_current_user)):
        rm = await _owned_room(room_id, user["id"])
        upd = {"updated_at": _now()}
        # preserve history on name/type change
        if (req.name and req.name != rm["name"]) or (req.room_type and req.room_type != rm.get("room_type")):
            await _db.hi_room_history.insert_one({
                "id": _new_id(), "room_id": room_id, "prev_name": rm["name"],
                "prev_room_type": rm.get("room_type"), "changed_at": _now()})
            if req.room_type and req.room_type != rm.get("room_type"):
                upd["status"] = "changed_use"
        if req.name:
            upd["name"] = req.name[:60]
        if req.room_type and req.room_type in ROOM_TYPES:
            upd["room_type"] = req.room_type
        if req.floor_id:
            upd["floor_id"] = req.floor_id
        if req.cover_photo_base64 is not None:
            upd["cover_photo_base64"] = req.cover_photo_base64
        if req.notes is not None:
            upd["notes"] = req.notes
        for f in ("approximate_length", "approximate_width", "approximate_ceiling_height"):
            v = getattr(req, f)
            if v is not None:
                upd[f] = v
        await _db.hi_rooms.update_one({"id": room_id}, {"$set": upd})
        await _track(user["id"], "room_updated", {"room_id": room_id})
        return await _db.hi_rooms.find_one({"id": room_id}, {"_id": 0, "cover_photo_base64": 0})

    @r.delete("/{room_id}")
    async def archive_room(room_id: str, user: dict = Depends(get_current_user)):
        await _owned_room(room_id, user["id"])
        await _db.hi_rooms.update_one({"id": room_id}, {"$set": {"status": "archived", "updated_at": _now()}})
        return {"ok": True}

    # ----------------------------------------------------------- connections
    @r.post("/connections")
    async def create_connection(req: ConnectionReq, user: dict = Depends(get_current_user)):
        rm = await _owned_room(req.room_id, user["id"])
        target = req.connected_room_id
        if not target and req.new_room_name and req.new_room_name.strip():
            rid = _new_id()
            nr = {"id": rid, "property_id": rm["property_id"], "floor_id": rm.get("floor_id"),
                  "persistent_room_id": rid, "name": req.new_room_name.strip()[:60],
                  "room_type": "Other", "classification_confidence": "Needs Confirmation",
                  "cover_photo_base64": None, "notes": None, "status": "active",
                  "created_at": _now(), "updated_at": _now()}
            await _db.hi_rooms.insert_one(nr)
            target = rid
        if not target:
            raise HTTPException(status_code=400, detail="Pick or name a connected room.")
        ctype = req.connection_type if req.connection_type in CONNECTION_TYPES else "Unknown"
        base = {"property_id": rm["property_id"], "connection_type": ctype, "notes": req.notes, "created_at": _now()}
        await _db.hi_room_connections.insert_one({"id": _new_id(), "room_id": req.room_id, "connected_room_id": target, **base})
        # bidirectional for the map
        await _db.hi_room_connections.insert_one({"id": _new_id(), "room_id": target, "connected_room_id": req.room_id, **base})
        await _track(user["id"], "room_connection_created", {"room_id": req.room_id, "connected_room_id": target})
        return {"ok": True, "connected_room_id": target}

    return r
