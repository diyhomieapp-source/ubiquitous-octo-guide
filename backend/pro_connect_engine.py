"""
DIYhomie — Professional Procedure Packs, Creator Content & "Bring in a Pro" (Build Document 48).

DIY does not mean do it alone. This engine connects the Doc 47 guidance runtime to:
- Creator/professional demonstrations ("Watch a Pro") indexed to exact procedure steps
- Professional insight attribution cards
- Automatic contextual project-brief generation (user never re-explains the project)
- Assistance requests: quick_question | remote_review | live_video | design_review | get_quotes | hire_pro
- DIY + Pro scope splitting (safety-engine-classified per step)

Content labels are honest: professional_demonstration / creator_demonstration /
diyhomie_demonstration / community_submission. Never imply licensure unless verified.
Demo clips are MOCKED placeholders until real creator video assets are provided.

Collections: pc_creators, pc_demos, pc_insights, pc_follows, pc_saved, pc_briefs,
pc_requests, pc_scopes.
"""
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

ASSISTANCE_TYPES = ["quick_question", "remote_review", "live_video", "design_review", "get_quotes", "hire_pro"]
REQUEST_STATUSES = ["submitted", "matched", "in_progress", "completed", "cancelled"]
CONTENT_LABELS = ["professional_demonstration", "creator_demonstration", "diyhomie_demonstration", "community_submission"]
PRO_STATUS_LEVELS = ["community_contributor", "verified_creator", "verified_professional", "licensed_professional", "diyhomie_expert"]
SCOPE_SELECTIONS = ["diy_all_safe", "help_specific_parts", "pro_handles_it"]


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


# ================================================================ seed content
def _seed_creators():
    return [
        {"id": "creator_mike", "name": "Mike Delgado", "channel_name": "Mike's Finish Carpentry",
         "specialties": ["finish carpentry", "drywall", "painting"], "trade": "Finish Carpentry",
         "professional_status": "verified_creator", "years_experience": 22,
         "bio": "Finish carpenter showing the small moves that make work look professional.",
         "follower_count": 48200, "affiliate_disclosure": None, "social_links": [], "verification_status": "verified"},
        {"id": "creator_sarah", "name": "Sarah Thompson", "channel_name": "Thompson Design Studio",
         "specialties": ["residential design", "permits", "layout"], "trade": "Licensed Architect",
         "professional_status": "licensed_professional", "years_experience": 15,
         "bio": "Licensed architect helping homeowners plan changes that pass inspection the first time.",
         "follower_count": 21500, "affiliate_disclosure": None, "social_links": [], "verification_status": "license_verified"},
        {"id": "creator_lena", "name": "Lena Ortiz", "channel_name": "Ortiz Plumbing School",
         "specialties": ["plumbing", "fixtures", "leak prevention"], "trade": "Master Plumber",
         "professional_status": "licensed_professional", "years_experience": 18,
         "bio": "Master plumber. I teach the checks pros do that homeowners skip.",
         "follower_count": 33800, "affiliate_disclosure": None, "social_links": [], "verification_status": "license_verified"},
        {"id": "creator_bella", "name": "Bella Nguyen", "channel_name": "Party Pro Bella",
         "specialties": ["balloon art", "crafts", "party design"], "trade": "Balloon Artist",
         "professional_status": "verified_creator", "years_experience": 9,
         "bio": "Professional balloon artist — twists, locks and shapes for total beginners.",
         "follower_count": 112000, "affiliate_disclosure": "Some supply links may be affiliate links.", "social_links": [], "verification_status": "verified"},
    ]


def _seed_demos():
    # clip_url values are MOCKED placeholders — indexed, short, step-anchored clips per Doc 48 §4-5.
    return [
        {"id": "demo_tape_edges", "creator_id": "creator_mike", "label": "professional_demonstration",
         "title": "How a finish carpenter tapes a crisp edge", "duration_sec": 95, "skill_level": "beginner",
         "procedure_id": "paint_wall_v1", "step_ids": ["tape_edges"], "related_tools": ["painters_tape"],
         "source_attribution": "Mike's Finish Carpentry — Verified Creator", "clip_url": "mock://clips/tape_edges", "views": 0},
        {"id": "demo_cut_in", "creator_id": "creator_mike", "label": "professional_demonstration",
         "title": "Cutting in a laser-straight paint line", "duration_sec": 118, "skill_level": "intermediate",
         "procedure_id": "paint_wall_v1", "step_ids": ["cut_in"], "related_tools": ["paint_brush"],
         "source_attribution": "Mike's Finish Carpentry — Verified Creator", "clip_url": "mock://clips/cut_in", "views": 0},
        {"id": "demo_roll_w", "creator_id": "creator_mike", "label": "professional_demonstration",
         "title": "The W-pattern roll, demonstrated", "duration_sec": 84, "skill_level": "beginner",
         "procedure_id": "paint_wall_v1", "step_ids": ["roll_wall", "second_coat"], "related_tools": ["paint_roller"],
         "source_attribution": "Mike's Finish Carpentry — Verified Creator", "clip_url": "mock://clips/roll_w", "views": 0},
        {"id": "demo_shutoff", "creator_id": "creator_lena", "label": "professional_demonstration",
         "title": "Shutting off and draining a toilet the pro way", "duration_sec": 102, "skill_level": "beginner",
         "procedure_id": "toilet_replace_v1", "step_ids": ["close_shutoff", "disconnect_supply"], "related_tools": ["pliers"],
         "source_attribution": "Lena Ortiz, Master Plumber — License Verified", "clip_url": "mock://clips/shutoff", "views": 0},
        {"id": "demo_wax_seal", "creator_id": "creator_lena", "label": "professional_demonstration",
         "title": "Wax seal prep and a one-shot toilet set", "duration_sec": 140, "skill_level": "intermediate",
         "procedure_id": "toilet_replace_v1", "step_ids": ["scrape_flange", "set_seal", "set_toilet"], "related_tools": ["scraper"],
         "source_attribution": "Lena Ortiz, Master Plumber — License Verified", "clip_url": "mock://clips/wax_seal", "views": 0},
        {"id": "demo_leak_check", "creator_id": "creator_lena", "label": "professional_demonstration",
         "title": "The two-flush leak check pros always do", "duration_sec": 76, "skill_level": "beginner",
         "procedure_id": "toilet_replace_v1", "step_ids": ["leak_check"], "related_tools": ["flashlight"],
         "source_attribution": "Lena Ortiz, Master Plumber — License Verified", "clip_url": "mock://clips/leak_check", "views": 0},
        {"id": "demo_twist_lock", "creator_id": "creator_bella", "label": "creator_demonstration",
         "title": "The lock twist — the one move behind every balloon animal", "duration_sec": 88, "skill_level": "beginner",
         "procedure_id": "balloon_dog_v1", "step_ids": ["make_nose", "make_ears", "lock_head", "front_legs", "back_legs"],
         "related_tools": [], "source_attribution": "Party Pro Bella — Verified Creator", "clip_url": "mock://clips/twist_lock", "views": 0},
        {"id": "demo_balloon_inflate", "creator_id": "creator_bella", "label": "creator_demonstration",
         "title": "Inflating a 260 without popping it", "duration_sec": 61, "skill_level": "beginner",
         "procedure_id": "balloon_dog_v1", "step_ids": ["inflate", "tie_nozzle"], "related_tools": ["hand_pump"],
         "source_attribution": "Party Pro Bella — Verified Creator", "clip_url": "mock://clips/inflate", "views": 0},
    ]


def _seed_insights():
    return [
        {"id": "insight_permits", "creator_id": "creator_sarah", "procedure_id": "toilet_replace_v1", "step_ids": ["identify_toilet"],
         "attribution": "Sarah Thompson, Licensed Architect",
         "quote": "Swapping a toilet in place rarely needs a permit — but moving the drain or supply location usually does. Verify local requirements before changing the layout."},
        {"id": "insight_quarter_turn", "creator_id": "creator_lena", "procedure_id": "toilet_replace_v1", "step_ids": ["reconnect_supply", "tighten_bolts"],
         "attribution": "Lena Ortiz, Master Plumber",
         "quote": "Hand-tight plus a quarter turn. Every cracked tank and stripped supply nut I've replaced came from someone cranking it 'one more turn to be safe'."},
        {"id": "insight_burnish", "creator_id": "creator_mike", "procedure_id": "paint_wall_v1", "step_ids": ["tape_edges", "cut_in"],
         "attribution": "Mike Delgado, Finish Carpenter",
         "quote": "Tape doesn't fail — unburnished tape fails. Thirty seconds with a putty knife along the edge saves an hour of touch-ups."},
        {"id": "insight_hold_twist", "creator_id": "creator_bella", "procedure_id": "balloon_dog_v1", "step_ids": ["make_nose", "lock_head"],
         "attribution": "Bella Nguyen, Professional Balloon Artist",
         "quote": "Never let go until a twist is locked against another twist. Single twists always unwind — locked pairs never do."},
    ]


# Doc 48 §2 — procedure source hierarchy metadata applied to Doc 47 procedure packs.
_PACK_META = {
    "paint_wall_v1": {
        "risk_level": "low", "supported_materials": ["latex paint", "primer", "painter's tape"],
        "supported_products": ["standard interior latex", "low-VOC paint"],
        "source_references": [
            {"level": 1, "type": "manufacturer", "label": "Paint manufacturer application instructions"},
            {"level": 4, "type": "creator", "label": "Mike's Finish Carpentry demonstrations"},
            {"level": 5, "type": "diyhomie", "label": "DIYhomie curated painting procedure"},
        ]},
    "toilet_replace_v1": {
        "risk_level": "moderate", "supported_materials": ["wax ring", "closet bolts", "supply line"],
        "supported_products": ["standard 2-bolt floor-mount toilets"],
        "source_references": [
            {"level": 1, "type": "manufacturer", "label": "Toilet manufacturer installation guide"},
            {"level": 2, "type": "code", "label": "Local plumbing code — fixture replacement"},
            {"level": 3, "type": "professional", "label": "Lena Ortiz, Master Plumber — reviewed"},
            {"level": 5, "type": "diyhomie", "label": "DIYhomie curated plumbing procedure"},
        ]},
    "balloon_dog_v1": {
        "risk_level": "minimal", "supported_materials": ["260 modeling balloons"],
        "supported_products": ["260/twisting balloons"],
        "source_references": [
            {"level": 4, "type": "creator", "label": "Party Pro Bella demonstrations"},
            {"level": 5, "type": "diyhomie", "label": "DIYhomie curated craft procedure"},
        ]},
}


async def seed_pro_connect():
    for c in _seed_creators():
        if not await _db.pc_creators.find_one({"id": c["id"]}, {"_id": 0, "id": 1}):
            await _db.pc_creators.insert_one({**c, "created_at": _now()})
    for d in _seed_demos():
        if not await _db.pc_demos.find_one({"id": d["id"]}, {"_id": 0, "id": 1}):
            await _db.pc_demos.insert_one({**d, "created_at": _now()})
    for i in _seed_insights():
        if not await _db.pc_insights.find_one({"id": i["id"]}, {"_id": 0, "id": 1}):
            await _db.pc_insights.insert_one({**i, "created_at": _now()})
    # enrich Doc 47 procedure packs with Doc 48 source hierarchy + versioning
    for pid, meta in _PACK_META.items():
        await _db.guide_procedures.update_one(
            {"id": pid, "source_references": {"$exists": False}},
            {"$set": {**meta, "version": 1, "review_status": "reviewed",
                      "effective_date": _now(),
                      "ai_note": "AI explanations never override manufacturer, code, or safety requirements."}})


# ================================================================ brief builder
async def _build_brief(user: dict, session_id: Optional[str], procedure_id: Optional[str],
                       project_id: Optional[str], question: Optional[str],
                       budget_range: Optional[str], service_type: Optional[str]) -> dict:
    session = None
    proc = None
    if session_id:
        session = await _db.guide_sessions.find_one({"id": session_id, "user_id": user["id"]}, {"_id": 0})
        if session:
            procedure_id = procedure_id or session.get("procedure_id")
            project_id = project_id or session.get("project_id")
    if procedure_id:
        proc = await _db.guide_procedures.find_one({"id": procedure_id}, {"_id": 0})
    steps = (proc or {}).get("steps") or []
    by_id = {s["stepId"]: s for s in steps}
    completed_ids = (session or {}).get("completed_steps") or []
    completed = [by_id[i]["task"] for i in completed_ids if i in by_id]
    cur_idx = (session or {}).get("current_step_index", 0)
    current_task = steps[cur_idx]["task"] if cur_idx < len(steps) else None
    remaining = [s["task"] for s in steps[cur_idx:]][:12]
    risks = [w for w in ((session or {}).get("safety_warnings") or [])]
    risks += [{"step_id": s["stepId"], "note": s["safety_note"]} for s in steps if s.get("safety_note") and s["stepId"] not in completed_ids]
    home = await _db.hi_properties.find_one({"user_id": user["id"], "is_active": True},
                                            {"_id": 0, "id": 1, "nickname": 1, "property_type": 1, "year_built": 1, "city": 1})
    project = await _db.hi_projects.find_one({"id": project_id, "user_id": user["id"]},
                                             {"_id": 0, "id": 1, "title": 1, "project_category": 1, "risk_level": 1}) if project_id else None
    return {
        "id": _nid(), "user_id": user["id"],
        "project_name": (project or {}).get("title") or (proc or {}).get("title") or "Home project",
        "procedure_id": procedure_id, "project_id": project_id, "session_id": session_id,
        "current_task": current_task,
        "user_question": (question or "").strip()[:1000] or None,
        "home_context": home, "room_id": (session or {}).get("room_id"),
        "measurements": (session or {}).get("measurements") or [],
        "materials_tools": (proc or {}).get("tools") or [],
        "steps_completed": completed, "steps_remaining": remaining,
        "identified_risks": risks[:10],
        "relevant_procedure": {"id": (proc or {}).get("id"), "title": (proc or {}).get("title"),
                               "risk_level": (proc or {}).get("risk_level"),
                               "source_references": (proc or {}).get("source_references") or []} if proc else None,
        "budget_range": budget_range, "preferred_service_type": service_type,
        "evidence": [], "created_at": _now(),
    }


# ================================================================ models
class BriefReq(BaseModel):
    session_id: Optional[str] = None
    procedure_id: Optional[str] = None
    project_id: Optional[str] = None
    question: Optional[str] = None
    budget_range: Optional[str] = None
    service_type: Optional[str] = None


class RequestReq(BaseModel):
    brief_id: str
    assistance_type: str
    pro_id: Optional[str] = None
    notes: Optional[str] = None
    contact_preference: Optional[str] = None  # phone | email | in_app


class ScopeReq(BaseModel):
    procedure_id: str
    selection: str  # diy_all_safe | help_specific_parts | pro_handles_it
    pro_step_ids: List[str] = []


# ================================================================ router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/proconnect", dependencies=[Depends(get_current_user)])

    # -------- Watch a Pro (Doc 48 §4-5)
    @r.get("/support")
    async def step_support(procedure_id: str, step_id: Optional[str] = None, user: dict = Depends(get_current_user)):
        dq: dict = {"procedure_id": procedure_id}
        iq: dict = {"procedure_id": procedure_id}
        if step_id:
            dq["step_ids"] = step_id
            iq["step_ids"] = step_id
        demos = await _db.pc_demos.find(dq, {"_id": 0}).to_list(20)
        insights = await _db.pc_insights.find(iq, {"_id": 0}).to_list(10)
        creators = {c["id"]: c for c in await _db.pc_creators.find(
            {"id": {"$in": list({d["creator_id"] for d in demos} | {i["creator_id"] for i in insights})}},
            {"_id": 0}).to_list(20)}
        saved = {s["demo_id"] for s in await _db.pc_saved.find({"user_id": user["id"]}, {"_id": 0, "demo_id": 1}).to_list(200)}
        following = {f["creator_id"] for f in await _db.pc_follows.find({"user_id": user["id"]}, {"_id": 0, "creator_id": 1}).to_list(200)}
        for d in demos:
            c = creators.get(d["creator_id"]) or {}
            d["creator"] = {"id": c.get("id"), "channel_name": c.get("channel_name"), "trade": c.get("trade"),
                            "professional_status": c.get("professional_status")}
            d["saved"] = d["id"] in saved
            d["following_creator"] = d["creator_id"] in following
        for i in insights:
            c = creators.get(i["creator_id"]) or {}
            i["creator_status"] = c.get("professional_status")
        return {"demos": demos, "insights": insights}

    @r.post("/demos/{did}/view")
    async def view_demo(did: str, user: dict = Depends(get_current_user)):
        d = await _db.pc_demos.find_one({"id": did}, {"_id": 0})
        if not d:
            raise HTTPException(status_code=404, detail="Demonstration not found.")
        await _db.pc_demos.update_one({"id": did}, {"$inc": {"views": 1}})
        await _cap(user, "professional.content.viewed", {"demo_id": did, "creator_id": d["creator_id"], "label": d["label"]})
        return {"ok": True, "clip_url": d["clip_url"],
                "note": "Demo clips are placeholders until creator video assets are connected."}

    @r.post("/demos/{did}/save")
    async def save_demo(did: str, user: dict = Depends(get_current_user)):
        if not await _db.pc_demos.find_one({"id": did}, {"_id": 0, "id": 1}):
            raise HTTPException(status_code=404, detail="Demonstration not found.")
        existing = await _db.pc_saved.find_one({"user_id": user["id"], "demo_id": did}, {"_id": 0, "id": 1})
        if existing:
            await _db.pc_saved.delete_one({"user_id": user["id"], "demo_id": did})
            return {"ok": True, "saved": False}
        await _db.pc_saved.insert_one({"id": _nid(), "user_id": user["id"], "demo_id": did, "created_at": _now()})
        return {"ok": True, "saved": True}

    @r.get("/saved")
    async def saved_demos(user: dict = Depends(get_current_user)):
        rows = await _db.pc_saved.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
        demos = {d["id"]: d for d in await _db.pc_demos.find({"id": {"$in": [x["demo_id"] for x in rows]}}, {"_id": 0}).to_list(100)}
        creators = {c["id"]: c for c in await _db.pc_creators.find({}, {"_id": 0}).to_list(50)}
        out = []
        for x in rows:
            d = demos.get(x["demo_id"])
            if d:
                c = creators.get(d["creator_id"]) or {}
                out.append({**d, "creator": {"id": c.get("id"), "channel_name": c.get("channel_name"), "trade": c.get("trade")}})
        return {"demos": out}

    @r.post("/insights/{iid}/open")
    async def open_insight(iid: str, user: dict = Depends(get_current_user)):
        i = await _db.pc_insights.find_one({"id": iid}, {"_id": 0})
        if not i:
            raise HTTPException(status_code=404, detail="Insight not found.")
        await _cap(user, "professional.insight.opened", {"insight_id": iid, "creator_id": i["creator_id"]})
        return {"ok": True}

    # -------- creators (Doc 48 §10)
    @r.get("/creators/{cid}")
    async def creator_profile(cid: str, user: dict = Depends(get_current_user)):
        c = await _db.pc_creators.find_one({"id": cid}, {"_id": 0})
        if not c:
            raise HTTPException(status_code=404, detail="Creator not found.")
        demos = await _db.pc_demos.find({"creator_id": cid}, {"_id": 0}).to_list(50)
        insights = await _db.pc_insights.find({"creator_id": cid}, {"_id": 0}).to_list(50)
        procs = {p["id"]: p["title"] for p in await _db.guide_procedures.find(
            {"id": {"$in": list({d["procedure_id"] for d in demos})}}, {"_id": 0, "id": 1, "title": 1}).to_list(20)}
        following = bool(await _db.pc_follows.find_one({"user_id": user["id"], "creator_id": cid}, {"_id": 0, "id": 1}))
        return {"creator": c, "demos": demos, "insights": insights,
                "featured_procedures": [{"id": k, "title": v} for k, v in procs.items()], "following": following}

    @r.post("/creators/{cid}/follow")
    async def follow_creator(cid: str, user: dict = Depends(get_current_user)):
        if not await _db.pc_creators.find_one({"id": cid}, {"_id": 0, "id": 1}):
            raise HTTPException(status_code=404, detail="Creator not found.")
        existing = await _db.pc_follows.find_one({"user_id": user["id"], "creator_id": cid}, {"_id": 0, "id": 1})
        if existing:
            await _db.pc_follows.delete_one({"user_id": user["id"], "creator_id": cid})
            return {"ok": True, "following": False}
        await _db.pc_follows.insert_one({"id": _nid(), "user_id": user["id"], "creator_id": cid, "created_at": _now()})
        await _cap(user, "creator.followed", {"creator_id": cid})
        return {"ok": True, "following": True}

    # -------- Bring in a Pro (Doc 48 §6-7)
    @r.post("/briefs")
    async def create_brief(req: BriefReq, user: dict = Depends(get_current_user)):
        await _cap(user, "bring_in_pro.opened", {"procedure_id": req.procedure_id, "has_session": bool(req.session_id)})
        brief = await _build_brief(user, req.session_id, req.procedure_id, req.project_id,
                                   req.question, req.budget_range, req.service_type)
        await _db.pc_briefs.insert_one(dict(brief)); brief.pop("_id", None)
        await _cap(user, "project_brief.generated", {"procedure_id": brief.get("procedure_id")})
        return {"brief": brief, "assistance_types": ASSISTANCE_TYPES}

    @r.get("/briefs/{bid}")
    async def get_brief(bid: str, user: dict = Depends(get_current_user)):
        b = await _db.pc_briefs.find_one({"id": bid, "user_id": user["id"]}, {"_id": 0})
        if not b:
            raise HTTPException(status_code=404, detail="Brief not found.")
        return {"brief": b}

    @r.post("/requests")
    async def create_request(req: RequestReq, user: dict = Depends(get_current_user)):
        if req.assistance_type not in ASSISTANCE_TYPES:
            raise HTTPException(status_code=400, detail="Unknown assistance type.")
        brief = await _db.pc_briefs.find_one({"id": req.brief_id, "user_id": user["id"]}, {"_id": 0})
        if not brief:
            raise HTTPException(status_code=404, detail="Brief not found.")
        pro = await _db.pro_partners.find_one({"id": req.pro_id, "active": True}, {"_id": 0, "id": 1, "name": 1}) if req.pro_id else None
        doc = {"id": _nid(), "user_id": user["id"], "brief_id": req.brief_id,
               "assistance_type": req.assistance_type, "pro_id": (pro or {}).get("id"),
               "pro_name": (pro or {}).get("name"),
               "notes": (req.notes or "").strip()[:1000] or None,
               "contact_preference": req.contact_preference or "in_app",
               "project_name": brief.get("project_name"), "status": "submitted",
               "status_history": [{"status": "submitted", "at": _now()}],
               "created_at": _now(), "updated_at": _now()}
        await _db.pc_requests.insert_one(dict(doc)); doc.pop("_id", None)
        await _cap(user, "professional_request.submitted", {"assistance_type": req.assistance_type, "has_pro": bool(pro)})
        if req.assistance_type in ("quick_question", "remote_review", "live_video", "design_review"):
            await _cap(user, "consultation_requested", {"assistance_type": req.assistance_type})
        else:
            await _cap(user, "quote_requested", {"assistance_type": req.assistance_type})
        return {"request": doc,
                "message": "Your request and full project brief are packaged — the professional will see exactly where you are, no re-explaining needed."}

    @r.get("/requests")
    async def list_requests(user: dict = Depends(get_current_user)):
        rows = await _db.pc_requests.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
        return {"requests": rows, "statuses": REQUEST_STATUSES}

    @r.post("/requests/{rid}/cancel")
    async def cancel_request(rid: str, user: dict = Depends(get_current_user)):
        res = await _db.pc_requests.update_one(
            {"id": rid, "user_id": user["id"], "status": {"$in": ["submitted", "matched"]}},
            {"$set": {"status": "cancelled", "updated_at": _now()},
             "$push": {"status_history": {"status": "cancelled", "at": _now()}}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Request not found or already in progress.")
        return {"ok": True}

    # -------- DIY + Pro scope splitting (Doc 48 §8)
    @r.get("/scope")
    async def get_scope(procedure_id: str, user: dict = Depends(get_current_user)):
        proc = await _db.guide_procedures.find_one({"id": procedure_id}, {"_id": 0})
        if not proc:
            raise HTTPException(status_code=404, detail="Procedure not found.")
        try:
            from safety_engine import evaluate_action
        except Exception:
            evaluate_action = None
        classified = []
        for s in proc.get("steps") or []:
            bucket, reason = "diy_friendly", None
            if evaluate_action:
                res = evaluate_action(f"{s['task']} {s['voice'].get('instruction', '')}", None)
                if res.get("verdict") in ("block_action", "escalate_to_professional"):
                    bucket, reason = "professional_required", (res.get("reasons") or [None])[0]
                elif res.get("verdict") == "require_verification" or s.get("safety_note"):
                    bucket, reason = "professional_recommended", (res.get("reasons") or [s.get("safety_note")])[0]
            elif s.get("safety_note"):
                bucket, reason = "professional_recommended", s.get("safety_note")
            classified.append({"stepId": s["stepId"], "task": s["task"], "bucket": bucket, "reason": reason})
        saved = await _db.pc_scopes.find_one({"user_id": user["id"], "procedure_id": procedure_id}, {"_id": 0})
        return {"procedure": {"id": proc["id"], "title": proc["title"], "risk_level": proc.get("risk_level")},
                "steps": classified, "selections": SCOPE_SELECTIONS, "saved_scope": saved}

    @r.put("/scope")
    async def put_scope(req: ScopeReq, user: dict = Depends(get_current_user)):
        if req.selection not in SCOPE_SELECTIONS:
            raise HTTPException(status_code=400, detail="Unknown scope selection.")
        doc = {"user_id": user["id"], "procedure_id": req.procedure_id, "selection": req.selection,
               "pro_step_ids": req.pro_step_ids[:50], "updated_at": _now()}
        await _db.pc_scopes.update_one({"user_id": user["id"], "procedure_id": req.procedure_id},
                                       {"$set": doc, "$setOnInsert": {"id": _nid(), "created_at": _now()}}, upsert=True)
        await _cap(user, "diy_pro_scope.updated", {"procedure_id": req.procedure_id, "selection": req.selection,
                                                   "pro_step_count": len(req.pro_step_ids)})
        return {"ok": True, "scope": doc}

    return r


# ================================================================ admin router
class StatusReq(BaseModel):
    status: str


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/proconnect", dependencies=[Depends(require_admin)])

    @r.get("/requests")
    async def all_requests(status: Optional[str] = None, admin: dict = Depends(require_admin)):
        q = {"status": status} if status else {}
        rows = await _db.pc_requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(300)
        return {"requests": rows}

    @r.put("/requests/{rid}/status")
    async def set_status(rid: str, req: StatusReq, admin: dict = Depends(require_admin)):
        if req.status not in REQUEST_STATUSES:
            raise HTTPException(status_code=400, detail="Unknown status.")
        res = await _db.pc_requests.update_one(
            {"id": rid}, {"$set": {"status": req.status, "updated_at": _now()},
                          "$push": {"status_history": {"status": req.status, "at": _now()}}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Request not found.")
        if req.status == "completed":
            row = await _db.pc_requests.find_one({"id": rid}, {"_id": 0, "user_id": 1, "assistance_type": 1})
            await _cap({"id": row["user_id"]}, "professional_request.completed", {"assistance_type": row.get("assistance_type")})
        return {"ok": True}

    return r
