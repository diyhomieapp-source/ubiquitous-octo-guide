"""
DIYhomie — Unified Spatial + Fine-Motor Visual Guidance Engine (Build Document 47).

A mobile "visual instruction operating system" — NOT a tutorial library. Procedures are
structured backend data; the runtime selects a guidance mode (SPATIAL_AR, SURFACE_PATH,
FINE_MOTOR, ASSEMBLY, MEASUREMENT_LAYOUT), composes reusable action primitives into
structured instruction objects, adapts Homie's voice by skill level, verifies outcomes with
confidence-aware states, and never falsely claims completion. Safety Engine runs before
every action. Sessions are fully resumable ("Welcome back...").

Reuses: ar_guidance_engine (spatial primitives / packages), safety_engine (verdicts),
analytics_engine (Doc 47 §12 events). Collections: guide_procedures, guide_sessions,
guide_step_attempts, guide_prefs.
"""
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

GUIDANCE_MODES = ["SPATIAL_AR", "SURFACE_PATH", "FINE_MOTOR", "ASSEMBLY", "MEASUREMENT_LAYOUT"]
VERIFICATION_STATES = ["VERIFIED", "LIKELY_COMPLETE", "USER_CONFIRMED", "NEEDS_REVIEW",
                       "CANNOT_VERIFY", "STOP_FOR_SAFETY"]
STEP_CONTROLS = ["show_again", "slow_down", "another_angle", "why", "what_tool",
                 "im_stuck", "pause", "mark_complete", "bring_in_pro"]
SKILL_LEVELS = ["beginner", "intermediate", "advanced"]
CAMERA_VIEWS = ["FIRST_PERSON", "OVERHEAD", "SIDE"]
SPEEDS = ["NORMAL", "SLOW", "SLOWEST"]

# Doc 47 §6 — consistent visual language (accessibility: colors are user-remappable).
VISUAL_VOCABULARY = [
    {"visual": "green_highlight", "meaning": "Correct target or completed task"},
    {"visual": "yellow_highlight", "meaning": "User attention or verification needed"},
    {"visual": "red_keep_out_zone", "meaning": "Do not cut, drill, touch, or proceed"},
    {"visual": "blue_path", "meaning": "Recommended movement path"},
    {"visual": "white_ghost_object", "meaning": "Where an object should be installed"},
    {"visual": "target_dot", "meaning": "Exact action point"},
    {"visual": "rotation_arrow", "meaning": "Twist, tighten, loosen, rotate"},
    {"visual": "start_end_markers", "meaning": "Measurement, cut, tape, caulk, or paint path"},
    {"visual": "virtual_hand_tool", "meaning": "Demonstration of correct movement"},
]

# ---------------------------------------------------------------- fine-motor primitives (Mode C)
# Reusable — deformable/hand tasks share these across balloons, knots, folding, crafts, assembly.
FINE_MOTOR_PRIMITIVES = {
    "INFLATE":        {"motion": "INFLATE", "template": "HAND_INFLATE_DEMONSTRATION", "visuals": ["ghost_hands", "target_dot", "distance_indicator"]},
    "PINCH":          {"motion": "PINCH", "template": "HAND_PINCH_DEMONSTRATION", "visuals": ["ghost_hands", "pinch_highlight", "target_dot"]},
    "TWIST":          {"motion": "TWIST", "template": "HAND_TWIST_DEMONSTRATION", "visuals": ["ghost_hands", "rotation_arrow", "pinch_highlight"]},
    "TWIST_AND_LOCK": {"motion": "TWIST_AND_LOCK", "template": "HAND_TWIST_DEMONSTRATION", "visuals": ["ghost_hands", "rotation_arrow", "pinch_highlight", "direction_arrow"]},
    "FOLD":           {"motion": "FOLD", "template": "HAND_FOLD_DEMONSTRATION", "visuals": ["ghost_hands", "direction_arrow", "path_line"]},
    "TIE":            {"motion": "TIE", "template": "HAND_TIE_DEMONSTRATION", "visuals": ["ghost_hands", "path_line", "direction_arrow"]},
    "PULL":           {"motion": "PULL", "template": "HAND_PULL_DEMONSTRATION", "visuals": ["ghost_hands", "direction_arrow"]},
    "PRESS":          {"motion": "PRESS", "template": "HAND_PRESS_DEMONSTRATION", "visuals": ["ghost_hands", "target_dot"]},
    "GRIP":           {"motion": "GRIP", "template": "HAND_GRIP_DEMONSTRATION", "visuals": ["ghost_hands", "ghost_tool"]},
    "SHAPE":          {"motion": "SHAPE", "template": "HAND_SHAPE_DEMONSTRATION", "visuals": ["ghost_hands", "object_outline"]},
    "THREAD":         {"motion": "THREAD", "template": "HAND_THREAD_DEMONSTRATION", "visuals": ["ghost_hands", "path_line", "target_dot"]},
    "HOLD":           {"motion": "HOLD", "template": "HAND_HOLD_DEMONSTRATION", "visuals": ["ghost_hands", "pinch_highlight"]},
}

_SURFACE_PATH_ACTIONS = {"APPLY_TAPE", "CUT_IN_EDGE", "ROLL_SURFACE", "APPLY_COMPOUND", "EMBED_TAPE",
                         "SAND_SURFACE", "SCRAPE", "CAULK_PATH", "CUT", "SAW", "WIPE_CLEAN"}
_MEASUREMENT_ACTIONS = {"MEASURE", "MARK", "LEVEL_CHECK", "FIND_STUD"}
_ASSEMBLY_ACTIONS = {"PLACE_OBJECT", "ALIGN_OBJECT", "DRIVE_SCREW", "TIGHTEN_BOLT", "TAP_JOINT"}


def select_mode(action_id: str, target_type: Optional[str] = None, hint: Optional[str] = None) -> str:
    """Doc 47 §1 — automatic guidance-mode selection from action primitive + target type."""
    if hint in GUIDANCE_MODES:
        return hint
    if action_id in FINE_MOTOR_PRIMITIVES or (target_type or "") == "DEFORMABLE_OBJECT":
        return "FINE_MOTOR"
    if action_id in _MEASUREMENT_ACTIONS:
        return "MEASUREMENT_LAYOUT"
    if action_id in _SURFACE_PATH_ACTIONS:
        return "SURFACE_PATH"
    if action_id in _ASSEMBLY_ACTIONS:
        return "ASSEMBLY"
    return "SPATIAL_AR"


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


# ---------------------------------------------------------------- structured step builder
def _step(step_id, task, action, target_label, target_type="FIXED_OBJECT", conf=0.6,
          voice="", beginner="", advanced="", why="", tool=None, verify_q="Is this step done?",
          verify_type="USER_CONFIRMATION", camera="FIRST_PERSON", mode_hint=None, safety_note=None,
          speed="NORMAL"):
    """Doc 47 §4 — every visual instruction is a structured, reusable object."""
    try:
        from ar_guidance_engine import ACTION_PRIMITIVES
    except Exception:
        ACTION_PRIMITIVES = {}
    fm = FINE_MOTOR_PRIMITIVES.get(action)
    sp = ACTION_PRIMITIVES.get(action)
    mode = select_mode(action, target_type, mode_hint)
    if fm:
        template, visuals, tool_ = fm["template"], fm["visuals"], tool
    elif sp:
        template = f"TOOL_{sp['motion']}_DEMONSTRATION"
        visuals, tool_ = sp["visuals"], tool or sp["tool"]
    else:
        template, visuals, tool_ = "GENERIC_DEMONSTRATION", ["target_dot"], tool
    return {
        "stepId": step_id, "task": task, "action": action, "guidanceMode": mode,
        "target": {"type": target_type, "label": target_label, "confidenceRequired": conf},
        "visual": {"template": template, "speed": speed, "cameraView": camera,
                   "showArrows": True, "showGhostHands": mode == "FINE_MOTOR",
                   "visuals": visuals},
        "voice": {"instruction": voice, "beginnerExplanation": beginner, "advancedNote": advanced},
        "why": why, "tool": tool_,
        "verification": {"type": verify_type, "question": verify_q},
        "fallback": {"action": "SHOW_AGAIN_SLOWER"},
        "safety_note": safety_note,
    }


# ---------------------------------------------------------------- MVP procedures (Doc 47 §13)
def _seed_procedures():
    return [
        {
            "id": "paint_wall_v1", "title": "Paint a Wall", "category": "painting",
            "primary_mode": "SURFACE_PATH", "difficulty": "beginner", "est_minutes": 120,
            "description": "Scan, tape, cut in, and roll a wall — with path guidance for every stroke.",
            "tools": ["painters_tape", "paint_brush", "paint_roller", "drop_cloth", "paint_tray"],
            "steps": [
                _step("scan_wall", "Scan and highlight the wall", "INSPECT", "the wall you're painting",
                      "SURFACE", 0.5, "Slowly pan your camera across the wall so I can map it.",
                      "Move about an arm's length from the wall and pan left to right slowly.",
                      "Full-surface pass; note damage or grease spots.",
                      "Mapping the wall lets me overlay tape lines, cut-in bands, and roller paths precisely.",
                      None, "Can you see the wall highlighted on screen?", "VISUAL", "FIRST_PERSON", "SPATIAL_AR"),
                _step("preview_color", "Preview the color on your wall", "INSPECT", "highlighted wall surface",
                      "SURFACE", 0.5, "Here's your color previewed on the wall. Look at it from a couple of angles.",
                      "Colors look different in daylight versus lamp light — check both if you can.",
                      "Verify sheen and undertone against trim.",
                      "Seeing the color in your real light prevents repaint regret.",
                      None, "Happy with this color?", "USER_CONFIRMATION", "FIRST_PERSON", "SPATIAL_AR"),
                _step("tape_edges", "Apply painter's tape along the edges", "APPLY_TAPE", "trim and ceiling edges",
                      "EDGE", 0.6, "Follow the blue path — run tape along this edge and press it flat as you go.",
                      "Press the tape edge down firmly with a fingernail so paint can't bleed under it.",
                      "Burnish tape edges; overlap runs 1 inch.",
                      "Crisp tape lines are the difference between amateur and professional edges.",
                      "painters_tape", "Is the tape pressed flat along the whole edge?"),
                _step("cut_in", "Cut in along the taped edges", "CUT_IN_EDGE", "taped edge band",
                      "EDGE", 0.6, "Load the brush lightly and paint a steady band along the blue path.",
                      "Dip only a third of the bristles, tap off the extra, and use slow smooth strokes.",
                      "Maintain a wet edge; 2-3 inch band.",
                      "Cutting in first means the roller never has to touch the edges.",
                      "paint_brush", "Have you cut in along all the taped edges?"),
                _step("roll_wall", "Roll the wall in sections", "ROLL_SURFACE", "open wall surface",
                      "SURFACE", 0.6, "Roll a W pattern in this section, then fill it in without lifting the roller.",
                      "The W spreads paint evenly so you don't get thick stripes. Keep a light, even pressure.",
                      "Work in 3x3 ft sections, top to bottom, maintaining the wet edge.",
                      "The W pattern distributes paint evenly and avoids lap marks.",
                      "paint_roller", "Is this section fully covered?"),
                _step("inspect_coat", "Inspect the first coat", "INSPECT", "painted wall",
                      "SURFACE", 0.5, "Check for thin spots or drips while the paint is still wet.",
                      "Look across the wall at an angle — thin spots show up as shadows.",
                      "Raking light inspection; address drips before they set.",
                      "Fixing drips now takes seconds; fixing dried drips means sanding.",
                      None, "Does the coat look even, with no drips?"),
                _step("second_coat", "Apply the second coat", "ROLL_SURFACE", "entire wall",
                      "SURFACE", 0.6, "Once the first coat is dry to the touch, roll the second coat the same way.",
                      "Check the paint can for recoat time — usually 2 to 4 hours.",
                      "Same W pattern; remove tape at a 45° angle while slightly wet.",
                      "Two thin coats always outperform one thick coat.",
                      "paint_roller", "Second coat done and tape removed?"),
            ],
        },
        {
            "id": "toilet_replace_v1", "title": "Replace a Toilet", "category": "plumbing",
            "primary_mode": "SPATIAL_AR", "difficulty": "intermediate", "est_minutes": 90,
            "description": "Shutoff, supply line, mounting bolts, wax seal and leak check — guided end to end.",
            "tools": ["adjustable_wrench", "pliers", "scraper", "level", "flashlight"],
            "steps": [
                _step("identify_toilet", "Identify the toilet and workspace", "INSPECT", "toilet and shutoff valve",
                      "FIXED_OBJECT", 0.6, "Frame the toilet so I can highlight the shutoff valve and bolts.",
                      "The shutoff valve is the small oval handle on the wall behind or beside the toilet.",
                      "Confirm shutoff type: multi-turn vs quarter-turn.",
                      "Locating everything first means no surprises mid-job.",
                      None, "Can you see the shutoff valve highlighted?", "VISUAL", "FIRST_PERSON", "SPATIAL_AR"),
                _step("close_shutoff", "Close the water shutoff", "CLOSE_SHUTOFF", "shutoff valve",
                      "COMPONENT", 0.7, "Turn the shutoff valve clockwise until it stops, then flush and hold to drain the tank.",
                      "If the valve won't budge, don't force it hard — an old valve can snap. Tell me and we'll assess.",
                      "Close, flush, sponge remaining tank/bowl water.",
                      "An open supply line will flood the floor the moment you disconnect it.",
                      None, "Is the water off and the tank drained?",
                      safety_note="If the valve leaks or won't close, stop — the main shutoff may be needed."),
                _step("disconnect_supply", "Disconnect the supply line", "DISCONNECT_SUPPLY", "supply-line nut under the tank",
                      "COMPONENT", 0.7, "Twist the supply-line nut counterclockwise. Keep a towel underneath.",
                      "A little residual water is normal. Turn the nut, not the hose.",
                      "Counterclockwise at the tank inlet; inspect washer condition.",
                      "The supply line must be free before the toilet can lift out.",
                      "pliers", "Is the supply line disconnected?"),
                _step("remove_bolts", "Remove the mounting bolts", "LOOSEN_BOLT", "floor bolts at the toilet base",
                      "COMPONENT", 0.7, "Pop the bolt caps and turn each nut counterclockwise with your wrench.",
                      "If a bolt just spins, hold the top with pliers while you turn the nut.",
                      "Corroded bolts may need a hacksaw — cut flush, protect the bowl.",
                      "These two bolts are all that anchor the toilet to the flange.",
                      "adjustable_wrench", "Are both nuts off?"),
                _step("lift_toilet", "Lift the old toilet out", "LIFT_OBJECT", "toilet bowl",
                      "FIXED_OBJECT", 0.6, "Straddle the bowl, grip under the rim, and lift straight up with your legs.",
                      "Toilets weigh 60 to 100 pounds — get help if it feels heavy. Set it on old towels.",
                      "Rock gently to break the wax seal, lift vertically off the bolts.",
                      "Lifting straight up keeps the wax seal from smearing everywhere.",
                      None, "Is the old toilet out of the way?",
                      safety_note="Lift with your legs, not your back. Get a helper for heavy bowls."),
                _step("scrape_flange", "Scrape the old wax seal", "SCRAPE", "toilet flange",
                      "COMPONENT", 0.7, "Scrape every bit of old wax off the flange until you see clean metal or PVC.",
                      "Stuff a rag in the drain opening to block sewer gas — remove it before setting the new toilet.",
                      "Inspect flange for cracks; flange should sit on top of finished floor.",
                      "New wax won't seal over old wax — a clean flange prevents leaks.",
                      "scraper", "Is the flange clean, and is it free of cracks?"),
                _step("set_seal", "Set the new wax seal", "PLACE_OBJECT", "center of the flange",
                      "COMPONENT", 0.7, "Set the new seal centered on the flange, and drop the new bolts into the slots.",
                      "Don't press the wax down — the toilet's weight does that.",
                      "Position bolts at 6 and 12 relative to the wall; verify spacing.",
                      "A centered seal is what keeps sewage inside the pipe.",
                      None, "Seal centered with both bolts upright?"),
                _step("set_toilet", "Set and align the new toilet", "ALIGN_OBJECT", "bolt holes in the toilet base",
                      "FIXED_OBJECT", 0.6, "Lower the toilet so both bolts pass through the base holes, then press down with your body weight.",
                      "Line up the holes before lowering — you only get one clean drop onto the wax.",
                      "Do not lift once seated; compress evenly, no rocking.",
                      "Re-lifting a seated toilet ruins the wax seal.",
                      None, "Is the toilet seated flat with both bolts through?"),
                _step("tighten_bolts", "Tighten the mounting bolts", "TIGHTEN_BOLT", "base bolts",
                      "COMPONENT", 0.7, "Tighten each bolt a little at a time, alternating sides. Snug, not cranked.",
                      "Overtightening cracks porcelain — stop as soon as the bowl doesn't rock.",
                      "Alternate quarter-turns; check level across the rim.",
                      "Even, moderate torque keeps the bowl sealed without cracking it.",
                      "adjustable_wrench", "Bolts snug, no rocking?",
                      safety_note="Porcelain cracks under over-torque. Snug only."),
                _step("reconnect_supply", "Reconnect the supply line", "RECONNECT_SUPPLY", "tank inlet",
                      "COMPONENT", 0.7, "Reconnect the supply line hand-tight plus a quarter turn.",
                      "Hand-tight plus a quarter turn is really all it needs — the washer does the sealing.",
                      "Verify washer seated; no tape needed on compression fittings.",
                      "A gentle connection seals better than a cranked one.",
                      None, "Supply line reconnected?"),
                _step("leak_check", "Turn on water and check for leaks", "CHECK_FOR_LEAK", "base and supply connections",
                      "COMPONENT", 0.7, "Open the shutoff, let the tank fill, then flush twice and check around the base and supply line.",
                      "Run a dry tissue around every joint — it shows even a tiny weep instantly.",
                      "Two full flush cycles; inspect flange perimeter and both supply ends.",
                      "A slow leak found now saves a rotted floor later.",
                      "flashlight", "Two flushes done — completely dry everywhere?"),
            ],
        },
        {
            "id": "balloon_dog_v1", "title": "Make a Balloon Dog", "category": "crafts",
            "primary_mode": "FINE_MOTOR", "difficulty": "beginner", "est_minutes": 15,
            "description": "Close-up hand guidance: inflate, pinch, twist and lock your way to a balloon dog.",
            "tools": ["260_balloon", "hand_pump"],
            "steps": [
                _step("inflate", "Inflate the balloon to the marked length", "INFLATE", "260 balloon",
                      "DEFORMABLE_OBJECT", 0.6, "Inflate the balloon, leaving about a four-finger tail uninflated at the end.",
                      "Use a pump — these balloons are very hard to inflate by mouth. Stop when the tail is about 3 inches.",
                      "~3 inch tail; burp a little air out to soften it for twisting.",
                      "The uninflated tail gives the air somewhere to go with every twist — no tail, no dog.",
                      "hand_pump", "Do you have an inflated balloon with a soft 3-inch tail?"),
                _step("tie_nozzle", "Tie off the nozzle", "TIE", "balloon nozzle",
                      "DEFORMABLE_OBJECT", 0.7, "Stretch the nozzle, wrap it around two fingers, and pull it through to knot it.",
                      "Stretch the nozzle long first — it makes the knot much easier.",
                      "Standard overhand around two fingers.",
                      "The knot keeps your work from deflating mid-build.",
                      None, "Is the balloon knotted?"),
                _step("make_nose", "Make the first twist — the nose", "TWIST", "balloon segment near the knot",
                      "DEFORMABLE_OBJECT", 0.7, "Pinch the balloon about three fingers from the knot, then twist this section three full turns.",
                      "Always twist in the same direction for every twist in the whole dog. Don't let go!",
                      "~2 inch segment, 3 rotations, consistent direction.",
                      "This first bubble becomes the dog's nose.",
                      None, "Do you have one small bubble held at the knot end?"),
                _step("make_ears", "Twist two ear bubbles", "TWIST", "next two balloon segments",
                      "DEFORMABLE_OBJECT", 0.7, "While holding the nose, twist two more bubbles the same size, one after the other.",
                      "Keep holding every twist — nothing locks until we fold them together.",
                      "Two ~2 inch bubbles; maintain grip across all three.",
                      "These two bubbles become the ears once locked.",
                      None, "Are you holding three small bubbles in a row?"),
                _step("lock_head", "Lock the head with a fold twist", "TWIST_AND_LOCK", "the two ear bubbles",
                      "DEFORMABLE_OBJECT", 0.7, "Fold the two ear bubbles side by side, then twist them together around their shared joint.",
                      "Do not let go after twisting or the balloon may untwist. This lock holds the whole head.",
                      "Lock twist at the base joint; head is now self-holding.",
                      "The lock twist is the core move of all balloon animals — everything else repeats it.",
                      None, "Do you now have a nose with two locked ears — and it holds by itself?"),
                _step("make_neck", "Twist the neck bubble", "TWIST", "segment behind the head",
                      "DEFORMABLE_OBJECT", 0.7, "Twist one slightly longer bubble behind the head for the neck.",
                      "About four fingers long. Same twist direction as always.",
                      "~3 inch bubble.",
                      "The neck sets the dog's proportions.",
                      None, "Neck bubble twisted and held?"),
                _step("front_legs", "Create the front legs", "TWIST_AND_LOCK", "two segments behind the neck",
                      "DEFORMABLE_OBJECT", 0.7, "Twist two equal leg bubbles, fold them together, and lock them at the neck joint.",
                      "Same fold-and-lock as the ears, just with longer bubbles.",
                      "Two ~3 inch bubbles, lock at neck base.",
                      "Locked pairs make legs that stand on their own.",
                      None, "Front legs locked under the head?"),
                _step("make_body", "Twist the body bubble", "TWIST", "segment behind the front legs",
                      "DEFORMABLE_OBJECT", 0.7, "Twist one longer bubble for the body.",
                      "Slightly longer than the neck — this is the biggest bubble.",
                      "~4 inch bubble.",
                      "The body separates front and back legs.",
                      None, "Body bubble done?"),
                _step("back_legs", "Create the back legs", "TWIST_AND_LOCK", "two segments behind the body",
                      "DEFORMABLE_OBJECT", 0.7, "Twist two more equal bubbles and lock them together behind the body.",
                      "Whatever is left after the lock becomes the tail — that's perfect.",
                      "Match front leg length; lock at body base.",
                      "Locking the back legs finishes the frame — the rest is shaping.",
                      None, "Back legs locked, with a little tail left over?"),
                _step("shape_dog", "Shape and inspect your balloon dog", "SHAPE", "completed balloon dog",
                      "DEFORMABLE_OBJECT", 0.7, "Gently squeeze and straighten the bubbles so the dog stands. You made a balloon dog!",
                      "Adjust gently — sharp squeezes near twists can pop it.",
                      "Even out bubble pressure; pose head and tail.",
                      "A little shaping turns locked bubbles into a dog.",
                      None, "Does your dog stand up on all four legs?"),
            ],
        },
    ]


async def seed_guidance():
    for p in _seed_procedures():
        existing = await _db.guide_procedures.find_one({"id": p["id"]}, {"_id": 0, "id": 1})
        if not existing:
            doc = dict(p)
            doc["step_count"] = len(p["steps"])
            doc["created_at"] = _now()
            await _db.guide_procedures.insert_one(doc)


# ---------------------------------------------------------------- skill-level voice adaptation
def _adapt_step(step: dict, skill: str, prefs: Optional[dict] = None) -> dict:
    s = dict(step)
    v = step.get("voice") or {}
    if skill == "beginner":
        spoken = v.get("instruction", "")
        if v.get("beginnerExplanation"):
            spoken = f"{spoken} {v['beginnerExplanation']}"
    elif skill == "advanced":
        spoken = v.get("advancedNote") or v.get("instruction", "")
    else:
        spoken = v.get("instruction", "")
    s["spoken"] = spoken.strip()
    s["controls"] = STEP_CONTROLS
    if prefs:
        vis = dict(s.get("visual") or {})
        vis["colorScheme"] = prefs.get("color_scheme", "default")
        vis["textAlternatives"] = bool(prefs.get("text_alternatives"))
        if prefs.get("default_speed") in SPEEDS:
            vis["speed"] = prefs["default_speed"]
        s["visual"] = vis
    return s


async def _prefs(user_id: str) -> dict:
    p = await _db.guide_prefs.find_one({"user_id": user_id}, {"_id": 0})
    if not p:
        skill = None
        try:
            from onboarding_engine import default_skill_level
            skill = await default_skill_level(user_id)
        except Exception:
            pass
        p = {"user_id": user_id, "skill_level": skill or "beginner", "color_scheme": "default",
             "text_alternatives": False, "default_speed": "NORMAL", "updated_at": _now()}
        await _db.guide_prefs.insert_one(dict(p)); p.pop("_id", None)
    return p


def _safety_gate(text: str, skill: Optional[str]) -> Optional[dict]:
    """Doc 47 §9 — Safety Engine runs before every action. Returns a STOP payload or None."""
    try:
        from safety_engine import evaluate_action
        res = evaluate_action(text, skill)
    except Exception:
        return None
    if res.get("verdict") in ("block_action", "escalate_to_professional"):
        return {"state": "STOP_FOR_SAFETY",
                "message": "I'm not confident this is safe to continue without verification. "
                           "Let's inspect this further or bring in a qualified professional.",
                "reasons": res.get("reasons", []), "safety": res}
    return None


def _welcome_back(session: dict, proc: dict) -> Optional[str]:
    done = session.get("completed_steps") or []
    if not done or session.get("status") == "completed":
        return None
    steps = proc.get("steps") or []
    by_id = {s["stepId"]: s for s in steps}
    last_done = by_id.get(done[-1])
    idx = session.get("current_step_index", 0)
    nxt = steps[idx] if idx < len(steps) else None
    msg = f"Welcome back. We completed \"{last_done['task']}\"." if last_done else "Welcome back."
    if nxt:
        msg += f" Next, we are working on: {nxt['task'].lower()}."
    return msg


# ================================================================ models
class StartReq(BaseModel):
    procedure_id: str
    project_id: Optional[str] = None
    room_id: Optional[str] = None
    device: dict = {}


class StepEventReq(BaseModel):
    event: str  # show_again | slow_down | another_angle | why | what_tool | im_stuck | target_detected | target_lost
    confidence: Optional[float] = None


class VerifyReq(BaseModel):
    method: str = "user_confirmation"  # user_confirmation | visual
    confirmed: bool = False
    confidence: Optional[float] = None
    note: Optional[str] = None


class PrefsReq(BaseModel):
    skill_level: Optional[str] = None
    color_scheme: Optional[str] = None
    text_alternatives: Optional[bool] = None
    default_speed: Optional[str] = None


# ================================================================ router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/guide", dependencies=[Depends(get_current_user)])

    async def _sess(sid, uid):
        s = await _db.guide_sessions.find_one({"id": sid, "user_id": uid}, {"_id": 0})
        if not s:
            raise HTTPException(status_code=404, detail="Guidance session not found.")
        return s

    async def _proc(pid):
        p = await _db.guide_procedures.find_one({"id": pid}, {"_id": 0})
        if not p:
            raise HTTPException(status_code=404, detail="Procedure not found.")
        return p

    def _find_step(proc, step_id):
        st = next((s for s in proc["steps"] if s["stepId"] == step_id), None)
        if not st:
            raise HTTPException(status_code=404, detail="Step not found.")
        return st

    @r.get("/meta")
    async def meta(user: dict = Depends(get_current_user)):
        return {"modes": GUIDANCE_MODES, "verification_states": VERIFICATION_STATES,
                "controls": STEP_CONTROLS, "visual_vocabulary": VISUAL_VOCABULARY,
                "fine_motor_primitives": [{"id": k, **v} for k, v in FINE_MOTOR_PRIMITIVES.items()],
                "camera_views": CAMERA_VIEWS, "speeds": SPEEDS}

    @r.get("/procedures")
    async def procedures(user: dict = Depends(get_current_user)):
        rows = await _db.guide_procedures.find({}, {"_id": 0, "steps": 0}).to_list(100)
        open_sessions = await _db.guide_sessions.find(
            {"user_id": user["id"], "status": {"$in": ["active", "paused"]}},
            {"_id": 0, "id": 1, "procedure_id": 1, "current_step_index": 1, "last_active_at": 1}).to_list(20)
        return {"procedures": rows, "open_sessions": open_sessions}

    @r.get("/procedures/{pid}")
    async def procedure(pid: str, user: dict = Depends(get_current_user)):
        p = await _proc(pid)
        prefs = await _prefs(user["id"])
        p["steps"] = [_adapt_step(s, prefs["skill_level"], prefs) for s in p["steps"]]
        return {"procedure": p, "skill_level": prefs["skill_level"]}

    @r.post("/sessions")
    async def start(req: StartReq, user: dict = Depends(get_current_user)):
        proc = await _proc(req.procedure_id)
        prefs = await _prefs(user["id"])
        # Doc 47 §9 — safety gate before the procedure begins
        stop = _safety_gate(f"{proc['title']} {proc.get('description','')}", prefs["skill_level"])
        if stop:
            await _cap(user, "guidance.session.started", {"procedure_id": proc["id"], "mode": proc["primary_mode"], "blocked": True})
            raise HTTPException(status_code=409, detail=stop)
        # resume an open session for this procedure instead of duplicating
        existing = await _db.guide_sessions.find_one(
            {"user_id": user["id"], "procedure_id": proc["id"], "status": {"$in": ["active", "paused"]}}, {"_id": 0})
        if existing:
            await _db.guide_sessions.update_one({"id": existing["id"]}, {"$set": {"status": "active", "last_active_at": _now()}})
            existing["status"] = "active"
            return {"session": existing, "resumed": True,
                    "welcome_back": _welcome_back(existing, proc),
                    "procedure": {**proc, "steps": [_adapt_step(s, prefs["skill_level"], prefs) for s in proc["steps"]]}}
        session = {"id": _nid(), "user_id": user["id"], "procedure_id": proc["id"],
                   "project_id": req.project_id, "room_id": req.room_id,
                   "primary_mode": proc["primary_mode"], "skill_level": prefs["skill_level"],
                   "status": "active", "current_step_index": 0, "completed_steps": [],
                   "verifications": [], "safety_warnings": [], "measurements": [],
                   "device": {k: req.device.get(k) for k in ("platform", "supports_ar")},
                   "started_at": _now(), "last_active_at": _now(), "completed_at": None}
        await _db.guide_sessions.insert_one(dict(session)); session.pop("_id", None)
        await _cap(user, "guidance.session.started", {"procedure_id": proc["id"], "mode": proc["primary_mode"]})
        await _cap(user, "procedure.pack.selected", {"procedure_id": proc["id"], "mode": proc["primary_mode"]})
        await _cap(user, "guidance.mode.selected", {"mode": proc["primary_mode"], "procedure_id": proc["id"]})
        await _cap(user, "procedure.step.presented", {"procedure_id": proc["id"], "step_index": 0})
        return {"session": session, "resumed": False, "welcome_back": None,
                "procedure": {**proc, "steps": [_adapt_step(s, prefs["skill_level"], prefs) for s in proc["steps"]]}}

    @r.get("/sessions/{sid}")
    async def get_session(sid: str, user: dict = Depends(get_current_user)):
        s = await _sess(sid, user["id"])
        proc = await _proc(s["procedure_id"])
        prefs = await _prefs(user["id"])
        return {"session": s, "welcome_back": _welcome_back(s, proc),
                "procedure": {**proc, "steps": [_adapt_step(st, prefs["skill_level"], prefs) for st in proc["steps"]]}}

    @r.post("/sessions/{sid}/steps/{step_id}/event")
    async def step_event(sid: str, step_id: str, req: StepEventReq, user: dict = Depends(get_current_user)):
        s = await _sess(sid, user["id"])
        proc = await _proc(s["procedure_id"])
        st = _find_step(proc, step_id)
        ev = req.event
        await _db.guide_step_attempts.insert_one({
            "id": _nid(), "session_id": sid, "step_id": step_id, "event": ev,
            "confidence": req.confidence, "at": _now()})
        await _db.guide_sessions.update_one({"id": sid}, {"$set": {"last_active_at": _now()}})
        payload: dict = {"ok": True, "event": ev}
        if ev == "show_again":
            await _cap(user, "procedure.step.replayed", {"procedure_id": proc["id"], "step_id": step_id})
            payload["visual"] = st["visual"]
            payload["message"] = "Watch once more — take your time."
        elif ev == "slow_down":
            await _cap(user, "procedure.step.slowed", {"procedure_id": proc["id"], "step_id": step_id})
            vis = dict(st["visual"]); vis["speed"] = "SLOWEST" if st["visual"].get("speed") == "SLOW" else "SLOW"
            payload["visual"] = vis
            payload["message"] = "Here it is in slow motion."
        elif ev == "another_angle":
            vis = dict(st["visual"])
            vis["cameraView"] = "OVERHEAD" if vis.get("cameraView") == "FIRST_PERSON" else "FIRST_PERSON"
            payload["visual"] = vis
            payload["message"] = f"Switching to the {vis['cameraView'].replace('_', '-').lower()} view."
        elif ev == "why":
            payload["message"] = st.get("why") or "This step sets up the next one — skipping it usually causes rework."
        elif ev == "what_tool":
            payload["tool"] = st.get("tool")
            payload["message"] = (f"You'll need: {str(st['tool']).replace('_', ' ')}." if st.get("tool")
                                  else "No tool needed — just your hands for this one.")
        elif ev == "im_stuck":
            await _cap(user, "user.requested.help", {"procedure_id": proc["id"], "step_id": step_id})
            vis = dict(st["visual"]); vis["speed"] = "SLOWEST"
            payload["visual"] = vis
            payload["message"] = ("No problem — let's slow it down. " + (st["voice"].get("beginnerExplanation") or st["voice"].get("instruction", "")))
            payload["options"] = ["show_again", "another_angle", "ask_homie", "bring_in_pro"]
        elif ev == "target_detected":
            conf = max(0.0, min(1.0, float(req.confidence or 0)))
            need = st["target"].get("confidenceRequired", 0.6)
            if conf >= max(need, 0.85):
                payload.update({"target_state": "acquired", "message": "Target locked. Follow the guide."})
                await _cap(user, "target.confirmed", {"procedure_id": proc["id"], "step_id": step_id})
            elif conf >= need:
                payload.update({"target_state": "candidate", "message": "I believe this is the right spot. Tap it to confirm."})
                await _cap(user, "target.detected", {"procedure_id": proc["id"], "step_id": step_id})
            else:
                payload.update({"target_state": "lost", "message": "I can't see the target clearly. Move closer or improve the lighting."})
                await _cap(user, "target.lost", {"procedure_id": proc["id"], "step_id": step_id})
        elif ev == "target_lost":
            await _cap(user, "target.lost", {"procedure_id": proc["id"], "step_id": step_id})
            payload["message"] = "Tracking lost — reframe the area and we'll pick right back up."
        else:
            raise HTTPException(status_code=400, detail="Unknown step event.")
        return payload

    @r.post("/sessions/{sid}/steps/{step_id}/verify")
    async def verify_step(sid: str, step_id: str, req: VerifyReq, user: dict = Depends(get_current_user)):
        s = await _sess(sid, user["id"])
        proc = await _proc(s["procedure_id"])
        steps = proc["steps"]
        st = _find_step(proc, step_id)
        # Doc 47 §8 — confidence-aware verification; never falsely claim completion.
        conf = max(0.0, min(1.0, float(req.confidence or 0)))
        if req.method == "visual":
            if conf >= 0.85:
                state = "VERIFIED"
            elif conf >= st["target"].get("confidenceRequired", 0.6):
                state = "LIKELY_COMPLETE"
            else:
                state = "CANNOT_VERIFY"
        else:
            state = "USER_CONFIRMED" if req.confirmed else "NEEDS_REVIEW"
        result = {"step_id": step_id, "state": state, "method": req.method, "confidence": conf,
                  "note": (req.note or "").strip()[:500] or None, "at": _now()}
        advanced_ok = state in ("VERIFIED", "LIKELY_COMPLETE", "USER_CONFIRMED")
        payload: dict = {"verification": result, "advanced": False, "completed": False}
        if state == "CANNOT_VERIFY":
            payload["message"] = ("I can't reliably verify this from the camera. "
                                  + (st["verification"].get("question") or "Did you complete this step?"))
            payload["ask_confirmation"] = True
            await _cap(user, "verification.needs_review", {"procedure_id": proc["id"], "step_id": step_id, "state": state})
        elif state == "NEEDS_REVIEW":
            payload["message"] = "No rush — let's look at this step again before moving on."
            payload["options"] = ["show_again", "slow_down", "im_stuck", "bring_in_pro"]
            await _cap(user, "verification.needs_review", {"procedure_id": proc["id"], "step_id": step_id, "state": state})
        if advanced_ok:
            idx = next((i for i, x in enumerate(steps) if x["stepId"] == step_id), s["current_step_index"])
            next_idx = idx + 1
            updates = {"last_active_at": _now(), "current_step_index": min(next_idx, len(steps))}
            completed_steps = list(s.get("completed_steps") or [])
            if step_id not in completed_steps:
                completed_steps.append(step_id)
            updates["completed_steps"] = completed_steps
            await _cap(user, "verification.passed", {"procedure_id": proc["id"], "step_id": step_id, "state": state})
            await _cap(user, "user.marked.complete", {"procedure_id": proc["id"], "step_id": step_id})
            if next_idx >= len(steps):
                updates["status"] = "completed"; updates["completed_at"] = _now()
                payload["completed"] = True
                payload["message"] = f"That's it — {proc['title'].lower()} complete. Great work."
                await _cap(user, "procedure.completed", {"procedure_id": proc["id"], "mode": proc["primary_mode"]})
            else:
                # Doc 47 §9 — safety gate BEFORE presenting the next action
                nxt = steps[next_idx]
                stop = _safety_gate(f"{nxt['task']} {nxt['voice'].get('instruction','')}", s.get("skill_level"))
                if stop:
                    updates["status"] = "escalated"
                    updates["safety_warnings"] = (s.get("safety_warnings") or []) + [
                        {"step_id": nxt["stepId"], "reasons": stop["reasons"], "at": _now()}]
                    payload["stop_for_safety"] = stop
                else:
                    payload["advanced"] = True
                    payload["next_step_id"] = nxt["stepId"]
                    payload.setdefault("message", "Nice. On to the next step.")
                    await _cap(user, "procedure.step.presented", {"procedure_id": proc["id"], "step_index": next_idx})
            await _db.guide_sessions.update_one({"id": sid}, {"$set": updates})
        await _db.guide_step_attempts.insert_one({"id": _nid(), "session_id": sid, "step_id": step_id,
                                                  "event": "verify", "state": state, "confidence": conf, "at": _now()})
        return payload

    @r.post("/sessions/{sid}/pause")
    async def pause(sid: str, user: dict = Depends(get_current_user)):
        await _sess(sid, user["id"])
        await _db.guide_sessions.update_one({"id": sid}, {"$set": {"status": "paused", "last_active_at": _now()}})
        return {"status": "paused", "message": "Saved. Everything will be right where you left it."}

    @r.post("/sessions/{sid}/pro")
    async def bring_in_pro(sid: str, user: dict = Depends(get_current_user)):
        s = await _sess(sid, user["id"])
        await _db.guide_sessions.update_one({"id": sid}, {"$set": {"status": "escalated", "last_active_at": _now()}})
        await _cap(user, "user.brought.in.pro", {"procedure_id": s["procedure_id"]})
        return {"status": "escalated",
                "message": "Good call. I've saved your progress and notes so a professional can pick this up cleanly."}

    @r.get("/preferences")
    async def get_prefs(user: dict = Depends(get_current_user)):
        return {"preferences": await _prefs(user["id"])}

    @r.put("/preferences")
    async def put_prefs(req: PrefsReq, user: dict = Depends(get_current_user)):
        await _prefs(user["id"])
        updates = {"updated_at": _now()}
        if req.skill_level in SKILL_LEVELS:
            updates["skill_level"] = req.skill_level
        if req.color_scheme in ("default", "high_contrast", "colorblind"):
            updates["color_scheme"] = req.color_scheme
        if req.text_alternatives is not None:
            updates["text_alternatives"] = bool(req.text_alternatives)
        if req.default_speed in SPEEDS:
            updates["default_speed"] = req.default_speed
        await _db.guide_prefs.update_one({"user_id": user["id"]}, {"$set": updates})
        return {"preferences": await _prefs(user["id"])}

    return r
