"""
DIYhomie — Community Rewards Funding, Redemption & Financial Controls (Build Blueprint 24).

ENHANCES the existing Points system (rewards_engine / reward_accounts / point_ledger) WITHOUT
replacing it. Adds funded redemption: only CONFIRMED-RECEIVED revenue funds the redemption
budget; points are held (not permanently deducted) until a provider CONFIRMS fulfillment;
redemptions are idempotent; fraud review gates risky redemptions; admins get full financial +
provider + fraud controls incl. an emergency pause that never touches core DIYhomie features.

Points are NOT cash and never guarantee a reward until funded eligibility is confirmed.

Collections: revenue_events, community_rewards_pool, reward_allocation_rules,
reward_liability_snapshots, reward_redemptions, reward_providers, reward_catalog_items,
fraud_reviews, rewards_settings. (Balances reuse the existing reward_accounts + point_ledger.)
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

REVENUE_SOURCES = ["affiliate", "referral", "cashback_future", "sponsorship", "manufacturer_program", "other"]
CENTS_PER_POINT = 0.5  # 1000 pts = $5.00
DEFAULT_ALLOCATION_PCT = 0.20  # 20% of confirmed received revenue funds the pool


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


def _sentry(event_type, message):
    try:
        import sentry_sdk
        sentry_sdk.capture_message(f"[rewards_fund:{event_type}] {message}", level="error")
    except Exception:
        pass


async def _settings() -> dict:
    s = await _db.rewards_settings.find_one({"id": "singleton"}, {"_id": 0})
    if not s:
        s = {"id": "singleton", "redemption_enabled": True, "issuance_enabled": True,
             "emergency_mode": False, "safety_reserve": 50.0, "daily_cap": 500.0,
             "monthly_cap": 5000.0, "user_daily_cap": 50.0, "cents_per_point": CENTS_PER_POINT,
             "fraud_threshold": 70, "updated_at": _now()}
        await _db.rewards_settings.insert_one(dict(s))
        s.pop("_id", None)
    return s


async def _pool() -> dict:
    p = await _db.community_rewards_pool.find_one({"id": "singleton"}, {"_id": 0})
    if not p:
        p = {"id": "singleton", "currency": "USD", "confirmed_funds": 0.0, "committed_funds": 0.0,
             "reserved_funds": 0.0, "available_redemption_budget": 0.0, "projected_pending_funds": 0.0,
             "updated_at": _now()}
        await _db.community_rewards_pool.insert_one(dict(p))
        p.pop("_id", None)
    return p


async def _recompute_pool():
    s = await _settings()
    received = await _db.revenue_events.find({"status": "received"}, {"_id": 0}).to_list(5000)
    pending = await _db.revenue_events.find({"status": {"$in": ["approved", "payable"]}}, {"_id": 0}).to_list(5000)
    rules = {r["revenue_source_type"]: r for r in await _db.reward_allocation_rules.find({"enabled": True}, {"_id": 0}).to_list(50)}

    def alloc(ev):
        pct = rules.get(ev["source_type"], {}).get("allocation_percentage", DEFAULT_ALLOCATION_PCT)
        return (ev.get("amount") or 0) * pct

    confirmed = round(sum(alloc(e) for e in received), 2)
    projected = round(sum(alloc(e) for e in pending), 2)
    committed = round(sum((r.get("requested_value") or 0) for r in await _db.reward_redemptions.find(
        {"status": {"$in": ["points_held", "provider_processing", "fulfilled", "eligibility_review", "fraud_review"]}}, {"_id": 0}).to_list(5000)), 2)
    reserve = s["safety_reserve"]
    available = round(max(0.0, confirmed - committed - reserve), 2)
    await _db.community_rewards_pool.update_one({"id": "singleton"}, {"$set": {
        "confirmed_funds": confirmed, "committed_funds": committed, "reserved_funds": reserve,
        "available_redemption_budget": available, "projected_pending_funds": projected, "updated_at": _now()}}, upsert=True)
    return await _pool()


async def _account(user_id: str) -> dict:
    acc = await _db.reward_accounts.find_one({"user_id": user_id}, {"_id": 0})
    if not acc:
        acc = {"id": _nid(), "user_id": user_id, "available_points": 0, "pending_points": 0,
               "redeemed_points": 0, "created_at": _now(), "updated_at": _now()}
        await _db.reward_accounts.insert_one(dict(acc))
        acc.pop("_id", None)
    return acc


async def _ledger(user_id, amount, entry_type, description, ref=None):
    await _db.point_ledger.insert_one({
        "id": _nid(), "user_id": user_id, "point_amount": amount, "entry_type": entry_type,
        "status": "redeemed", "description": description, "reward_redemption_id": ref, "created_at": _now()})


# ------------------------------------------------------------- seeding
async def seed_funding():
    if _db is None:
        return
    try:
        await _settings()
        await _pool()
        if not await _db.reward_allocation_rules.find_one({}):
            for src in ["affiliate", "referral", "sponsorship"]:
                await _db.reward_allocation_rules.insert_one({
                    "id": _nid(), "revenue_source_type": src, "allocation_percentage": DEFAULT_ALLOCATION_PCT,
                    "effective_start_date": _now(), "effective_end_date": None, "enabled": True, "created_at": _now()})
        if not await _db.reward_providers.find_one({}):
            pid = _nid()
            # Tango is the abstraction target; runs in SIMULATED mode until real keys are added
            # to the Integration Gateway (Blueprint 18) connector.
            await _db.reward_providers.insert_one({
                "id": pid, "name": "Tango (Gift Cards)", "provider_type": "gift_card", "status": "active",
                "integration_reference": "connector:tango", "simulated": True, "created_at": _now()})
            for name, denom in [("$5 Gift Card", 5.0), ("$10 Gift Card", 10.0), ("$25 Gift Card", 25.0)]:
                await _db.reward_catalog_items.insert_one({
                    "id": _nid(), "provider_id": pid, "external_reward_id": f"gc-{int(denom)}", "name": name,
                    "category": "gift_card", "denomination": denom, "currency": "USD",
                    "availability_status": "available", "geographic_eligibility": "US", "updated_at": _now()})
    except Exception as e:
        if _logger:
            _logger.error(f"rewards funding seed failed: {e}")


# ------------------------------------------------------------- fraud
async def _risk_score(user_id: str) -> tuple:
    acc = await _account(user_id)
    reasons = []
    score = 0
    # redemption velocity
    day_ago = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    recent = await _db.reward_redemptions.count_documents({"user_id": user_id, "created_at": {"$gte": day_ago}})
    if recent >= 3:
        score += 40
        reasons.append("high_redemption_velocity")
    # prior reversals
    reversals = await _db.reward_redemptions.count_documents({"user_id": user_id, "status": "reversed"})
    if reversals >= 1:
        score += 35
        reasons.append("prior_reversal")
    # implausible balance vs history (very new big balance)
    if acc.get("available_points", 0) > 20000 and await _db.point_ledger.count_documents({"user_id": user_id}) < 5:
        score += 40
        reasons.append("earning_pattern")
    return score, reasons


# ------------------------------------------------------------- fulfillment (via provider abstraction)
async def _fulfill(redemption: dict) -> bool:
    provider = await _db.reward_providers.find_one({"id": redemption["provider_id"]}, {"_id": 0})
    if not provider or provider["status"] != "active":
        _sentry("provider_fulfillment_failure", f"provider unavailable for {redemption['id']}")
        return False
    # Real fulfillment runs through the Integration Gateway; simulated providers auto-confirm.
    return bool(provider.get("simulated"))


# ============================================================= models
class RedeemReq(BaseModel):
    catalog_item_id: str
    idempotency_key: str


class RevenueReq(BaseModel):
    source_type: str
    amount: float
    currency: str = "USD"
    partner_id: Optional[str] = None
    partner_transaction_reference: Optional[str] = None
    mark_received: bool = False


class SettingsReq(BaseModel):
    redemption_enabled: Optional[bool] = None
    issuance_enabled: Optional[bool] = None
    emergency_mode: Optional[bool] = None
    safety_reserve: Optional[float] = None
    daily_cap: Optional[float] = None
    user_daily_cap: Optional[float] = None
    cents_per_point: Optional[float] = None


class FraudDecisionReq(BaseModel):
    decision: str  # approved | rejected
    reason: str


# ============================================================= user router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/rewards-funding", dependencies=[Depends(get_current_user)])

    @r.get("/catalog")
    async def catalog(user: dict = Depends(get_current_user)):
        s = await _settings()
        acc = await _account(user["id"])
        items = await _db.reward_catalog_items.find({"availability_status": "available"}, {"_id": 0}).sort("denomination", 1).to_list(100)
        cpp = s["cents_per_point"]
        out = []
        for it in items:
            provider = await _db.reward_providers.find_one({"id": it["provider_id"]}, {"_id": 0})
            points_cost = int(round((it["denomination"] * 100) / cpp))
            out.append({"id": it["id"], "name": it["name"], "denomination": it["denomination"],
                        "currency": it["currency"], "points_cost": points_cost,
                        "provider_name": (provider or {}).get("name"),
                        "affordable": acc["available_points"] >= points_cost,
                        "available": (provider or {}).get("status") == "active" and it["availability_status"] == "available"})
        await _cap(user, "rewards_catalog_opened", {})
        return {"available_points": acc["available_points"], "pending_points": acc.get("pending_points", 0),
                "redemption_enabled": s["redemption_enabled"] and not s["emergency_mode"],
                "emergency_mode": s["emergency_mode"], "catalog": out}

    @r.get("/history")
    async def history(user: dict = Depends(get_current_user)):
        rows = await _db.reward_redemptions.find({"user_id": user["id"]}, {"_id": 0, "idempotency_key": 0}).sort("created_at", -1).to_list(100)
        return {"redemptions": rows}

    @r.post("/redeem")
    async def redeem(req: RedeemReq, user: dict = Depends(get_current_user)):
        s = await _settings()
        # idempotency — repeated taps/retries return the existing redemption
        existing = await _db.reward_redemptions.find_one({"user_id": user["id"], "idempotency_key": req.idempotency_key}, {"_id": 0, "idempotency_key": 0})
        if existing:
            return {"redemption": existing, "duplicate": True}
        if s["emergency_mode"] or not s["redemption_enabled"]:
            await _cap(user, "rewards_emergency_mode_shown", {})
            raise HTTPException(status_code=503, detail="Rewards are temporarily unavailable. Your points remain recorded.")
        item = await _db.reward_catalog_items.find_one({"id": req.catalog_item_id}, {"_id": 0})
        if not item:
            raise HTTPException(status_code=404, detail="Reward not found.")
        provider = await _db.reward_providers.find_one({"id": item["provider_id"]}, {"_id": 0})
        if not provider or provider["status"] != "active":
            raise HTTPException(status_code=503, detail="This reward is temporarily unavailable.")
        acc = await _account(user["id"])
        cost = int(round((item["denomination"] * 100) / s["cents_per_point"]))
        if acc["available_points"] < cost:
            raise HTTPException(status_code=400, detail="You don't have enough points for this reward yet.")
        # funded-budget + caps eligibility
        pool = await _recompute_pool()
        if item["denomination"] > pool["available_redemption_budget"]:
            raise HTTPException(status_code=409, detail="Rewards are temporarily unavailable. Your points remain recorded.")
        day_ago = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        user_today = sum((x.get("requested_value") or 0) for x in await _db.reward_redemptions.find(
            {"user_id": user["id"], "created_at": {"$gte": day_ago}, "status": {"$ne": "failed"}}, {"_id": 0}).to_list(200))
        if user_today + item["denomination"] > s["user_daily_cap"]:
            raise HTTPException(status_code=429, detail="You've reached today's redemption limit. Try again tomorrow.")

        # create redemption + HOLD points (not permanent yet)
        rid = _nid()
        risk, reasons = await _risk_score(user["id"])
        redemption = {"id": rid, "user_id": user["id"], "reward_account_id": acc["id"],
                      "points_redeemed": cost, "requested_value": item["denomination"], "currency": item["currency"],
                      "provider_id": provider["id"], "provider_reward_reference": None,
                      "catalog_item_name": item["name"], "status": "points_held", "idempotency_key": req.idempotency_key,
                      "created_at": _now(), "fulfilled_at": None}
        # place hold
        await _db.reward_accounts.update_one({"id": acc["id"]}, {"$inc": {"available_points": -cost}, "$set": {"updated_at": _now()}})
        if risk >= s["fraud_threshold"]:
            redemption["status"] = "fraud_review"
            await _db.reward_redemptions.insert_one(dict(redemption))
            await _db.fraud_reviews.insert_one({"id": _nid(), "user_id": user["id"], "related_entity_type": "redemption",
                                                "related_entity_id": rid, "risk_score": risk, "risk_reason": ", ".join(reasons),
                                                "status": "pending", "reviewed_by_admin_id": None, "created_at": _now()})
            await _cap(user, "redemption_started", {"held": True, "review": True})
            redemption.pop("idempotency_key", None)
            return {"redemption": redemption, "message": "Your redemption is being reviewed. Your points are safely held."}

        await _db.reward_redemptions.insert_one(dict(redemption))
        await _cap(user, "redemption_started", {"held": True})
        result = await _finalize(redemption, provider, item, user)
        return result

    return r


async def _finalize(redemption: dict, provider: dict, item: dict, user: dict) -> dict:
    rid = redemption["id"]
    await _db.reward_redemptions.update_one({"id": rid}, {"$set": {"status": "provider_processing"}})
    ok = await _fulfill(redemption)
    if ok:
        # permanent deduction: reduce nothing more (already held); move to redeemed tally
        await _db.reward_accounts.update_one({"id": redemption["reward_account_id"]},
                                             {"$inc": {"redeemed_points": redemption["points_redeemed"]}, "$set": {"updated_at": _now()}})
        await _db.reward_redemptions.update_one({"id": rid}, {"$set": {
            "status": "fulfilled", "fulfilled_at": _now(),
            "provider_reward_reference": f"{provider['integration_reference']}/{_nid()[:10]}"}})
        await _ledger(redemption["user_id"], -redemption["points_redeemed"], "redemption",
                      f"Redeemed {item['name']}", rid)
        await _recompute_pool()
        await _cap(user, "redemption_completed", {"value": item["denomination"]})
        out = await _db.reward_redemptions.find_one({"id": rid}, {"_id": 0, "idempotency_key": 0})
        return {"redemption": out, "message": f"Success! Your {item['name']} is on its way."}
    else:
        # release the hold — points are NOT permanently deducted
        await _db.reward_accounts.update_one({"id": redemption["reward_account_id"]},
                                             {"$inc": {"available_points": redemption["points_redeemed"]}, "$set": {"updated_at": _now()}})
        await _db.reward_redemptions.update_one({"id": rid}, {"$set": {"status": "failed"}})
        _sentry("provider_fulfillment_failure", f"released hold for {rid}")
        await _cap(user, "redemption_failed", {})
        out = await _db.reward_redemptions.find_one({"id": rid}, {"_id": 0, "idempotency_key": 0})
        return {"redemption": out, "message": "That didn't go through and your points were returned. You can try again."}


# ============================================================= admin router
def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/rewards", dependencies=[Depends(require_admin)])

    @r.get("/command-center")
    async def command_center(admin: dict = Depends(require_admin)):
        pool = await _recompute_pool()
        s = await _settings()
        # revenue
        rev_received = await _db.revenue_events.find({"status": "received"}, {"_id": 0}).to_list(5000)
        rev_pending = await _db.revenue_events.count_documents({"status": {"$in": ["approved", "payable"]}})
        rev_reversed = await _db.revenue_events.count_documents({"status": "reversed"})
        by_source: dict = {}
        for e in rev_received:
            by_source[e["source_type"]] = round(by_source.get(e["source_type"], 0) + (e.get("amount") or 0), 2)
        # liability
        accts = await _db.reward_accounts.find({}, {"_id": 0}).to_list(20000)
        outstanding = sum(a.get("available_points", 0) for a in accts)
        est_liab = round(outstanding * s["cents_per_point"] / 100.0, 2)
        funding_ratio = round(pool["confirmed_funds"] / est_liab, 2) if est_liab else None
        sustain = "green" if (funding_ratio is None or funding_ratio >= 1) else ("yellow" if funding_ratio >= 0.5 else "red")
        await _db.reward_liability_snapshots.insert_one({
            "id": _nid(), "currency": "USD", "eligible_points_outstanding": outstanding,
            "estimated_redemption_value": est_liab, "committed_redemption_value": pool["committed_funds"],
            "available_reward_funding": pool["available_redemption_budget"], "funding_ratio": funding_ratio,
            "sustainability_status": sustain, "created_at": _now()})
        # fulfillment
        async def _c(st):
            return await _db.reward_redemptions.count_documents({"status": st})
        fulfillment = {st: await _c(st) for st in ["points_held", "provider_processing", "fulfilled", "failed", "reversed", "fraud_review"]}
        fraud_pending = await _db.fraud_reviews.count_documents({"status": "pending"})
        return {
            "revenue": {"confirmed_total": round(sum(e.get("amount", 0) for e in rev_received), 2),
                        "by_source": by_source, "pending_events": rev_pending, "reversed_events": rev_reversed},
            "funding": pool, "settings": s,
            "liability": {"outstanding_points": outstanding, "estimated_liability": est_liab,
                          "funding_ratio": funding_ratio, "sustainability_status": sustain},
            "fulfillment": fulfillment, "fraud_pending": fraud_pending}

    @r.post("/revenue")
    async def record_revenue(req: RevenueReq, admin: dict = Depends(require_admin)):
        if req.source_type not in REVENUE_SOURCES:
            raise HTTPException(status_code=400, detail="Invalid revenue source.")
        ev = {"id": _nid(), "source_type": req.source_type, "partner_id": req.partner_id,
              "partner_transaction_reference": req.partner_transaction_reference, "user_id": None,
              "related_project_id": None, "amount": req.amount, "currency": req.currency,
              "status": "received" if req.mark_received else "approved",
              "occurred_at": _now(), "received_at": _now() if req.mark_received else None, "created_at": _now()}
        await _db.revenue_events.insert_one(dict(ev))
        pool = await _recompute_pool()
        ev.pop("_id", None)
        return {"revenue_event": ev, "pool": pool}

    @r.post("/revenue/{eid}/receive")
    async def mark_received(eid: str, admin: dict = Depends(require_admin)):
        ev = await _db.revenue_events.find_one({"id": eid}, {"_id": 0})
        if not ev:
            raise HTTPException(status_code=404, detail="Revenue event not found.")
        await _db.revenue_events.update_one({"id": eid}, {"$set": {"status": "received", "received_at": _now()}})
        return {"pool": await _recompute_pool()}

    @r.post("/revenue/{eid}/reverse")
    async def reverse_revenue(eid: str, admin: dict = Depends(require_admin)):
        if not await _db.revenue_events.find_one({"id": eid}):
            raise HTTPException(status_code=404, detail="Revenue event not found.")
        await _db.revenue_events.update_one({"id": eid}, {"$set": {"status": "reversed"}})
        return {"pool": await _recompute_pool()}

    @r.put("/settings")
    async def update_settings(req: SettingsReq, admin: dict = Depends(require_admin)):
        upd = {k: v for k, v in req.dict().items() if v is not None}
        if upd:
            upd["updated_at"] = _now()
            await _db.rewards_settings.update_one({"id": "singleton"}, {"$set": upd})
        return await _recompute_pool() and await _settings()

    @r.post("/emergency-mode")
    async def emergency(admin: dict = Depends(require_admin), body: dict = None):
        enabled = bool((body or {}).get("enabled", True))
        await _db.rewards_settings.update_one({"id": "singleton"}, {"$set": {"emergency_mode": enabled, "updated_at": _now()}})
        return {"emergency_mode": enabled}

    @r.get("/fraud-reviews")
    async def fraud_reviews(admin: dict = Depends(require_admin)):
        rows = await _db.fraud_reviews.find({"status": "pending"}, {"_id": 0}).sort("created_at", 1).to_list(200)
        return {"reviews": rows}

    @r.post("/fraud-reviews/{fid}/decide")
    async def decide_fraud(fid: str, req: FraudDecisionReq, admin: dict = Depends(require_admin)):
        fr = await _db.fraud_reviews.find_one({"id": fid}, {"_id": 0})
        if not fr:
            raise HTTPException(status_code=404, detail="Review not found.")
        if req.decision not in ("approved", "rejected"):
            raise HTTPException(status_code=400, detail="Invalid decision.")
        await _db.fraud_reviews.update_one({"id": fid}, {"$set": {"status": req.decision, "decision_reason": req.reason,
                                                                  "reviewed_by_admin_id": admin["id"], "reviewed_at": _now()}})
        redemption = await _db.reward_redemptions.find_one({"id": fr["related_entity_id"]}, {"_id": 0})
        if not redemption:
            return {"ok": True}
        if req.decision == "approved":
            provider = await _db.reward_providers.find_one({"id": redemption["provider_id"]}, {"_id": 0})
            item = await _db.reward_catalog_items.find_one({"id": None}, {"_id": 0}) or {"name": redemption.get("catalog_item_name", "Reward"), "denomination": redemption["requested_value"]}
            await _finalize(redemption, provider, item, {"id": redemption["user_id"]})
        else:
            # rejected → release the held points back to the user
            await _db.reward_accounts.update_one({"id": redemption["reward_account_id"]},
                                                 {"$inc": {"available_points": redemption["points_redeemed"]}, "$set": {"updated_at": _now()}})
            await _db.reward_redemptions.update_one({"id": redemption["id"]}, {"$set": {"status": "declined"}})
        await _recompute_pool()
        return {"ok": True, "decision": req.decision}

    @r.post("/providers/{pid}/pause")
    async def pause_provider(pid: str, admin: dict = Depends(require_admin)):
        if not await _db.reward_providers.find_one({"id": pid}):
            raise HTTPException(status_code=404, detail="Provider not found.")
        await _db.reward_providers.update_one({"id": pid}, {"$set": {"status": "paused"}})
        return {"ok": True}

    @r.post("/providers/{pid}/activate")
    async def activate_provider(pid: str, admin: dict = Depends(require_admin)):
        if not await _db.reward_providers.find_one({"id": pid}):
            raise HTTPException(status_code=404, detail="Provider not found.")
        await _db.reward_providers.update_one({"id": pid}, {"$set": {"status": "active"}})
        return {"ok": True}

    return r
