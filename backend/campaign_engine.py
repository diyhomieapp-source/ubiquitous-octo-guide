"""
DIYhomie Sponsored Learning, Campaigns & Brand Collaboration Suite (Info Sheet #63).

Separate module. Lets brands/admins launch sponsored skills challenges & campaign
weeks tied to education lessons/tasks, with join/complete flows, badge/discount
rewards, consent-gated story sharing, and partner impact analytics.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional, Callable, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import audit_engine

_db = None
_logger = None


def configure(db, logger):
    global _db, _logger
    _db = db
    _logger = logger


def _now():
    return datetime.now(timezone.utc).isoformat()


def _new_id():
    return str(uuid.uuid4())


# ----------------------------------------------------------- seed
SEED = [
    {"slug": "smart-lighting-month", "title": "Smart Lighting Month", "sponsor_name": "LumaBright",
     "theme": "lighting", "status": "active", "product_tag": "LED smart switches",
     "featured_pro": "Casey R. (Electrician)",
     "description": "Level up your home lighting — learn, install & save energy with LumaBright.",
     "reward": {"badge": "Smart Lighting Pro", "discount_code": "LUMA15", "credit": 0},
     "milestones": [
         {"id": "m1", "title": "Finish 'Cut-in & roll like a pro'", "type": "lesson", "ref_slug": "paint-basics", "points": 20},
         {"id": "m2", "title": "Log a lighting upgrade project", "type": "task", "ref_slug": "", "points": 30},
         {"id": "m3", "title": "Share your before/after", "type": "task", "ref_slug": "", "points": 20},
     ]},
    {"slug": "prep-for-winter", "title": "Prep for Winter", "sponsor_name": "ThermaGuard",
     "theme": "seasonal", "status": "active", "product_tag": "Weatherproofing kits",
     "featured_pro": "Dana P. (GC)",
     "description": "Winterize your home in a weekend with guided ThermaGuard challenges.",
     "reward": {"badge": "Winter-Ready Homeowner", "discount_code": "WARM20", "credit": 0},
     "milestones": [
         {"id": "m1", "title": "Complete 'Shut off water safely'", "type": "lesson", "ref_slug": "plumbing-101", "points": 25},
         {"id": "m2", "title": "Seal one drafty window/door", "type": "task", "ref_slug": "", "points": 25},
     ]},
]


async def seed_campaigns():
    if await _db.campaigns.count_documents({}) == 0:
        for c in SEED:
            await _db.campaigns.insert_one({**c, "id": _new_id(), "created_at": _now(),
                                            "starts_at": _now(), "ends_at": None})
        if _logger:
            _logger.info("campaigns seeded")


# ----------------------------------------------------------- helpers
async def _lesson_done(user_id: str, ref_slug: str) -> bool:
    """A 'lesson' milestone is satisfied if the user completed any lesson in that track."""
    if not ref_slug:
        return False
    return await _db.edu_progress.count_documents(
        {"user_id": user_id, "track_slug": ref_slug, "status": "completed"}) > 0


async def _my_part(campaign_id: str, user_id: str) -> Optional[dict]:
    return await _db.campaign_participation.find_one(
        {"campaign_id": campaign_id, "user_id": user_id}, {"_id": 0})


def _progress(campaign: dict, part: Optional[dict]) -> dict:
    total = len(campaign.get("milestones", []))
    done = len((part or {}).get("completed_milestones", []))
    return {"total": total, "completed": done, "pct": int(round(done / total * 100)) if total else 0,
            "joined": bool(part), "status": (part or {}).get("status", "not_joined"),
            "reward_claimed": (part or {}).get("reward_claimed", False),
            "story_opt_in": (part or {}).get("story_opt_in", False)}


# ----------------------------------------------------------- user router
class StoryOptIn(BaseModel):
    opt_in: bool
    story: Optional[str] = None


def build_user_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api")

    @r.get("/campaigns")
    async def list_campaigns(user: dict = Depends(get_current_user)):
        rows = await _db.campaigns.find({"status": "active"}, {"_id": 0}).sort("created_at", -1).to_list(100)
        for c in rows:
            c["progress"] = _progress(c, await _my_part(c["id"], user["id"]))
        return {"campaigns": rows}

    @r.get("/campaigns/me")
    async def my_campaigns(user: dict = Depends(get_current_user)):
        parts = await _db.campaign_participation.find({"user_id": user["id"]}, {"_id": 0}).to_list(200)
        out, badges = [], []
        for p in parts:
            c = await _db.campaigns.find_one({"id": p["campaign_id"]}, {"_id": 0})
            if not c:
                continue
            out.append({"campaign": {"slug": c["slug"], "title": c["title"], "sponsor_name": c["sponsor_name"]},
                        "progress": _progress(c, p)})
            if p.get("status") == "completed":
                badges.append({"badge": c.get("reward", {}).get("badge"), "sponsor": c["sponsor_name"],
                               "discount_code": p.get("reward_code")})
        return {"participations": out, "badges": badges}

    @r.get("/campaigns/{slug}")
    async def detail(slug: str, user: dict = Depends(get_current_user)):
        c = await _db.campaigns.find_one({"slug": slug}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Campaign not found")
        part = await _my_part(c["id"], user["id"])
        done_ids = set((part or {}).get("completed_milestones", []))
        for m in c.get("milestones", []):
            m["completed"] = m["id"] in done_ids
            if m["type"] == "lesson" and not m["completed"]:
                m["auto_ready"] = await _lesson_done(user["id"], m.get("ref_slug", ""))
        c["progress"] = _progress(c, part)
        return c

    @r.post("/campaigns/{slug}/join")
    async def join(slug: str, user: dict = Depends(get_current_user)):
        c = await _db.campaigns.find_one({"slug": slug, "status": "active"}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Campaign not active")
        if await _my_part(c["id"], user["id"]):
            return {"ok": True, "existing": True}
        await _db.campaign_participation.insert_one({
            "id": _new_id(), "campaign_id": c["id"], "user_id": user["id"], "joined_at": _now(),
            "completed_milestones": [], "status": "joined", "reward_claimed": False,
            "story_opt_in": False, "reward_code": None})
        await audit_engine.log_event("user", user["id"], "campaign_joined", "campaign",
                                     actor_email=user.get("email"), target_type="campaign", target_id=c["id"],
                                     meta={"slug": slug, "sponsor": c["sponsor_name"]})
        return {"ok": True, "existing": False}

    @r.post("/campaigns/{slug}/milestone/{milestone_id}/complete")
    async def complete_milestone(slug: str, milestone_id: str, user: dict = Depends(get_current_user)):
        c = await _db.campaigns.find_one({"slug": slug, "status": "active"}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Campaign not active")
        milestone = next((m for m in c.get("milestones", []) if m["id"] == milestone_id), None)
        if not milestone:
            raise HTTPException(status_code=404, detail="Milestone not found")
        part = await _my_part(c["id"], user["id"])
        if not part:
            raise HTTPException(status_code=400, detail="Join the campaign first")
        if milestone["type"] == "lesson" and not await _lesson_done(user["id"], milestone.get("ref_slug", "")):
            raise HTTPException(status_code=400, detail="Complete the linked lesson first")
        done = set(part.get("completed_milestones", []))
        done.add(milestone_id)
        all_done = len(done) >= len(c.get("milestones", []))
        update = {"completed_milestones": list(done)}
        reward = None
        if all_done and part.get("status") != "completed":
            update["status"] = "completed"
            update["reward_claimed"] = True
            update["reward_code"] = c.get("reward", {}).get("discount_code")
            update["completed_at"] = _now()
            reward = c.get("reward")
            await audit_engine.log_event("user", user["id"], "campaign_completed", "campaign",
                                         actor_email=user.get("email"), target_type="campaign", target_id=c["id"],
                                         meta={"slug": slug, "badge": (reward or {}).get("badge")})
        await _db.campaign_participation.update_one(
            {"campaign_id": c["id"], "user_id": user["id"]}, {"$set": update})
        part = await _my_part(c["id"], user["id"])
        return {"ok": True, "completed": all_done, "reward": reward, "progress": _progress(c, part)}

    @r.post("/campaigns/{slug}/story-optin")
    async def story_optin(slug: str, req: StoryOptIn, user: dict = Depends(get_current_user)):
        c = await _db.campaigns.find_one({"slug": slug}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Campaign not found")
        part = await _my_part(c["id"], user["id"])
        if not part:
            raise HTTPException(status_code=400, detail="Join the campaign first")
        await _db.campaign_participation.update_one(
            {"campaign_id": c["id"], "user_id": user["id"]},
            {"$set": {"story_opt_in": req.opt_in, "story": req.story if req.opt_in else None}})
        await audit_engine.log_event("user", user["id"], "campaign_story_consent", "consent",
                                     actor_email=user.get("email"), target_type="campaign", target_id=c["id"],
                                     new_value="opt_in" if req.opt_in else "opt_out")
        return {"ok": True, "story_opt_in": req.opt_in}

    return r


# ----------------------------------------------------------- admin router
class CampaignReq(BaseModel):
    slug: str
    title: str
    sponsor_name: str
    theme: str = ""
    description: str = ""
    product_tag: str = ""
    featured_pro: str = ""
    status: str = "draft"
    reward: dict = {}
    milestones: List[dict] = []


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/admin/campaigns", dependencies=[Depends(require_admin)])

    @r.get("")
    async def list_all():
        rows = await _db.campaigns.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
        for c in rows:
            c["participants"] = await _db.campaign_participation.count_documents({"campaign_id": c["id"]})
            c["completions"] = await _db.campaign_participation.count_documents({"campaign_id": c["id"], "status": "completed"})
        return {"campaigns": rows}

    @r.post("")
    async def create(req: CampaignReq):
        if await _db.campaigns.find_one({"slug": req.slug}):
            raise HTTPException(status_code=400, detail="A campaign with that slug already exists")
        await _db.campaigns.insert_one({**req.model_dump(), "id": _new_id(),
                                        "created_at": _now(), "starts_at": _now(), "ends_at": None})
        return {"ok": True}

    @r.put("/{campaign_id}")
    async def update(campaign_id: str, req: CampaignReq):
        res = await _db.campaigns.update_one({"id": campaign_id}, {"$set": req.model_dump()})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Campaign not found")
        return {"ok": True}

    @r.post("/{campaign_id}/toggle")
    async def toggle(campaign_id: str):
        c = await _db.campaigns.find_one({"id": campaign_id}, {"status": 1})
        if not c:
            raise HTTPException(status_code=404, detail="Campaign not found")
        new_status = "ended" if c.get("status") == "active" else "active"
        upd = {"status": new_status}
        if new_status == "ended":
            upd["ends_at"] = _now()
        await _db.campaigns.update_one({"id": campaign_id}, {"$set": upd})
        return {"ok": True, "status": new_status}

    @r.delete("/{campaign_id}")
    async def delete(campaign_id: str):
        await _db.campaigns.delete_one({"id": campaign_id})
        await _db.campaign_participation.delete_many({"campaign_id": campaign_id})
        return {"ok": True}

    @r.get("/{campaign_id}/analytics")
    async def analytics(campaign_id: str):
        c = await _db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Campaign not found")
        parts = await _db.campaign_participation.find({"campaign_id": campaign_id}, {"_id": 0}).to_list(20000)
        joined = len(parts)
        completed = len([p for p in parts if p.get("status") == "completed"])
        story_optins = len([p for p in parts if p.get("story_opt_in")])
        # milestone funnel
        funnel = []
        for m in c.get("milestones", []):
            cnt = len([p for p in parts if m["id"] in p.get("completed_milestones", [])])
            funnel.append({"id": m["id"], "title": m["title"], "completed": cnt})
        stories = [{"story": p.get("story"), "user_id": p["user_id"]} for p in parts if p.get("story_opt_in") and p.get("story")]
        return {"campaign": {"title": c["title"], "sponsor_name": c["sponsor_name"], "status": c["status"]},
                "joined": joined, "completed": completed,
                "completion_rate": int(round(completed / joined * 100)) if joined else 0,
                "story_optins": story_optins, "milestone_funnel": funnel, "stories": stories}

    return r
