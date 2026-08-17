"""
Build Doc 20 — Tool Inventory, Capability & Project Readiness Engine.
Namespace /api/hi/tools/* (+ admin /api/hi/admin/tools/signals).

NEW layers on top of the existing Toolbox (inventory_engine / hi_inventory_items) and
Doc 7 readiness (rd_boms):
- AI capability tags per owned tool (capabilities WITH limits — a drill is not an impact driver)
- Today's Tool Pack per project: required tools vs SAFETY GEAR evaluated separately;
  readiness statuses ready / ready_with_alternatives / missing_required / unsafe_tool_gap
- Capability Q&A ("can I use my impact driver instead of a drill?") → Decision Ledger
- Buy / rent / borrow / replace advisor (battery platform + usage frequency aware)

Collections: tp_packs (checklist state). Capability tags stored on hi_inventory_items.
"""
from datetime import datetime, timezone
from typing import Callable, Optional
import uuid
import re as _re

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

import readiness_engine  # reuse deterministic inventory matching

_db = None
_logger = None
_llm_json: Optional[Callable] = None

SAFETY_KEYWORDS = ("safety glasses", "goggles", "eye protection", "hearing protection", "earmuff", "ear plug",
                   "glove", "respirator", "dust mask", "mask", "face shield", "knee pad", "hard hat", "helmet",
                   "ventilation", "gfci", "voltage tester", "fire extinguisher")

PACK_STATUSES = ("ready", "ready_with_alternatives", "missing_required", "unsafe_tool_gap")


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


def _is_safety(name: str) -> bool:
    low = (name or "").lower()
    return any(k in low for k in SAFETY_KEYWORDS)


async def _inventory(uid: str):
    return await _db.hi_inventory_items.find(
        {"user_id": uid, "status": {"$ne": "archived"}},
        {"_id": 0, "id": 1, "name": 1, "category": 1, "capability_tags": 1, "brand": 1}).to_list(500)


def _battery_platforms(inventory) -> list:
    """Best-effort detection of battery platforms from tool names/brands (e.g. 'DeWalt 20V')."""
    plats = set()
    for it in inventory:
        text = f"{it.get('brand') or ''} {it.get('name') or ''}"
        m = _re.search(r"(\d{1,2})\s?v(?:olt)?s?\b", text.lower())
        brand = (it.get("brand") or "").strip().title()
        if m and brand:
            plats.add(f"{brand} {m.group(1)}V")
        elif m:
            plats.add(f"{m.group(1)}V")
    return sorted(plats)


class AskReq(BaseModel):
    question: str
    issue_id: Optional[str] = None


class ProcureReq(BaseModel):
    tool_name: str
    issue_id: Optional[str] = None


class CheckReq(BaseModel):
    name: str
    checked: bool


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/tools", tags=["tool-intelligence"])

    @r.post("/items/{item_id}/capabilities")
    async def generate_capabilities(item_id: str, user: dict = Depends(get_current_user)):
        item = await _db.hi_inventory_items.find_one({"id": item_id, "user_id": user["id"]}, {"_id": 0, "photo_base64": 0})
        if not item:
            raise HTTPException(status_code=404, detail="Tool not found.")
        system = (
            "You are Homie describing honestly what a specific tool CAN and CANNOT safely do for a homeowner. "
            "Tools in the same category are NOT identical — include real limits. "
            "Return STRICT JSON {capabilities: [{capability: short string, limits: short honest limit or null, "
            "confidence: high|medium|low}] (4-7 items), safety_notes: [1-3 short strings], "
            "power_source: one of [battery, corded, manual, gas, unknown]}"
        )
        ctx = (f"TOOL: {item.get('name')}\nCATEGORY: {item.get('category')}\nBRAND: {item.get('brand') or 'unknown'}\n"
               f"MODEL: {item.get('model_number') or 'unknown'}\nUSER NOTES: {item.get('notes') or '(none)'}")
        try:
            data = await _llm_json(system, ctx, max_tokens=600, feature_area="tool_capabilities")
            caps = [{"capability": str(c.get("capability") or "")[:150],
                     "limits": (str(c.get("limits"))[:200] if c.get("limits") else None),
                     "confidence": c.get("confidence") if c.get("confidence") in ("high", "medium", "low") else "medium"}
                    for c in (data.get("capabilities") or []) if isinstance(c, dict) and c.get("capability")][:8]
            safety = [str(s)[:200] for s in (data.get("safety_notes") or [])][:3]
            power = data.get("power_source") if data.get("power_source") in ("battery", "corded", "manual", "gas", "unknown") else "unknown"
            if not caps:
                raise ValueError("empty")
        except Exception as e:
            if _logger:
                _logger.warning(f"tool capabilities AI failed: {e}")
            raise HTTPException(status_code=502, detail="Couldn't analyze this tool right now — try again in a moment.")
        await _db.hi_inventory_items.update_one({"id": item_id}, {"$set": {
            "capability_tags": caps, "safety_notes": safety, "power_source": power,
            "capabilities_generated_at": _now()}})
        await _cap(user["id"], "tool.capabilities_generated", {"count": len(caps)})
        return {"capability_tags": caps, "safety_notes": safety, "power_source": power}

    @r.get("/pack/{iid}")
    async def tool_pack(iid: str, user: dict = Depends(get_current_user)):
        issue = await _db.gr_issues.find_one({"id": iid, "user_id": user["id"]}, {"_id": 0})
        if not issue:
            raise HTTPException(status_code=404, detail="Project not found.")
        plan = await _db.gr_plans.find_one({"issue_id": iid}, {"_id": 0}, sort=[("version", -1)])
        bom = await _db.rd_boms.find_one({"issue_id": iid}, {"_id": 0}, sort=[("version", -1)])
        # Collect needed tools: BOM tools first (richest), else plan tools_materials, plus per-task tool mentions.
        needed: dict = {}
        for it in (bom.get("items") if bom else []) or []:
            if it.get("kind") == "tool":
                needed[it["name"].lower()] = {"name": it["name"], "required": it.get("requirement") == "required",
                                              "status": it.get("status"), "source": "materials_list"}
        if not needed:
            for m in (plan.get("tools_materials") if plan else []) or []:
                if m.get("kind") == "tool":
                    needed[m["name"].lower()] = {"name": m["name"], "required": bool(m.get("essential")),
                                                 "status": None, "source": "plan"}
        for t in (plan.get("tasks") if plan else []) or []:
            for tool in t.get("tools") or []:
                if tool.lower() not in needed:
                    needed[tool.lower()] = {"name": tool, "required": True, "status": None, "source": f"step: {t['title'][:60]}"}
        # Always include baseline safety gear for physical work.
        if plan and "safety glasses" not in needed:
            needed["safety glasses"] = {"name": "Safety glasses", "required": True, "status": None, "source": "baseline safety"}

        inventory = await _inventory(user["id"])
        checks = {c["name"].lower(): c["checked"] for c in
                  ((await _db.tp_packs.find_one({"issue_id": iid, "user_id": user["id"]}, {"_id": 0}) or {}).get("checks") or [])}
        tools, safety_gear = [], []
        for key, n in needed.items():
            match = readiness_engine._inventory_match(n["name"], inventory)
            owned = bool(match and match.get("exact")) or n.get("status") == "have_it"
            likely = bool(match and not match.get("exact")) and not owned
            row = {"name": n["name"], "required": n["required"], "source": n["source"],
                   "owned": owned, "likely_owned": likely,
                   "inventory_name": match.get("inventory_name") if match else None,
                   "checked": checks.get(key, False)}
            (safety_gear if _is_safety(n["name"]) else tools).append(row)

        missing_safety = [s for s in safety_gear if s["required"] and not s["owned"] and not s["checked"]]
        missing_required = [t for t in tools if t["required"] and not t["owned"] and not t["likely_owned"] and not t["checked"]]
        alt_only = [t for t in tools if t["required"] and not t["owned"] and t["likely_owned"] and not t["checked"]]
        if missing_safety:
            status = "unsafe_tool_gap"
        elif missing_required:
            status = "missing_required"
        elif alt_only:
            status = "ready_with_alternatives"
        else:
            status = "ready"
        status_note = {
            "unsafe_tool_gap": "Owning the tool isn't the same as being protected — sort the safety gear before anything else.",
            "missing_required": "A required tool is missing. Decide buy / rent / borrow before you start, not halfway through.",
            "ready_with_alternatives": "You likely own a workable alternative — verify it fits before relying on it.",
            "ready": "Tool-wise, you're set. Gather everything before the first step.",
        }[status]
        await _cap(user["id"], "tool_pack.viewed", {"status": status})
        return {"issue": {"id": iid, "description": issue.get("description")},
                "tools": tools, "safety_gear": safety_gear, "status": status, "status_note": status_note,
                "battery_platforms": _battery_platforms(inventory),
                "has_plan": bool(plan), "has_bom": bool(bom),
                "missing_required": [t["name"] for t in missing_required],
                "missing_safety": [s["name"] for s in missing_safety]}

    @r.post("/pack/{iid}/check")
    async def pack_check(iid: str, req: CheckReq, user: dict = Depends(get_current_user)):
        issue = await _db.gr_issues.find_one({"id": iid, "user_id": user["id"]}, {"id": 1})
        if not issue:
            raise HTTPException(status_code=404, detail="Project not found.")
        doc = await _db.tp_packs.find_one({"issue_id": iid, "user_id": user["id"]}, {"_id": 0}) or \
            {"id": _nid(), "issue_id": iid, "user_id": user["id"], "checks": []}
        checks = [c for c in doc["checks"] if c["name"].lower() != req.name.lower()]
        checks.append({"name": req.name[:120], "checked": bool(req.checked)})
        await _db.tp_packs.update_one({"issue_id": iid, "user_id": user["id"]},
                                      {"$set": {"id": doc["id"], "issue_id": iid, "user_id": user["id"],
                                                "checks": checks, "updated_at": _now()}}, upsert=True)
        return {"ok": True}

    @r.post("/ask")
    async def tool_ask(req: AskReq, user: dict = Depends(get_current_user)):
        q = (req.question or "").strip()
        if not q:
            raise HTTPException(status_code=400, detail="Ask a question first.")
        inventory = await _inventory(user["id"])
        inv_lines = []
        for it in inventory[:40]:
            caps = ", ".join(c["capability"] for c in (it.get("capability_tags") or [])[:4])
            inv_lines.append(f"- {it['name']} ({it.get('category')})" + (f" — can: {caps}" if caps else ""))
        issue = None
        if req.issue_id:
            issue = await _db.gr_issues.find_one({"id": req.issue_id, "user_id": user["id"]}, {"_id": 0, "description": 1})
        system = (
            "You are Homie answering a homeowner's TOOL question using their actual toolbox listed below. "
            "Capability matters more than tool names — a drill is not an impact driver. Be honest about limits. "
            "If a substitution reduces safety or quality, say so plainly. "
            "Return STRICT JSON {answer: string, verdict: one of [yes, yes_with_care, no, verify_first], "
            "safety_note: string or null}"
        )
        ctx = (f"THEIR TOOLBOX:\n" + ("\n".join(inv_lines) or "(empty)") +
               f"\nBATTERY PLATFORMS: {_battery_platforms(inventory)}\n"
               f"PROJECT: {issue.get('description') if issue else '(none)'}\nQUESTION: {q}")
        try:
            data = await _llm_json(system, ctx, max_tokens=500, feature_area="tool_ask")
            answer = str(data.get("answer") or "")[:1200]
            verdict = data.get("verdict") if data.get("verdict") in ("yes", "yes_with_care", "no", "verify_first") else "verify_first"
            safety_note = (str(data.get("safety_note"))[:300] if data.get("safety_note") else None)
        except Exception:
            answer, verdict, safety_note = ("I couldn't check that right now — try again in a moment.", "verify_first", None)
        if req.issue_id and issue:
            await _db.gr_decisions.insert_one({"id": _nid(), "issue_id": req.issue_id, "user_id": user["id"],
                                               "type": "tool_capability",
                                               "summary": f"Tool question: {q[:160]}",
                                               "detail": f"Verdict: {verdict}. {answer[:300]}", "created_at": _now()})
        await _cap(user["id"], "tool.question_asked", {"verdict": verdict})
        return {"answer": answer, "verdict": verdict, "safety_note": safety_note}

    @r.post("/procure-advice")
    async def procure_advice(req: ProcureReq, user: dict = Depends(get_current_user)):
        name = (req.tool_name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Which tool?")
        inventory = await _inventory(user["id"])
        plats = _battery_platforms(inventory)
        issue = None
        if req.issue_id:
            issue = await _db.gr_issues.find_one({"id": req.issue_id, "user_id": user["id"]}, {"_id": 0, "description": 1})
        system = (
            "You are Homie advising whether a homeowner should BUY, RENT, or BORROW a missing tool. "
            "Never default to purchase — specialized/rarely-used tools should usually be rented or borrowed. "
            "If they own a battery platform, a compatible bare tool changes the math. Use honest broad US ranges. "
            "Return STRICT JSON {recommendation: one of [buy, rent, borrow], reasoning: string (2-3 sentences), "
            "purchase_low: number|null, purchase_high: number|null, rental_day_low: number|null, rental_day_high: number|null, "
            "battery_platform_note: string|null, future_use: one of [rare, occasional, frequent]}"
        )
        ctx = (f"MISSING TOOL: {name}\nPROJECT: {issue.get('description') if issue else '(general)'}\n"
               f"OWNED BATTERY PLATFORMS: {plats or 'none detected'}\nTOOLBOX SIZE: {len(inventory)} items")
        try:
            data = await _llm_json(system, ctx, max_tokens=450, feature_area="tool_procure")
            def _num(v):
                try:
                    return round(float(v), 2) if v is not None else None
                except (TypeError, ValueError):
                    return None
            out = {"recommendation": data.get("recommendation") if data.get("recommendation") in ("buy", "rent", "borrow") else "rent",
                   "reasoning": str(data.get("reasoning") or "")[:600],
                   "purchase_low": _num(data.get("purchase_low")), "purchase_high": _num(data.get("purchase_high")),
                   "rental_day_low": _num(data.get("rental_day_low")), "rental_day_high": _num(data.get("rental_day_high")),
                   "battery_platform_note": (str(data.get("battery_platform_note"))[:300] if data.get("battery_platform_note") else None),
                   "future_use": data.get("future_use") if data.get("future_use") in ("rare", "occasional", "frequent") else "occasional",
                   "disclaimer": readiness_engine.COST_DISCLAIMER}
        except Exception:
            out = {"recommendation": "rent", "reasoning": "I couldn't run the comparison right now — for a one-off task, renting or borrowing is usually the safer default.",
                   "purchase_low": None, "purchase_high": None, "rental_day_low": None, "rental_day_high": None,
                   "battery_platform_note": None, "future_use": "occasional", "disclaimer": readiness_engine.COST_DISCLAIMER}
        await _cap(user["id"], "tool.procure_advice", {"rec": out["recommendation"]})
        return out

    return r


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/tools", tags=["tool-intelligence-admin"])

    @r.get("/signals")
    async def signals(admin: dict = Depends(require_admin)):
        with_caps = await _db.hi_inventory_items.count_documents({"capability_tags.0": {"$exists": True}})
        total = await _db.hi_inventory_items.count_documents({"status": {"$ne": "archived"}})
        packs = await _db.tp_packs.count_documents({})
        return {"tools_total": total, "tools_with_capabilities": with_caps, "tool_packs": packs}

    return r
