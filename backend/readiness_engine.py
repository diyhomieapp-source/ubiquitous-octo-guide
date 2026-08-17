"""
Build Doc 7 — Project Materials, Tools & Cost Intelligence Engine.
Namespace /api/hi/readiness/* (+ admin /api/hi/admin/readiness/*).

Shows what a project needs (structured BOM with source + confidence), what the user
already owns (deterministic match against hi_inventory_items), honest cost ranges with
explicit assumptions, and buy/borrow/rent/verify procurement lists — BEFORE spending.

Collections: rd_boms (versioned per repair issue). Decisions log into gr_decisions
(shared Decision Ledger with Guided Repair).
"""
from datetime import datetime, timezone
from typing import Callable, Optional, List
import uuid
import re

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

_db = None
_logger = None
_llm_json: Optional[Callable] = None

ITEM_STATUSES = ("undecided", "have_it", "will_buy", "will_borrow", "will_rent", "need_verification", "skipped")
REQUIREMENTS = ("required", "optional", "unknown")

COST_DISCLAIMER = ("These are honest planning estimates, not quotes. Real prices vary by region, "
                   "brand and store — verify before you buy.")


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


async def _owned_issue(iid, uid):
    issue = await _db.gr_issues.find_one({"id": iid, "user_id": uid}, {"_id": 0})
    if not issue:
        raise HTTPException(status_code=404, detail="Project not found.")
    return issue


_STOP = {"a", "an", "the", "of", "for", "and", "or", "with", "set", "new"}


def _tokens(name: str) -> set:
    return {t for t in re.findall(r"[a-z0-9]+", (name or "").lower()) if t not in _STOP and len(t) > 2}


def _inventory_match(item_name: str, inventory: List[dict]) -> Optional[dict]:
    """Deterministic token-overlap match against the user's toolbox."""
    it = _tokens(item_name)
    if not it:
        return None
    best, best_score = None, 0.0
    for inv in inventory:
        nt = _tokens(inv.get("name", ""))
        if not nt:
            continue
        overlap = len(it & nt)
        if overlap == 0:
            continue
        score = overlap / max(1, min(len(it), len(nt)))
        low_i, low_n = item_name.lower(), inv.get("name", "").lower()
        if low_i in low_n or low_n in low_i:
            score = max(score, 1.0)
        if score > best_score:
            best, best_score = inv, score
    if best and best_score >= 0.5:
        return {"inventory_id": best["id"], "inventory_name": best["name"], "exact": best_score >= 1.0}
    return None


def _compute_summary(bom: dict) -> dict:
    items = bom.get("items") or []
    required = [i for i in items if i.get("requirement") == "required"]
    resolved = [i for i in required if i["status"] == "have_it"]
    decided = [i for i in required if i["status"] not in ("undecided", "need_verification")]
    to_acquire = [i for i in items if i["status"] in ("will_buy", "will_rent") or
                  (i.get("requirement") == "required" and i["status"] == "undecided")]
    low = sum(i.get("cost_low") or 0 for i in to_acquire)
    high = sum(i.get("cost_high") or 0 for i in to_acquire)
    return {
        "total_items": len(items),
        "required_items": len(required),
        "ready_required": len(resolved),
        "readiness_pct": round(len(resolved) / len(required) * 100) if required else 100,
        "decided_pct": round(len(decided) / len(required) * 100) if required else 100,
        "verify_count": len([i for i in items if i["status"] == "need_verification"]),
        "to_spend_low": round(low, 2),
        "to_spend_high": round(high, 2),
        "cost_assumptions": bom.get("cost_assumptions") or [],
        "disclaimer": COST_DISCLAIMER,
    }


def _procurement(bom: dict) -> dict:
    items = bom.get("items") or []
    def grp(status):
        return [{"id": i["id"], "name": i["name"], "kind": i["kind"], "qty": i.get("qty_estimate"),
                 "unit": i.get("unit"), "cost_low": i.get("cost_low"), "cost_high": i.get("cost_high")}
                for i in items if i["status"] == status]
    return {"buy": grp("will_buy"), "borrow": grp("will_borrow"), "rent": grp("will_rent"),
            "verify": grp("need_verification"), "owned": grp("have_it"),
            "undecided": grp("undecided")}


async def _latest_bom(iid: str):
    return await _db.rd_boms.find_one({"issue_id": iid}, {"_id": 0}, sort=[("version", -1)])


def _view(bom: Optional[dict]) -> dict:
    if not bom:
        return {"bom": None}
    return {"bom": bom, "summary": _compute_summary(bom), "procurement": _procurement(bom)}


class ItemStatusReq(BaseModel):
    status: str
    note: Optional[str] = None


class AskReq(BaseModel):
    question: str
    item_name: Optional[str] = None


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/readiness", tags=["readiness"])

    @r.get("/issues/{iid}")
    async def get_readiness(iid: str, user: dict = Depends(get_current_user)):
        issue = await _owned_issue(iid, user["id"])
        bom = await _latest_bom(iid)
        plan = await _db.gr_plans.find_one({"issue_id": iid}, {"_id": 0, "tasks": 0}, sort=[("version", -1)])
        out = _view(bom)
        out["has_plan"] = bool(plan)
        out["plan_version"] = plan.get("version") if plan else None
        out["stale"] = bool(bom and plan and bom.get("plan_version") != plan.get("version"))
        out["issue"] = {"id": issue["id"], "description": issue.get("description"), "phase": issue.get("phase")}
        await _cap(user["id"], "readiness.viewed", {"has_bom": bool(bom)})
        return out

    @r.post("/issues/{iid}/generate")
    async def generate_bom(iid: str, user: dict = Depends(get_current_user)):
        issue = await _owned_issue(iid, user["id"])
        plan = await _db.gr_plans.find_one({"issue_id": iid}, {"_id": 0}, sort=[("version", -1)])
        if not plan:
            raise HTTPException(status_code=400, detail="Create a repair plan first — the materials list is grounded in it.")
        prev = await _latest_bom(iid)
        prev_status = {i["name"].lower(): {"status": i["status"], "status_note": i.get("status_note")}
                       for i in (prev.get("items") if prev else [])}
        plan_items = plan.get("tools_materials") or []
        task_lines = "\n".join(f"- {t['title']}: tools {t.get('tools') or []}" for t in (plan.get("tasks") or [])[:20])
        system = (
            "You are Homie preparing an honest PROJECT READINESS list (bill of materials) for a homeowner, "
            "grounded ONLY in the repair plan provided. Do NOT invent brands, retailers or precise prices. "
            "For each item give a broad honest US price range (cost_low, cost_high in USD) for a typical basic option, "
            "or null when a range would be misleading. Mark requirement as 'required' when the plan can't be completed "
            "without it, 'optional' for nice-to-have, 'unknown' if the plan is ambiguous. "
            "Return STRICT JSON: {items: [{name, kind in [tool, material], requirement in [required, optional, unknown], "
            "qty_estimate (number or null), unit (string or null), purpose (short), cost_low (number or null), "
            "cost_high (number or null), confidence in [high, medium, low], rent_candidate boolean, "
            "substitute_hint (string or null)}], cost_assumptions: [array of short honest assumption strings]}"
        )
        ctx = (f"PROJECT: {issue.get('description')}\nOBJECTIVE: {plan.get('objective')}\n"
               f"DIFFICULTY: {plan.get('difficulty')}\n"
               f"PLAN TOOLS/MATERIALS: {[{'name': m['name'], 'kind': m['kind'], 'essential': m.get('essential')} for m in plan_items]}\n"
               f"PLAN TASKS:\n{task_lines}")
        try:
            data = await _llm_json(system, ctx, max_tokens=1600, feature_area="readiness_bom")
            raw_items = data.get("items") if isinstance(data, dict) else None
            assumptions = [str(a)[:200] for a in (data.get("cost_assumptions") or [])][:8] if isinstance(data, dict) else []
            if not raw_items:
                raise ValueError("no items")
        except Exception as e:
            if _logger:
                _logger.warning(f"readiness BOM AI failed, deterministic fallback: {e}")
            raw_items = [{"name": m["name"], "kind": m["kind"], "requirement": "required" if m.get("essential") else "optional",
                          "purpose": "Listed in your repair plan", "confidence": "medium"} for m in plan_items]
            assumptions = ["Cost ranges unavailable right now — list built directly from your plan."]
        inventory = await _db.hi_inventory_items.find(
            {"user_id": user["id"], "status": {"$ne": "archived"}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
        items, seen = [], set()
        plan_names = {m["name"].lower() for m in plan_items}
        for it in raw_items:
            if not isinstance(it, dict):
                continue
            name = str(it.get("name") or "").strip()[:120]
            if not name or name.lower() in seen:
                continue
            seen.add(name.lower())
            match = _inventory_match(name, inventory)
            prior = prev_status.get(name.lower())
            status = prior["status"] if prior else ("have_it" if (match and match["exact"]) else
                                                    ("need_verification" if match else "undecided"))
            def _num(v):
                try:
                    return round(float(v), 2) if v is not None else None
                except (TypeError, ValueError):
                    return None
            items.append({
                "id": _nid(), "name": name,
                "kind": it.get("kind") if it.get("kind") in ("tool", "material") else "material",
                "requirement": it.get("requirement") if it.get("requirement") in REQUIREMENTS else "unknown",
                "qty_estimate": _num(it.get("qty_estimate")), "unit": (str(it.get("unit"))[:30] if it.get("unit") else None),
                "purpose": str(it.get("purpose") or "")[:300],
                "cost_low": _num(it.get("cost_low")), "cost_high": _num(it.get("cost_high")),
                "confidence": it.get("confidence") if it.get("confidence") in ("high", "medium", "low") else "low",
                "rent_candidate": bool(it.get("rent_candidate")),
                "substitute_hint": (str(it.get("substitute_hint"))[:300] if it.get("substitute_hint") else None),
                "source": "plan" if name.lower() in plan_names else "ai_suggested",
                "inventory_match": match,
                "status": status, "status_note": (prior or {}).get("status_note"),
            })
        version = (prev.get("version") if prev else 0) + 1
        bom = {"id": _nid(), "issue_id": iid, "user_id": user["id"], "version": version,
               "plan_version": plan.get("version"), "items": items[:40],
               "cost_assumptions": assumptions, "created_at": _now()}
        await _db.rd_boms.insert_one(dict(bom)); bom.pop("_id", None)
        await _cap(user["id"], "readiness.bom_generated", {"version": version, "items": len(items)})
        return _view(bom)

    @r.post("/items/{item_id}/status")
    async def set_item_status(item_id: str, req: ItemStatusReq, user: dict = Depends(get_current_user)):
        if req.status not in ITEM_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status.")
        bom = await _db.rd_boms.find_one({"items.id": item_id, "user_id": user["id"]}, {"_id": 0})
        if not bom:
            raise HTTPException(status_code=404, detail="Item not found.")
        latest = await _latest_bom(bom["issue_id"])
        if latest["id"] != bom["id"]:
            raise HTTPException(status_code=409, detail="This list has a newer version — refresh first.")
        item = None
        for i in bom["items"]:
            if i["id"] == item_id:
                i["status"] = req.status
                i["status_note"] = (req.note or "")[:300] or None
                item = i
                break
        await _db.rd_boms.update_one({"id": bom["id"]}, {"$set": {"items": bom["items"]}})
        # Keep the repair plan's simple material chips in sync (best-effort).
        gr_status = {"have_it": "available", "will_borrow": "borrowed", "skipped": "unavailable"}.get(req.status)
        if gr_status:
            plan = await _db.gr_plans.find_one({"issue_id": bom["issue_id"]}, {"_id": 0}, sort=[("version", -1)])
            if plan:
                mats = plan.get("tools_materials") or []
                for m in mats:
                    if m["name"].lower() == item["name"].lower():
                        m["status"] = gr_status
                        await _db.gr_plans.update_one({"id": plan["id"]}, {"$set": {"tools_materials": mats}})
                        break
        await _cap(user["id"], "readiness.item_status", {"status": req.status})
        return _view(bom)

    @r.post("/issues/{iid}/ask")
    async def compat_ask(iid: str, req: AskReq, user: dict = Depends(get_current_user)):
        issue = await _owned_issue(iid, user["id"])
        q = (req.question or "").strip()
        if not q:
            raise HTTPException(status_code=400, detail="Ask a question first.")
        bom = await _latest_bom(iid)
        plan = await _db.gr_plans.find_one({"issue_id": iid}, {"_id": 0, "tasks": 0}, sort=[("version", -1)])
        system = (
            "You are Homie helping a homeowner with a materials/tools COMPATIBILITY or SUBSTITUTE question before "
            "they spend money. Be honest about uncertainty; never guess specs. If the substitution affects safety "
            "or the result, say so plainly and recommend verifying (label, manual, or a store associate). "
            "Return STRICT JSON {answer: string, verdict in [compatible, not_compatible, verify_first, depends], "
            "what_to_verify: [array of short strings], affects_safety: boolean}"
        )
        ctx = (f"PROJECT: {issue.get('description')}\nPLAN OBJECTIVE: {plan.get('objective') if plan else '(none)'}\n"
               f"ITEM IN QUESTION: {req.item_name or '(not specified)'}\n"
               f"CURRENT LIST: {[i['name'] for i in (bom.get('items') if bom else [])][:25]}\n"
               f"HOMEOWNER ASKS: {q}")
        try:
            data = await _llm_json(system, ctx, max_tokens=600, feature_area="readiness_compat")
            answer = str(data.get("answer") or "")[:1500]
            verdict = data.get("verdict") if data.get("verdict") in ("compatible", "not_compatible", "verify_first", "depends") else "verify_first"
            verify = [str(v)[:200] for v in (data.get("what_to_verify") or [])][:6]
            safety = bool(data.get("affects_safety"))
        except Exception:
            answer, verdict, verify, safety = ("I couldn't check that right now — please verify the product label or ask a store associate.",
                                               "verify_first", [], False)
        # Decision Ledger entry (shared with Guided Repair).
        await _db.gr_decisions.insert_one({
            "id": _nid(), "issue_id": iid, "user_id": user["id"], "type": "material_compatibility",
            "summary": f"Asked: {q[:180]}" + (f" (item: {req.item_name})" if req.item_name else ""),
            "detail": f"Verdict: {verdict}. {answer[:300]}", "created_at": _now()})
        await _cap(user["id"], "readiness.compat_asked", {"verdict": verdict})
        return {"answer": answer, "verdict": verdict, "what_to_verify": verify, "affects_safety": safety}

    return r


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/readiness", tags=["readiness-admin"])

    @r.get("/signals")
    async def signals(admin: dict = Depends(require_admin)):
        boms = await _db.rd_boms.find({}, {"_id": 0, "items": 1}).to_list(2000)
        total_items = sum(len(b.get("items") or []) for b in boms)
        statuses: dict = {}
        for b in boms:
            for i in b.get("items") or []:
                statuses[i["status"]] = statuses.get(i["status"], 0) + 1
        return {"bom_count": len(boms), "total_items": total_items, "status_breakdown": statuses}

    return r
