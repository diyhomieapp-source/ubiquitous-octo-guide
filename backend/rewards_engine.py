"""
DIYhomie — Community Points & Rewards Foundation (Build Blueprint 13).

A ledger-backed points system that rewards valuable participation. NOT a
cashback / coupon / marketplace: no linked-card cashback, gift-card fulfilment,
affiliate payouts or reward funding. Points are a community-engagement construct
and explicitly not cash.

Integrity: every balance change has an immutable PointLedgerEntry. Referrals,
contributions, feedback and bug reports are NEVER awarded instantly — they enter
review (pending) and are approved by an admin or by a configured auto-approve
rule. Suspicious events are flagged and held.

Collections: reward_accounts, point_ledger, reward_events, referrals,
project_contributions, community_feedback, reward_rules.
"""
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

EVENT_TYPES = ["project_contribution", "referral", "feedback", "bug_report", "community_contribution", "admin_adjustment"]

# event_type -> default rule
DEFAULT_RULES = {
    "project_contribution": {"points_amount": 250, "verification_required": True, "daily_limit": 2, "monthly_limit": 20},
    "referral": {"points_amount": 500, "verification_required": True, "daily_limit": 5, "monthly_limit": 30},
    "feedback": {"points_amount": 50, "verification_required": True, "daily_limit": 3, "monthly_limit": 20},
    "bug_report": {"points_amount": 150, "verification_required": True, "daily_limit": 3, "monthly_limit": 20},
    "community_contribution": {"points_amount": 200, "verification_required": True, "daily_limit": 2, "monthly_limit": 20},
    "admin_adjustment": {"points_amount": 0, "verification_required": False, "daily_limit": None, "monthly_limit": None},
}

REDEEM_THRESHOLD = 1000  # points needed for first redemption tier (display only)


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


async def _audit(admin, action, meta=None):
    try:
        import admin_ops_engine
        if hasattr(admin_ops_engine, "audit"):
            await admin_ops_engine.audit(admin, action, meta or {})
    except Exception:
        pass


async def seed():
    for et, r in DEFAULT_RULES.items():
        await _db.reward_rules.update_one(
            {"event_type": et},
            {"$setOnInsert": {"id": _nid(), "event_type": et, "points_amount": r["points_amount"],
                              "verification_required": r["verification_required"], "daily_limit": r["daily_limit"],
                              "monthly_limit": r["monthly_limit"], "enabled": True,
                              "created_at": _now(), "updated_at": _now()}},
            upsert=True)
    if _logger:
        _logger.info("rewards (B13) seeded")


# ------------------------------------------------------------- account + ledger
async def _account(user_id: str) -> dict:
    acc = await _db.reward_accounts.find_one({"user_id": user_id}, {"_id": 0})
    if not acc:
        acc = {"id": _nid(), "user_id": user_id, "status": "active",
               "available_points": 0, "pending_points": 0, "redeemed_points": 0,
               "created_at": _now(), "updated_at": _now()}
        await _db.reward_accounts.insert_one(dict(acc))
    return acc


async def _rule(event_type: str) -> dict:
    return await _db.reward_rules.find_one({"event_type": event_type}, {"_id": 0}) or DEFAULT_RULES.get(event_type, {})


async def _within_caps(user_id: str, event_type: str, rule: dict) -> bool:
    now = datetime.now(timezone.utc)
    if rule.get("daily_limit"):
        day = (now - timedelta(days=1)).isoformat()
        n = await _db.reward_events.count_documents({"user_id": user_id, "event_type": event_type, "created_at": {"$gte": day}})
        if n >= rule["daily_limit"]:
            return False
    if rule.get("monthly_limit"):
        month = (now - timedelta(days=30)).isoformat()
        n = await _db.reward_events.count_documents({"user_id": user_id, "event_type": event_type, "created_at": {"$gte": month}})
        if n >= rule["monthly_limit"]:
            return False
    return True


async def _ledger(account: dict, user_id: str, entry_type: str, amount: int, status: str,
                  description: str, reward_event_id: Optional[str] = None) -> dict:
    """Append an immutable ledger entry and update the account balances atomically-ish."""
    if status == "approved":
        account["available_points"] += amount
    elif status == "pending":
        account["pending_points"] += amount
    elif status == "redeemed":
        account["available_points"] -= amount
        account["redeemed_points"] += amount
    balance_after = account["available_points"]
    entry = {"id": _nid(), "reward_account_id": account["id"], "user_id": user_id,
             "reward_event_id": reward_event_id, "entry_type": entry_type, "point_amount": amount,
             "balance_after": balance_after, "status": status, "description": description,
             "created_at": _now(), "approved_at": _now() if status == "approved" else None}
    await _db.point_ledger.insert_one(dict(entry))
    await _db.reward_accounts.update_one({"id": account["id"]}, {"$set": {
        "available_points": account["available_points"], "pending_points": account["pending_points"],
        "redeemed_points": account["redeemed_points"], "updated_at": _now()}})
    entry.pop("_id", None)
    return entry


async def _flag_check(user, event_type: str, related_id: Optional[str]) -> Optional[str]:
    """Basic integrity checks; returns a flag reason or None."""
    uid = user["id"]
    # velocity
    minute_ago = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()
    recent = await _db.reward_events.count_documents({"user_id": uid, "created_at": {"$gte": minute_ago}})
    if recent >= 5:
        return "excessive_velocity"
    # duplicate content for contributions/referrals
    if related_id:
        dup = await _db.reward_events.count_documents({"user_id": uid, "event_type": event_type, "related_entity_id": related_id})
        if dup > 0:
            return "duplicate_submission"
    return None


async def create_reward_event(user, event_type: str, points_proposed: Optional[int] = None,
                              related_type: Optional[str] = None, related_id: Optional[str] = None) -> dict:
    """Create a reward event + pending ledger entry. Never awards instantly unless a
    rule explicitly disables verification."""
    acc = await _account(user["id"])
    if acc["status"] != "active":
        raise HTTPException(status_code=403, detail="Your rewards account is not active.")
    rule = await _rule(event_type)
    if not rule.get("enabled", True):
        raise HTTPException(status_code=400, detail="This reward is currently unavailable.")
    if not await _within_caps(user["id"], event_type, rule):
        raise HTTPException(status_code=429, detail="You've reached the limit for this reward. Try again later.")
    amount = points_proposed if points_proposed is not None else rule.get("points_amount", 0)
    flag = await _flag_check(user, event_type, related_id)
    verification = "flagged" if flag else ("pending" if rule.get("verification_required", True) else "verified")
    event = {"id": _nid(), "user_id": user["id"], "event_type": event_type,
             "related_entity_type": related_type, "related_entity_id": related_id,
             "verification_status": verification, "points_proposed": amount, "points_awarded": 0,
             "flag_reason": flag, "created_at": _now(), "reviewed_at": None}
    await _db.reward_events.insert_one(dict(event))
    await _cap(user, "reward_event_created", {"event_type": event_type})
    # ledger: pending entry (even auto-approve stages through pending->approved)
    await _ledger(acc, user["id"], "earn", amount, "pending",
                  f"{event_type.replace('_', ' ').title()} submitted", reward_event_id=event["id"])
    if verification == "verified" and not flag:
        await _approve_event(event, by="system")
    event.pop("_id", None)
    return event


async def _approve_event(event: dict, by: str = "admin", admin=None):
    acc = await _account(event["user_id"])
    # move the pending ledger entry to approved
    pend = await _db.point_ledger.find_one({"reward_event_id": event["id"], "status": "pending"}, {"_id": 0})
    amount = event["points_proposed"]
    if pend:
        acc["pending_points"] = max(0, acc["pending_points"] - pend["point_amount"])
        acc["available_points"] += pend["point_amount"]
        await _db.point_ledger.update_one({"id": pend["id"]}, {"$set": {
            "status": "approved", "approved_at": _now(), "balance_after": acc["available_points"]}})
        amount = pend["point_amount"]
    await _db.reward_accounts.update_one({"id": acc["id"]}, {"$set": {
        "available_points": acc["available_points"], "pending_points": acc["pending_points"], "updated_at": _now()}})
    await _db.reward_events.update_one({"id": event["id"]}, {"$set": {
        "verification_status": "verified", "points_awarded": amount, "reviewed_at": _now()}})
    await _cap({"id": event["user_id"]}, "points_awarded", {"event_type": event["event_type"], "points": amount})


# ------------------------------------------------------------- models
class FeedbackReq(BaseModel):
    feedback_type: str  # feature_request | bug_report | general_feedback
    title: str
    description: str


class ContributionReq(BaseModel):
    project_id: str
    sharing_preference: str  # private | anonymous | community_review
    summary: str
    lessons_learned: Optional[str] = None


class RuleReq(BaseModel):
    points_amount: Optional[int] = None
    verification_required: Optional[bool] = None
    daily_limit: Optional[int] = None
    monthly_limit: Optional[int] = None
    enabled: Optional[bool] = None


class AdjustReq(BaseModel):
    user_id: str
    points: int
    reason: str


# ============================================================= user router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/rewards", dependencies=[Depends(get_current_user)])

    @r.get("/home")
    async def home(user: dict = Depends(get_current_user)):
        acc = await _account(user["id"])
        recent = await _db.point_ledger.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(10)
        rules = await _db.reward_rules.find({"enabled": True}, {"_id": 0}).to_list(20)
        ways = [{"event_type": x["event_type"], "points_amount": x["points_amount"],
                 "verification_required": x["verification_required"]} for x in rules if x["event_type"] != "admin_adjustment"]
        await _cap(user, "rewards_home_opened", {"source": "profile"})
        avail = acc["available_points"]
        next_reward = REDEEM_THRESHOLD * (avail // REDEEM_THRESHOLD + 1)
        return {"account": acc, "recent": recent, "ways_to_earn": ways,
                "progress": {"available": avail, "next_reward_at": next_reward,
                             "pct": min(100, round((avail % REDEEM_THRESHOLD) / REDEEM_THRESHOLD * 100))}}

    @r.get("/activity")
    async def activity(user: dict = Depends(get_current_user)):
        rows = await _db.point_ledger.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
        return {"entries": rows}

    @r.get("/terms")
    async def terms(user: dict = Depends(get_current_user)):
        return {"terms": [
            {"h": "How you earn", "b": "You can earn DIYhomie Points for approved activities like completing and sharing projects, referring friends, and helping us improve with feedback and bug reports."},
            {"h": "Why review is required", "b": "To keep the program fair, most points are reviewed before they're approved. This protects against spam, duplicates and abuse."},
            {"h": "Point statuses", "b": "Pending Review, Approved, Declined, Reversed, and Redeemed describe where each entry is in its lifecycle."},
            {"h": "Eligibility", "b": "Self-referrals, duplicate accounts, duplicate content and unusual activity may be flagged and held or declined."},
            {"h": "Program changes", "b": "Point values, limits and reward availability can change at any time."},
            {"h": "Not cash", "b": "DIYhomie Points are a community-engagement feature. They are not cash, a bank balance, or a guaranteed monetary value, and cannot be exchanged for money."},
        ]}

    # ---- referral (staged verification)
    @r.get("/referral")
    async def get_referrals(user: dict = Depends(get_current_user)):
        ref = await _db.referrals.find_one({"referrer_user_id": user["id"], "referred_user_id": None}, {"_id": 0})
        invited = await _db.referrals.find({"referrer_user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
        return {"my_code": ref["referral_code"] if ref else None, "referrals": invited}

    @r.post("/referral")
    async def create_referral(user: dict = Depends(get_current_user)):
        existing = await _db.referrals.find_one({"referrer_user_id": user["id"], "referred_user_id": None, "status": "invited"}, {"_id": 0})
        if existing:
            return {"referral_code": existing["referral_code"]}
        code = secrets.token_urlsafe(6)
        doc = {"id": _nid(), "referrer_user_id": user["id"], "referral_code": code, "referred_user_id": None,
               "status": "invited", "created_at": _now(), "verified_at": None, "rewarded_at": None}
        await _db.referrals.insert_one(dict(doc))
        await _cap(user, "referral_link_created", {})
        return {"referral_code": code}

    # ---- feedback / bug report (enters review, never auto-promises points)
    @r.post("/feedback")
    async def feedback(req: FeedbackReq, user: dict = Depends(get_current_user)):
        if req.feedback_type not in ("feature_request", "bug_report", "general_feedback"):
            raise HTTPException(status_code=400, detail="Invalid feedback type.")
        if not req.title.strip() or not req.description.strip():
            raise HTTPException(status_code=400, detail="Add a title and description.")
        fb = {"id": _nid(), "user_id": user["id"], "feedback_type": req.feedback_type,
              "title": req.title.strip()[:140], "description": req.description.strip()[:4000],
              "status": "submitted", "point_eligibility_status": "pending",
              "created_at": _now(), "reviewed_at": None}
        await _db.community_feedback.insert_one(dict(fb))
        et = "bug_report" if req.feedback_type == "bug_report" else "feedback"
        await create_reward_event(user, et, related_type="community_feedback", related_id=fb["id"])
        await _cap(user, "feedback_submitted", {"feedback_type": req.feedback_type})
        fb.pop("_id", None)
        return {"ok": True, "feedback": fb, "note": "Thanks! Eligible reports are reviewed before any points are awarded."}

    # ---- project contribution (after completion)
    @r.get("/contributable")
    async def contributable(user: dict = Depends(get_current_user)):
        projs = await _db.hi_projects.find({"user_id": user["id"], "status": "completed"}, {"_id": 0}).sort("completed_at", -1).to_list(50)
        contributed = set([c["project_id"] for c in await _db.project_contributions.find({"user_id": user["id"]}, {"_id": 0, "project_id": 1}).to_list(200)])
        return {"projects": [{"id": p["id"], "title": p.get("title"), "project_category": p.get("project_category"),
                              "already_contributed": p["id"] in contributed} for p in projs]}

    @r.post("/contributions")
    async def create_contribution(req: ContributionReq, user: dict = Depends(get_current_user)):
        if req.sharing_preference not in ("private", "anonymous", "community_review"):
            raise HTTPException(status_code=400, detail="Choose a sharing preference.")
        proj = await _db.hi_projects.find_one({"id": req.project_id, "user_id": user["id"]}, {"_id": 0})
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found.")
        await _cap(user, "project_contribution_started", {"project_category": proj.get("project_category")})
        status = "draft" if req.sharing_preference == "private" else "submitted"
        con = {"id": _nid(), "project_id": req.project_id, "user_id": user["id"],
               "sharing_preference": req.sharing_preference, "summary": req.summary.strip()[:4000],
               "lessons_learned": (req.lessons_learned or "").strip()[:2000] or None,
               "status": status, "reviewed_by_admin_id": None, "created_at": _now(), "reviewed_at": None}
        await _db.project_contributions.insert_one(dict(con))
        # points only when submitted for community review (not for private)
        if req.sharing_preference != "private":
            await create_reward_event(user, "project_contribution", related_type="project_contribution", related_id=con["id"])
            await _cap(user, "project_contribution_submitted", {"sharing_preference": req.sharing_preference})
        con.pop("_id", None)
        return {"ok": True, "contribution": con,
                "note": "Points are pending review." if req.sharing_preference != "private" else "Saved privately — no points requested."}

    @r.get("/contributions")
    async def list_contributions(user: dict = Depends(get_current_user)):
        rows = await _db.project_contributions.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
        return {"contributions": rows}

    return r


# ============================================================= admin router
def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/rewards", dependencies=[Depends(require_admin)])

    @r.get("/rules")
    async def rules(admin: dict = Depends(require_admin)):
        return {"rules": await _db.reward_rules.find({}, {"_id": 0}).sort("event_type", 1).to_list(20)}

    @r.put("/rules/{event_type}")
    async def update_rule(event_type: str, req: RuleReq, admin: dict = Depends(require_admin)):
        upd = {"updated_at": _now()}
        for f in ("points_amount", "verification_required", "daily_limit", "monthly_limit", "enabled"):
            v = getattr(req, f)
            if v is not None:
                upd[f] = v
        res = await _db.reward_rules.update_one({"event_type": event_type}, {"$set": upd})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Rule not found.")
        await _audit(admin, "reward_rule_updated", {"event_type": event_type, **upd})
        return await _db.reward_rules.find_one({"event_type": event_type}, {"_id": 0})

    @r.get("/pending")
    async def pending(admin: dict = Depends(require_admin)):
        events = await _db.reward_events.find({"verification_status": {"$in": ["pending", "flagged"]}}, {"_id": 0}).sort("created_at", -1).to_list(200)
        return {"events": events}

    @r.post("/events/{event_id}/approve")
    async def approve(event_id: str, admin: dict = Depends(require_admin)):
        ev = await _db.reward_events.find_one({"id": event_id}, {"_id": 0})
        if not ev:
            raise HTTPException(status_code=404, detail="Event not found.")
        if ev["verification_status"] == "verified":
            raise HTTPException(status_code=400, detail="Already approved.")
        await _approve_event(ev, by="admin", admin=admin)
        await _audit(admin, "reward_event_approved", {"event_id": event_id, "user_id": ev["user_id"]})
        if ev.get("related_entity_type") == "project_contribution" and ev.get("related_entity_id"):
            await _db.project_contributions.update_one({"id": ev["related_entity_id"]}, {"$set": {"status": "approved", "reviewed_by_admin_id": admin.get("id"), "reviewed_at": _now()}})
            await _cap({"id": ev["user_id"]}, "project_contribution_approved", {})
        return {"ok": True}

    @r.post("/events/{event_id}/decline")
    async def decline(event_id: str, admin: dict = Depends(require_admin)):
        ev = await _db.reward_events.find_one({"id": event_id}, {"_id": 0})
        if not ev:
            raise HTTPException(status_code=404, detail="Event not found.")
        acc = await _account(ev["user_id"])
        pend = await _db.point_ledger.find_one({"reward_event_id": event_id, "status": "pending"}, {"_id": 0})
        if pend:
            acc["pending_points"] = max(0, acc["pending_points"] - pend["point_amount"])
            await _db.point_ledger.update_one({"id": pend["id"]}, {"$set": {"status": "declined"}})
            await _db.reward_accounts.update_one({"id": acc["id"]}, {"$set": {"pending_points": acc["pending_points"], "updated_at": _now()}})
        await _db.reward_events.update_one({"id": event_id}, {"$set": {"verification_status": "rejected", "reviewed_at": _now()}})
        await _audit(admin, "reward_event_declined", {"event_id": event_id})
        return {"ok": True}

    @r.post("/adjust")
    async def adjust(req: AdjustReq, admin: dict = Depends(require_admin)):
        acc = await _account(req.user_id)
        entry = await _ledger(acc, req.user_id, "adjustment", req.points,
                              "approved" if req.points >= 0 else "approved", f"Admin adjustment: {req.reason}")
        await _audit(admin, "reward_points_adjusted", {"user_id": req.user_id, "points": req.points, "reason": req.reason})
        await _cap({"id": req.user_id}, "points_awarded" if req.points >= 0 else "points_reversed", {"points": abs(req.points)})
        return {"ok": True, "entry": entry}

    @r.post("/ledger/{ledger_id}/reverse")
    async def reverse(ledger_id: str, admin: dict = Depends(require_admin)):
        entry = await _db.point_ledger.find_one({"id": ledger_id}, {"_id": 0})
        if not entry:
            raise HTTPException(status_code=404, detail="Ledger entry not found.")
        if entry["status"] != "approved":
            raise HTTPException(status_code=400, detail="Only approved entries can be reversed.")
        acc = await _account(entry["user_id"])
        rev = await _ledger(acc, entry["user_id"], "reversal", -abs(entry["point_amount"]), "approved",
                            f"Reversal of {ledger_id}")
        await _db.point_ledger.update_one({"id": ledger_id}, {"$set": {"status": "reversed"}})
        await _audit(admin, "reward_points_reversed", {"ledger_id": ledger_id, "user_id": entry["user_id"]})
        await _cap({"id": entry["user_id"]}, "points_reversed", {"points": abs(entry["point_amount"])})
        return {"ok": True, "entry": rev}

    @r.post("/accounts/{user_id}/restrict")
    async def restrict(user_id: str, admin: dict = Depends(require_admin)):
        acc = await _account(user_id)
        await _db.reward_accounts.update_one({"id": acc["id"]}, {"$set": {"status": "restricted", "updated_at": _now()}})
        await _audit(admin, "reward_account_restricted", {"user_id": user_id})
        await _cap({"id": user_id}, "reward_account_restricted", {})
        return {"ok": True}

    return r


# ------------------------------------------------------------- referral hooks (extensible)
async def on_referral_signup(referral_code: str, new_user_id: str):
    """Stage a referral when a new user registers with a code. Never awards here."""
    ref = await _db.referrals.find_one({"referral_code": referral_code, "status": "invited"}, {"_id": 0})
    if not ref or ref["referrer_user_id"] == new_user_id:  # self-referral guard
        return
    await _db.referrals.update_one({"id": ref["id"]}, {"$set": {"referred_user_id": new_user_id, "status": "registered"}})
    try:
        import analytics_engine
        await analytics_engine.capture({"id": ref["referrer_user_id"]}, "referral_registered", {})
    except Exception:
        pass
