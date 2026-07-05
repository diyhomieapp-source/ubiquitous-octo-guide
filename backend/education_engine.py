"""
DIYhomie Education Center & Learn-to-DIY Content Hub (Info Sheet #62).

Separate module to keep server.py lean. Provides:
  - Modular curriculum tracks + versioned lessons (flashcards, sections, tools, safety).
  - Personal learning dashboard (progress, badges, >=3 suggested lessons).
  - Lesson completion → learning-outcome log + optional micro-cert badge.
  - Admin no-code content CRUD + publish + version control + analytics.
  - Mentor/expert-contributed lessons (approved authors).
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


# ----------------------------------------------------------- seed content
SEED_TRACKS = [
    {"slug": "paint-basics", "title": "First Room Paint", "level": "beginner", "category": "paint",
     "icon": "format-paint", "order": 1, "summary": "Paint any room like a pro — prep, cut-in, roll & finish."},
    {"slug": "plumbing-101", "title": "Plumbing 101", "level": "beginner", "category": "plumbing",
     "icon": "pipe-wrench", "order": 2, "summary": "Stop leaks, swap fixtures & handle common water fixes safely."},
    {"slug": "deck-building", "title": "Deck Building Basics", "level": "intermediate", "category": "outdoor",
     "icon": "deck", "order": 3, "summary": "Plan, build & seal a code-compliant deck that lasts."},
]

SEED_LESSONS = [
    {"track_slug": "paint-basics", "title": "Prep & protect the room", "order": 1, "level": "beginner",
     "est_minutes": 8, "summary": "The secret to a flawless finish is prep, not paint.",
     "sections": ["Clear & center furniture, then drape with plastic.", "Fill nail holes; sand smooth.",
                  "Tape trim & edges with painter's tape at a firm 45°.", "Lay drop cloths along the baseboards."],
     "flashcards": [{"term": "Cut-in", "def": "Hand-painting edges a roller can't reach."},
                    {"term": "Feathering", "def": "Blending wet edges to avoid lap marks."}],
     "tools": ["Painter's tape", "Drop cloth", "Putty knife", "Sanding block"], "safety": ["Ventilate the room"],
     "quiz_topic": "painting"},
    {"track_slug": "paint-basics", "title": "Cut-in & roll like a pro", "order": 2, "level": "beginner",
     "est_minutes": 10, "summary": "Two thin coats always beat one thick one.",
     "sections": ["Cut-in corners & edges first with an angled brush.", "Load the roller evenly on a tray grid.",
                  "Roll in a 'W' then fill — keep a wet edge.", "Let dry 2–4h, then apply a second coat."],
     "flashcards": [{"term": "Nap", "def": "The thickness of a roller cover's fabric."},
                    {"term": "Holiday", "def": "A missed spot with no paint coverage."}],
     "tools": ["Angled brush", "Roller + tray", "Extension pole"], "safety": ["Keep paint off skin"],
     "quiz_topic": "painting"},
    {"track_slug": "plumbing-101", "title": "Shut off water safely", "order": 1, "level": "beginner",
     "est_minutes": 6, "summary": "Every repair starts by killing the water.",
     "sections": ["Find the fixture shut-off valve (under sink / behind toilet).", "Turn clockwise to close.",
                  "If none, use the main shut-off near the meter.", "Open the tap to relieve pressure before working."],
     "flashcards": [{"term": "Angle stop", "def": "The small valve feeding a fixture."},
                    {"term": "Hose bib", "def": "An outdoor faucet/spigot."}],
     "tools": ["Adjustable wrench", "Bucket", "Towels"], "safety": ["Never force a stuck valve"],
     "quiz_topic": "plumbing"},
    {"track_slug": "deck-building", "title": "Plan, layout & permits", "order": 1, "level": "intermediate",
     "est_minutes": 12, "summary": "A great deck is 80% planning.",
     "sections": ["Sketch size, height & stair location.", "Check local code & pull a permit if required.",
                  "Call 811 before you dig for utilities.", "Mark footings with stakes & string, square the corners."],
     "flashcards": [{"term": "Ledger board", "def": "The board fastening the deck to the house."},
                    {"term": "Frost line", "def": "Depth footings must reach to avoid heaving."}],
     "tools": ["Tape measure", "String line", "Stakes", "Post-hole digger"],
     "safety": ["Call 811 before digging", "Wear gloves & eye protection"], "quiz_topic": "decking"},
]


async def seed_education():
    if await _db.edu_tracks.count_documents({}) == 0:
        for t in SEED_TRACKS:
            await _db.edu_tracks.insert_one({**t, "status": "published", "created_at": _now()})
    if await _db.edu_lessons.count_documents({}) == 0:
        for lsn in SEED_LESSONS:
            quiz = await _db.quizzes.find_one({"topic": {"$regex": lsn.get("quiz_topic", ""), "$options": "i"}}, {"id": 1})
            await _db.edu_lessons.insert_one({
                "id": _new_id(), "track_slug": lsn["track_slug"], "title": lsn["title"], "order": lsn["order"],
                "level": lsn["level"], "est_minutes": lsn["est_minutes"], "summary": lsn["summary"],
                "sections": lsn["sections"], "flashcards": lsn["flashcards"], "tools": lsn["tools"],
                "safety": lsn["safety"], "quiz_id": (quiz or {}).get("id"), "micro_cert": True,
                "status": "published", "version": 1, "author_id": None, "author_name": "DIYhomie",
                "created_at": _now(), "updated_at": _now()})
    if _logger:
        _logger.info("education seeded")


# ----------------------------------------------------------- helpers
async def _track_progress(user_id: str, track_slug: str) -> dict:
    lessons = await _db.edu_lessons.count_documents({"track_slug": track_slug, "status": "published"})
    lesson_ids = [l["id"] async for l in _db.edu_lessons.find({"track_slug": track_slug, "status": "published"}, {"id": 1})]
    done = await _db.edu_progress.count_documents({"user_id": user_id, "lesson_id": {"$in": lesson_ids}, "status": "completed"})
    return {"total": lessons, "completed": done, "pct": int(round(done / lessons * 100)) if lessons else 0}


# ----------------------------------------------------------- user router
def build_user_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api")

    @r.get("/education/tracks")
    async def tracks(user: dict = Depends(get_current_user)):
        rows = await _db.edu_tracks.find({"status": "published"}, {"_id": 0}).sort("order", 1).to_list(100)
        for t in rows:
            t["progress"] = await _track_progress(user["id"], t["slug"])
        return {"tracks": rows}

    @r.get("/education/tracks/{slug}")
    async def track_detail(slug: str, user: dict = Depends(get_current_user)):
        track = await _db.edu_tracks.find_one({"slug": slug, "status": "published"}, {"_id": 0})
        if not track:
            raise HTTPException(status_code=404, detail="Track not found")
        lessons = await _db.edu_lessons.find({"track_slug": slug, "status": "published"}, {"_id": 0}).sort("order", 1).to_list(100)
        done_ids = {p["lesson_id"] async for p in _db.edu_progress.find(
            {"user_id": user["id"], "status": "completed"}, {"lesson_id": 1})}
        for l in lessons:
            l["completed"] = l["id"] in done_ids
        track["progress"] = await _track_progress(user["id"], slug)
        return {"track": track, "lessons": lessons}

    @r.get("/education/lessons/{lesson_id}")
    async def lesson(lesson_id: str, user: dict = Depends(get_current_user)):
        lsn = await _db.edu_lessons.find_one({"id": lesson_id, "status": "published"}, {"_id": 0})
        if not lsn:
            raise HTTPException(status_code=404, detail="Lesson not found")
        await _db.edu_progress.update_one(
            {"user_id": user["id"], "lesson_id": lesson_id},
            {"$setOnInsert": {"user_id": user["id"], "lesson_id": lesson_id, "track_slug": lsn["track_slug"],
                              "status": "started", "started_at": _now()}}, upsert=True)
        prog = await _db.edu_progress.find_one({"user_id": user["id"], "lesson_id": lesson_id}, {"_id": 0})
        lsn["completed"] = (prog or {}).get("status") == "completed"
        return lsn

    @r.post("/education/lessons/{lesson_id}/complete")
    async def complete(lesson_id: str, user: dict = Depends(get_current_user)):
        lsn = await _db.edu_lessons.find_one({"id": lesson_id, "status": "published"}, {"_id": 0})
        if not lsn:
            raise HTTPException(status_code=404, detail="Lesson not found")
        await _db.edu_progress.update_one(
            {"user_id": user["id"], "lesson_id": lesson_id},
            {"$set": {"user_id": user["id"], "lesson_id": lesson_id, "track_slug": lsn["track_slug"],
                      "status": "completed", "completed_at": _now(), "micro_cert": lsn.get("micro_cert", False)}},
            upsert=True)
        await audit_engine.log_event("user", user["id"], "lesson_completed", "education",
                                     actor_email=user.get("email"), target_type="lesson", target_id=lesson_id,
                                     meta={"title": lsn["title"], "track": lsn["track_slug"]})
        # next suggestion within the track
        nxt = await _db.edu_lessons.find_one(
            {"track_slug": lsn["track_slug"], "status": "published", "order": {"$gt": lsn.get("order", 0)}},
            {"_id": 0}, sort=[("order", 1)])
        return {"ok": True, "micro_cert": lsn.get("micro_cert", False),
                "quiz_id": lsn.get("quiz_id"), "next_lesson": nxt,
                "progress": await _track_progress(user["id"], lsn["track_slug"])}

    @r.get("/education/me")
    async def my_learning(user: dict = Depends(get_current_user)):
        prog = await _db.edu_progress.find({"user_id": user["id"]}, {"_id": 0}).to_list(1000)
        completed = [p for p in prog if p.get("status") == "completed"]
        done_ids = {p["lesson_id"] for p in completed}
        badges = len([p for p in completed if p.get("micro_cert")])
        # suggested: published lessons not yet completed, prioritise in-progress tracks
        started_tracks = {p["track_slug"] for p in prog}
        all_lessons = await _db.edu_lessons.find({"status": "published"}, {"_id": 0}).sort("order", 1).to_list(500)
        suggested = [l for l in all_lessons if l["id"] not in done_ids and l["track_slug"] in started_tracks]
        suggested += [l for l in all_lessons if l["id"] not in done_ids and l["track_slug"] not in started_tracks]
        sug = [{"id": l["id"], "title": l["title"], "track_slug": l["track_slug"],
                "level": l["level"], "est_minutes": l["est_minutes"]} for l in suggested[:5]]
        return {"completed_count": len(completed), "started_count": len(prog), "badges": badges,
                "suggested": sug, "recent": sorted(completed, key=lambda x: x.get("completed_at", ""), reverse=True)[:5]}

    return r


# ----------------------------------------------------------- admin router
class TrackReq(BaseModel):
    slug: str
    title: str
    level: str = "beginner"
    category: str = ""
    icon: str = "school-outline"
    order: int = 99
    summary: str = ""
    status: str = "published"


class LessonReq(BaseModel):
    track_slug: str
    title: str
    order: int = 1
    level: str = "beginner"
    est_minutes: int = 8
    summary: str = ""
    sections: List[str] = []
    flashcards: List[dict] = []
    tools: List[str] = []
    safety: List[str] = []
    quiz_id: Optional[str] = None
    micro_cert: bool = True
    status: str = "published"


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/admin/education", dependencies=[Depends(require_admin)])

    @r.get("")
    async def list_all():
        tracks = await _db.edu_tracks.find({}, {"_id": 0}).sort("order", 1).to_list(200)
        for t in tracks:
            t["lesson_count"] = await _db.edu_lessons.count_documents({"track_slug": t["slug"]})
        lessons = await _db.edu_lessons.find({}, {"_id": 0}).sort([("track_slug", 1), ("order", 1)]).to_list(1000)
        return {"tracks": tracks, "lessons": lessons}

    @r.get("/analytics")
    async def analytics():
        total_tracks = await _db.edu_tracks.count_documents({})
        total_lessons = await _db.edu_lessons.count_documents({})
        completions = await _db.edu_progress.count_documents({"status": "completed"})
        learners = len(await _db.edu_progress.distinct("user_id"))
        agg = await _db.edu_progress.aggregate(
            [{"$match": {"status": "completed"}},
             {"$group": {"_id": "$track_slug", "count": {"$sum": 1}}}, {"$sort": {"count": -1}}]).to_list(100)
        by_track = [{"track": a["_id"], "completions": a["count"]} for a in agg]
        return {"total_tracks": total_tracks, "total_lessons": total_lessons,
                "completions": completions, "learners": learners, "by_track": by_track}

    @r.post("/tracks")
    async def create_track(req: TrackReq):
        if await _db.edu_tracks.find_one({"slug": req.slug}):
            raise HTTPException(status_code=400, detail="A track with that slug already exists")
        await _db.edu_tracks.insert_one({**req.model_dump(), "created_at": _now()})
        return {"ok": True}

    @r.put("/tracks/{slug}")
    async def update_track(slug: str, req: TrackReq):
        res = await _db.edu_tracks.update_one({"slug": slug}, {"$set": req.model_dump()})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Track not found")
        return {"ok": True}

    @r.delete("/tracks/{slug}")
    async def delete_track(slug: str):
        await _db.edu_tracks.delete_one({"slug": slug})
        await _db.edu_lessons.delete_many({"track_slug": slug})
        return {"ok": True}

    @r.post("/lessons")
    async def create_lesson(req: LessonReq):
        await _db.edu_lessons.insert_one({
            "id": _new_id(), **req.model_dump(), "version": 1, "author_id": None,
            "author_name": "DIYhomie", "created_at": _now(), "updated_at": _now()})
        return {"ok": True}

    @r.put("/lessons/{lesson_id}")
    async def update_lesson(lesson_id: str, req: LessonReq):
        existing = await _db.edu_lessons.find_one({"id": lesson_id}, {"version": 1})
        if not existing:
            raise HTTPException(status_code=404, detail="Lesson not found")
        await _db.edu_lessons.update_one({"id": lesson_id}, {"$set": {
            **req.model_dump(), "version": (existing.get("version", 1) + 1), "updated_at": _now()}})
        return {"ok": True, "version": existing.get("version", 1) + 1}

    @r.delete("/lessons/{lesson_id}")
    async def delete_lesson(lesson_id: str):
        await _db.edu_lessons.delete_one({"id": lesson_id})
        return {"ok": True}

    @r.post("/lessons/{lesson_id}/toggle")
    async def toggle_lesson(lesson_id: str):
        lsn = await _db.edu_lessons.find_one({"id": lesson_id}, {"status": 1})
        if not lsn:
            raise HTTPException(status_code=404, detail="Lesson not found")
        new_status = "draft" if lsn.get("status") == "published" else "published"
        await _db.edu_lessons.update_one({"id": lesson_id}, {"$set": {"status": new_status, "updated_at": _now()}})
        return {"ok": True, "status": new_status}

    return r
