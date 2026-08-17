"""
Build Doc 13 — Project-First Marketplace & Smart Procurement Engine.
Namespace /api/hi/market/* (+ admin /api/hi/admin/market/*).

The marketplace serves the project — not the other way around:
- Project-GATED: every entry originates from a validated BOM requirement (Doc 7 rd_boms).
  No requirement, no product push.
- Recommendation contract per option: why recommended, requirement status, compatibility
  label (confirmed_fit / verify_fit / alternative / not_recommended) with basis +
  what-to-verify, honest price range, retailer + affiliate DISCLOSURE before click.
- Fulfillment paths: buy / use_owned / borrow / rent / professional_supply — never
  defaults to purchase. Selections sync back to project readiness (BOM item status).
- Consent-aware outbound attribution (mk_attribution) — opt-out keeps guidance,
  drops tracking. Budget preference (lowest_safe / balanced / durability / use_owned).
- Admin quality controls: pause/resume categories; paused categories never recommend.

Collections: mk_options, mk_cart, mk_attribution, mk_prefs, mk_quality_flags.
Reuses affiliate_engine retailer config + link builder + disclosure.
"""
from datetime import datetime, timezone
from typing import Callable, Optional
import uuid

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

import affiliate_engine

_db = None
_logger = None
_llm_json: Optional[Callable] = None

COMPAT_LABELS = ("confirmed_fit", "verify_fit", "alternative", "not_recommended")
FULFILLMENTS = ("buy", "use_owned", "borrow", "rent", "professional_supply")
CART_STATUSES = ("saved", "purchased", "obtained", "unavailable", "removed")
BUDGET_PREFS = ("lowest_safe", "balanced", "durability", "use_owned")


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


async def _prefs(uid: str) -> dict:
    p = await _db.mk_prefs.find_one({"user_id": uid}, {"_id": 0})
    return p or {"user_id": uid, "attribution_consent": True, "budget_pref": "balanced"}


async def _paused_categories() -> set:
    rows = await _db.mk_quality_flags.find({"action": "pause"}, {"_id": 0, "category": 1}).to_list(100)
    return {r["category"].lower() for r in rows}


async def _retailer_links(query: str) -> list:
    cfg = await affiliate_engine.ensure_config()
    links = []
    for rk, rconf in affiliate_engine._ordered_retailers(cfg)[:4]:
        links.append({"retailer": rk, "label": rconf.get("label") or rk,
                      "url": affiliate_engine._build_link(rk, rconf, query)})
    return links


async def _bom_item(item_id: str, uid: str):
    bom = await _db.rd_boms.find_one({"items.id": item_id, "user_id": uid}, {"_id": 0})
    if not bom:
        raise HTTPException(status_code=404, detail="Requirement not found.")
    item = next(i for i in bom["items"] if i["id"] == item_id)
    return bom, item


class SelectReq(BaseModel):
    fulfillment: str
    note: Optional[str] = None


class CartStatusReq(BaseModel):
    status: str


class OutboundReq(BaseModel):
    option_id: str
    retailer: str


class PrefsReq(BaseModel):
    attribution_consent: Optional[bool] = None
    budget_pref: Optional[str] = None


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/market", tags=["marketplace"])

    @r.get("/issues/{iid}/entry")
    async def entry(iid: str, user: dict = Depends(get_current_user)):
        issue = await _owned_issue(iid, user["id"])
        bom = await _db.rd_boms.find_one({"issue_id": iid}, {"_id": 0}, sort=[("version", -1)])
        if not bom:
            return {"gated": True, "requirements": [], "cart": [],
                    "message": "The marketplace starts from your project's needs — build the Materials & Budget list first."}
        cart = await _db.mk_cart.find({"issue_id": iid, "user_id": user["id"], "status": {"$ne": "removed"}},
                                      {"_id": 0}).to_list(100)
        cart_by_item = {c["bom_item_id"]: c for c in cart}
        reqs = []
        for it in bom.get("items") or []:
            if it["status"] in ("skipped",):
                continue
            reqs.append({"bom_item_id": it["id"], "name": it["name"], "kind": it["kind"],
                         "requirement": it["requirement"], "status": it["status"],
                         "resolved": it["status"] == "have_it" or (cart_by_item.get(it["id"], {}).get("status") in ("purchased", "obtained")),
                         "needs_verification": it["status"] == "need_verification",
                         "cost_low": it.get("cost_low"), "cost_high": it.get("cost_high"),
                         "inventory_match": it.get("inventory_match"),
                         "cart_entry": cart_by_item.get(it["id"])})
        prefs = await _prefs(user["id"])
        essentials_unresolved = [q["name"] for q in reqs if q["requirement"] == "required" and not q["resolved"]]
        await _cap(user["id"], "marketplace.entry_opened", {"requirements": len(reqs)})
        return {"gated": False, "issue": {"id": iid, "description": issue.get("description")},
                "requirements": reqs, "cart": cart, "preferences": prefs,
                "essentials_unresolved": essentials_unresolved,
                "project_ready": not essentials_unresolved,
                "disclosure": affiliate_engine.DISCLOSURE}

    @r.post("/items/{item_id}/options")
    async def options(item_id: str, user: dict = Depends(get_current_user)):
        bom, item = await _bom_item(item_id, user["id"])
        paused = await _paused_categories()
        if item["name"].lower() in paused or (item.get("kind") or "").lower() in paused:
            raise HTTPException(status_code=423, detail="Recommendations for this category are temporarily paused for quality review.")
        cached = await _db.mk_options.find_one({"bom_item_id": item_id}, {"_id": 0})
        if cached:
            return {"options": cached["options"], "cached": True, "disclosure": affiliate_engine.DISCLOSURE}
        issue = await _db.gr_issues.find_one({"id": bom["issue_id"]}, {"_id": 0, "description": 1})
        measurements = await _db.gr_measurements.find({"issue_id": bom["issue_id"]},
                                                      {"_id": 0, "measure_type": 1, "value": 1, "unit": 1}).to_list(10)
        prefs = await _prefs(user["id"])
        system = (
            "You are Homie recommending PRODUCT OPTIONS for one project requirement — compatibility before commission. "
            "Use ONLY the facts provided; when fit can't be confirmed from them, the label MUST be verify_fit with "
            "specific things to verify. Never invent measurements or model numbers. Give 2-3 generic-but-searchable "
            "options (no fake brands). Budget preference: " + prefs.get("budget_pref", "balanced") + ". "
            "Return STRICT JSON {options: [{name: searchable product name (3-6 words), why_recommended: short, "
            "requirement_status: one of [required, recommended, optional, alternative], "
            "compatibility: one of [confirmed_fit, verify_fit, alternative, not_recommended], "
            "compatibility_basis: short factual reason, needs_verification: [short strings, empty if confirmed], "
            "price_low: number|null, price_high: number|null, tradeoff: short honest tradeoff or null}]}"
        )
        ctx = (f"PROJECT: {issue.get('description') if issue else ''}\n"
               f"REQUIREMENT: {item['name']} ({item['kind']}, {item['requirement']})\n"
               f"PURPOSE: {item.get('purpose')}\nSUBSTITUTE HINT: {item.get('substitute_hint')}\n"
               f"KNOWN MEASUREMENTS: {measurements or 'none'}\n"
               f"QTY: {item.get('qty_estimate')} {item.get('unit') or ''}")
        try:
            data = await _llm_json(system, ctx, max_tokens=800, feature_area="market_options")
            raw = data.get("options") or []
            if not raw:
                raise ValueError("empty")
        except Exception as e:
            if _logger:
                _logger.warning(f"market options AI failed, generic fallback: {e}")
            raw = [{"name": item["name"], "why_recommended": "Matches your project requirement directly.",
                    "requirement_status": item["requirement"] if item["requirement"] in ("required", "optional") else "recommended",
                    "compatibility": "verify_fit", "compatibility_basis": "Generic match on the requirement name only.",
                    "needs_verification": ["Confirm size/spec against your project before buying."],
                    "price_low": item.get("cost_low"), "price_high": item.get("cost_high"), "tradeoff": None}]
        opts = []
        for o in raw[:3]:
            if not isinstance(o, dict) or not o.get("name"):
                continue
            def _num(v):
                try:
                    return round(float(v), 2) if v is not None else None
                except (TypeError, ValueError):
                    return None
            compat = o.get("compatibility") if o.get("compatibility") in COMPAT_LABELS else "verify_fit"
            if compat == "not_recommended":
                continue
            opts.append({"id": _nid(), "name": str(o["name"])[:120],
                         "why_recommended": str(o.get("why_recommended") or "")[:300],
                         "requirement_status": o.get("requirement_status") if o.get("requirement_status") in ("required", "recommended", "optional", "alternative") else "recommended",
                         "compatibility": compat,
                         "compatibility_basis": str(o.get("compatibility_basis") or "")[:300],
                         "needs_verification": [str(v)[:200] for v in (o.get("needs_verification") or [])][:4],
                         "price_low": _num(o.get("price_low")), "price_high": _num(o.get("price_high")),
                         "tradeoff": (str(o.get("tradeoff"))[:250] if o.get("tradeoff") else None),
                         "retailer_links": await _retailer_links(str(o["name"])[:120]),
                         "sponsored": False})
        await _db.mk_options.insert_one({"id": _nid(), "bom_item_id": item_id, "issue_id": bom["issue_id"],
                                         "user_id": user["id"], "options": opts, "created_at": _now()})
        await _cap(user["id"], "marketplace.option_compared", {"count": len(opts)})
        return {"options": opts, "cached": False, "disclosure": affiliate_engine.DISCLOSURE}

    @r.post("/items/{item_id}/select")
    async def select(item_id: str, req: SelectReq, user: dict = Depends(get_current_user)):
        if req.fulfillment not in FULFILLMENTS:
            raise HTTPException(status_code=400, detail="Invalid fulfillment path.")
        bom, item = await _bom_item(item_id, user["id"])
        # Sync back to readiness (Doc 7) so project readiness stays truthful.
        bom_status = {"buy": "will_buy", "use_owned": "have_it", "borrow": "will_borrow",
                      "rent": "will_rent", "professional_supply": "skipped"}[req.fulfillment]
        for i in bom["items"]:
            if i["id"] == item_id:
                i["status"] = bom_status
                if req.fulfillment == "professional_supply":
                    i["status_note"] = "Professional will supply & install"
        await _db.rd_boms.update_one({"id": bom["id"]}, {"$set": {"items": bom["items"]}})
        entry = {"id": _nid(), "issue_id": bom["issue_id"], "user_id": user["id"], "bom_item_id": item_id,
                 "name": item["name"], "fulfillment": req.fulfillment,
                 "status": "obtained" if req.fulfillment == "use_owned" else "saved",
                 "note": (req.note or "")[:300] or None, "created_at": _now(), "updated_at": _now()}
        await _db.mk_cart.update_one({"bom_item_id": item_id, "user_id": user["id"]},
                                     {"$set": entry}, upsert=True)
        await _cap(user["id"], "project_requirement.fulfillment_selected", {"path": req.fulfillment})
        return {"ok": True, "cart_entry": entry}

    @r.post("/cart/{entry_id}/status")
    async def cart_status(entry_id: str, req: CartStatusReq, user: dict = Depends(get_current_user)):
        if req.status not in CART_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status.")
        entry = await _db.mk_cart.find_one({"id": entry_id, "user_id": user["id"]}, {"_id": 0})
        if not entry:
            raise HTTPException(status_code=404, detail="Cart entry not found.")
        await _db.mk_cart.update_one({"id": entry_id}, {"$set": {"status": req.status, "updated_at": _now()}})
        if req.status in ("purchased", "obtained"):
            bom, item = await _bom_item(entry["bom_item_id"], user["id"])
            for i in bom["items"]:
                if i["id"] == entry["bom_item_id"]:
                    i["status"] = "have_it"
            await _db.rd_boms.update_one({"id": bom["id"]}, {"$set": {"items": bom["items"]}})
            await _cap(user["id"], "project_requirement.marked_obtained", {})
        return {"ok": True}

    @r.get("/issues/{iid}/cart/export")
    async def cart_export(iid: str, user: dict = Depends(get_current_user)):
        issue = await _owned_issue(iid, user["id"])
        cart = await _db.mk_cart.find({"issue_id": iid, "user_id": user["id"], "status": {"$nin": ["removed"]}},
                                      {"_id": 0}).to_list(100)
        lines = [f"SHOPPING LIST — {issue.get('description', '')[:80]}", ""]
        for f in FULFILLMENTS:
            rows = [c for c in cart if c["fulfillment"] == f]
            if rows:
                lines.append({"buy": "TO BUY:", "use_owned": "ALREADY OWNED:", "borrow": "TO BORROW:",
                              "rent": "TO RENT:", "professional_supply": "PRO WILL SUPPLY:"}[f])
                for c in rows:
                    mark = "✓" if c["status"] in ("purchased", "obtained") else "•"
                    lines.append(f"{mark} {c['name']}")
                lines.append("")
        lines.append("Prepared with DIYhomie — verify fit before purchase.")
        return {"export_text": "\n".join(lines)}

    @r.post("/outbound")
    async def outbound(req: OutboundReq, user: dict = Depends(get_current_user)):
        opt_doc = await _db.mk_options.find_one({"options.id": req.option_id, "user_id": user["id"]}, {"_id": 0})
        if not opt_doc:
            raise HTTPException(status_code=404, detail="Option not found.")
        opt = next(o for o in opt_doc["options"] if o["id"] == req.option_id)
        link = next((l for l in opt["retailer_links"] if l["retailer"] == req.retailer), None)
        if not link:
            raise HTTPException(status_code=400, detail="Retailer not available for this option.")
        prefs = await _prefs(user["id"])
        attributed = bool(prefs.get("attribution_consent", True))
        if attributed:
            await _db.mk_attribution.insert_one({
                "id": _nid(), "user_id": user["id"], "issue_id": opt_doc["issue_id"],
                "bom_item_id": opt_doc["bom_item_id"], "option_id": req.option_id,
                "retailer": req.retailer, "product_name": opt["name"],
                "consent": True, "created_at": _now()})
            await _cap(user["id"], "marketplace.attribution_recorded", {"retailer": req.retailer})
        await _cap(user["id"], "marketplace.outbound_referral_opened", {"retailer": req.retailer, "attributed": attributed})
        return {"url": link["url"], "disclosure": affiliate_engine.DISCLOSURE, "attributed": attributed}

    @r.get("/preferences")
    async def get_prefs(user: dict = Depends(get_current_user)):
        return {"preferences": await _prefs(user["id"])}

    @r.put("/preferences")
    async def put_prefs(req: PrefsReq, user: dict = Depends(get_current_user)):
        upd = {"user_id": user["id"], "updated_at": _now()}
        if req.attribution_consent is not None:
            upd["attribution_consent"] = bool(req.attribution_consent)
        if req.budget_pref is not None:
            if req.budget_pref not in BUDGET_PREFS:
                raise HTTPException(status_code=400, detail="Invalid budget preference.")
            upd["budget_pref"] = req.budget_pref
        await _db.mk_prefs.update_one({"user_id": user["id"]}, {"$set": upd}, upsert=True)
        return {"preferences": await _prefs(user["id"])}

    return r


class FlagReq(BaseModel):
    category: str
    action: str  # pause | resume


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/market", tags=["marketplace-admin"])

    @r.get("/signals")
    async def signals(admin: dict = Depends(require_admin)):
        options = await _db.mk_options.count_documents({})
        cart = await _db.mk_cart.count_documents({"status": {"$ne": "removed"}})
        obtained = await _db.mk_cart.count_documents({"status": {"$in": ["purchased", "obtained"]}})
        referrals = await _db.mk_attribution.count_documents({})
        flags = await _db.mk_quality_flags.find({}, {"_id": 0}).to_list(50)
        fulfillments: dict = {}
        async for c in _db.mk_cart.find({}, {"_id": 0, "fulfillment": 1}):
            fulfillments[c["fulfillment"]] = fulfillments.get(c["fulfillment"], 0) + 1
        return {"option_sets": options, "cart_entries": cart, "obtained": obtained,
                "attributed_referrals": referrals, "fulfillment_breakdown": fulfillments,
                "quality_flags": flags}

    @r.post("/flag")
    async def flag(req: FlagReq, admin: dict = Depends(require_admin)):
        if req.action not in ("pause", "resume"):
            raise HTTPException(status_code=400, detail="Invalid action.")
        cat = req.category.strip().lower()[:80]
        if not cat:
            raise HTTPException(status_code=400, detail="Category required.")
        if req.action == "pause":
            await _db.mk_quality_flags.update_one({"category": cat}, {"$set": {
                "category": cat, "action": "pause", "by": admin.get("email"), "created_at": _now()}}, upsert=True)
        else:
            await _db.mk_quality_flags.delete_many({"category": cat})
        return {"ok": True}

    return r
