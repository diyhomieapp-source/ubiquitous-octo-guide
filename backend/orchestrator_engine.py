"""
DIYhomie — Continuous Project Intelligence Orchestrator (Foundation Layer).

An ADDITIVE coordination layer that makes DIYhomie behave as one intelligent system.
It maintains a server-authoritative, persistent project_state that reacts to
conversations, measurements, decisions, procurement, safety/code findings and task
completion. It exposes:
  - Intent router (natural language -> structured intent)
  - Persistent project state + lifecycle phases
  - Tasks with dependencies (availability recalculated on completion)
  - Decision states (idea/scenario/selected/committed/rejected/superseded)
  - Ripple engine (a committed change recalculates quantities/cost/clearance)
  - Project Health engine (green/yellow/orange/red, surfaced in Homie's voice)
  - Next Best Action engine (single primary action by strict priority)
  - Append-only event log
  - Workspace recommendation
  - Pause / resume / blocked / safety-hold
  - Completion audit + Project Passport

Authorization: every record is user-scoped (RLS-equivalent enforced at the API).
Specialized engines submit STRUCTURED recommendations; they never mutate state directly.

Namespace: /api/hi/orchestrator/*
Collections: orch_projects, orch_tasks, orch_decisions, orch_events, orch_risks, orch_requirements
"""
import re
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

PHASES = ["DISCOVERY", "UNDERSTAND_EXISTING_CONDITIONS", "PLAN", "DESIGN", "VALIDATE", "APPROVE",
          "PROCURE", "PREPARE", "EXECUTE", "VERIFY", "COMPLETE", "DOCUMENT", "MAINTAIN"]
EXTRA_STATES = ["ACTIVE", "PAUSED", "BLOCKED", "SAFETY_HOLD", "PROFESSIONAL_REVIEW_REQUIRED", "ARCHIVED", "COMPLETED"]
DECISION_STATES = ["idea", "scenario", "selected", "committed", "rejected", "superseded"]
TASK_STATES = ["pending", "available", "in_progress", "blocked", "complete"]
PROVENANCE = ["USER_REPORTED", "AR_MEASURED", "AI_INFERRED", "DOCUMENT_EXTRACTED", "PRODUCT_VERIFIED",
              "PROFESSIONAL_VERIFIED", "OFFICIAL_SOURCE", "UNKNOWN"]

WORKSPACE_FOR = {
    "safety": "Safety", "code": "Code / Permit", "measure": "Measurements", "scan": "AR Scan",
    "procure": "Shopping / Procurement", "execute": "Execution Coach", "verify": "Inspection",
    "design": "Visualization", "document": "Documents", "plan": "Project Overview", "chat": "Conversation",
}

# Deterministic intent router knowledge.
_PROJECT_TYPES = [
    ("garage_upgrade", ["garage"], ["floor_coating", "storage", "organization"]),
    ("bathroom_remodel", ["bathroom", "toilet", "vanity", "shower", "faucet"], ["fixture_replace", "tiling", "plumbing"]),
    ("kitchen_remodel", ["kitchen", "cabinet", "countertop", "backsplash"], ["cabinetry", "countertops", "appliances"]),
    ("deck_project", ["deck", "patio", "porch"], ["build", "repair", "stain"]),
    ("painting", ["paint", "repaint", "primer", "wall color"], ["surface_prep", "paint"]),
    ("flooring", ["floor", "epoxy", "tile", "laminate", "hardwood", "vinyl"], ["floor_install", "floor_coating"]),
    ("electrical", ["outlet", "light fixture", "wiring", "switch", "breaker"], ["electrical"]),
    ("plumbing", ["faucet", "sink", "pipe", "drain", "water heater"], ["plumbing"]),
    ("storage", ["shelf", "shelving", "closet", "built-in", "cabinet"], ["storage"]),
    ("outdoor", ["fence", "landscap", "yard", "gutter", "roof"], ["exterior"]),
]
_GOAL_KEYWORDS = {
    "floor_coating": ["epoxy", "coat", "coating", "seal"], "storage": ["storage", "shelf", "shelving", "organize", "built-in", "cabinet"],
    "tiling": ["tile", "backsplash"], "fixture_replace": ["replace", "faucet", "toilet", "vanity", "fixture"],
    "surface_prep": ["clean", "sand", "prep", "crack", "patch"], "stain": ["stain", "seal"],
    "electrical": ["outlet", "light", "wiring", "switch"], "plumbing": ["pipe", "drain", "water", "leak"],
}
_UNKNOWN_HINTS = {
    "garage_upgrade": ["garage_dimensions", "concrete_condition", "moisture_level", "budget"],
    "bathroom_remodel": ["rough_in_measurement", "existing_fixtures", "budget"],
    "kitchen_remodel": ["kitchen_dimensions", "layout", "budget"],
    "deck_project": ["deck_dimensions", "structural_condition", "budget"],
    "flooring": ["room_dimensions", "subfloor_condition", "budget"],
    "painting": ["surface_area", "surface_condition"],
}
_HIGH_RISK_TYPES = {"electrical", "plumbing"}
_HIGH_RISK_WORDS = ["load-bearing", "load bearing", "gas", "electrical panel", "breaker", "structural", "roof"]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


async def _emit(project_id, user_id, etype, payload=None):
    """Append-only project event."""
    try:
        await _db.orch_events.insert_one({"id": _nid(), "project_id": project_id, "user_id": user_id,
                                          "type": etype, "payload": payload or {}, "at": _now()})
    except Exception:
        pass


def route_intent(text: str) -> dict:
    t = (text or "").lower()
    ptype, base_goals = "general_project", []
    for name, kws, goals in _PROJECT_TYPES:
        if any(k in t for k in kws):
            ptype, base_goals = name, goals
            break
    goals = []
    for g, kws in _GOAL_KEYWORDS.items():
        if any(k in t for k in kws):
            goals.append(g)
    if not goals:
        goals = base_goals[:1] if base_goals else ["general"]
    goals = list(dict.fromkeys(goals))
    scope = []
    for room in ["garage", "bathroom", "kitchen", "bedroom", "living room", "basement", "deck", "yard", "closet"]:
        if room in t:
            scope.append(room.replace(" ", "_"))
    unknowns = _UNKNOWN_HINTS.get(ptype, ["dimensions", "budget"])
    engines = ["measurement", "material", "design", "schedule"]
    if any(w in t for w in _HIGH_RISK_WORDS) or ptype in _HIGH_RISK_TYPES:
        engines = ["safety", "code"] + engines
    return {"projectType": ptype, "goals": goals, "scope": scope, "constraints": [],
            "unknowns": unknowns, "recommendedEngines": engines}


def _complexity(intent: dict) -> str:
    if any(e in intent["recommendedEngines"] for e in ("safety", "code")):
        return "high"
    if len(intent["goals"]) > 1:
        return "moderate"
    return "basic"


def _seed_tasks(intent: dict) -> list:
    """Initial tasks derived from unknowns + a minimal execution path."""
    tasks = []
    order = 0

    def add(title, phase, deps=None, is_inspection=False, workspace="plan"):
        nonlocal order
        order += 1
        tasks.append({"title": title, "phase": phase, "depends_on_idx": deps or [], "order": order,
                      "is_inspection": is_inspection, "workspace": workspace})
    # Discovery / understand existing conditions from unknowns.
    for u in intent["unknowns"]:
        if "dimension" in u or "measurement" in u or "area" in u or "rough_in" in u:
            add(f"Measure {u.replace('_', ' ')}", "UNDERSTAND_EXISTING_CONDITIONS", workspace="measure")
        elif "condition" in u or "moisture" in u:
            add(f"Assess {u.replace('_', ' ')}", "UNDERSTAND_EXISTING_CONDITIONS", workspace="scan")
        elif "budget" in u:
            add("Set your budget range", "PLAN", workspace="plan")
        else:
            add(f"Confirm {u.replace('_', ' ')}", "DISCOVERY", workspace="chat")
    # Minimal execution path.
    plan_idx = order  # last planning-ish task index (1-based order == list position); we track by order
    add("Choose materials & products", "DESIGN", workspace="design")
    add("Confirm safety & code requirements", "VALIDATE", workspace="code")
    add("Order or gather materials", "PROCURE", workspace="procure")
    add("Prepare the work area", "PREPARE", workspace="execute")
    add("Complete the main work", "EXECUTE", workspace="execute")
    add("Verify the result", "VERIFY", is_inspection=True, workspace="verify")
    return tasks


# ---------------- Health & Next Best Action ----------------

async def _load_bundle(project_id, user_id):
    proj = await _db.orch_projects.find_one({"id": project_id, "user_id": user_id}, {"_id": 0})
    if not proj:
        return None
    tasks = await _db.orch_tasks.find({"project_id": project_id}, {"_id": 0}).sort("order", 1).to_list(500)
    risks = await _db.orch_risks.find({"project_id": project_id, "status": "open"}, {"_id": 0}).to_list(200)
    reqs = await _db.orch_requirements.find({"project_id": project_id}, {"_id": 0}).to_list(300)
    return {"project": proj, "tasks": tasks, "risks": risks, "requirements": reqs}


def _health(bundle) -> dict:
    proj, tasks, risks, reqs = bundle["project"], bundle["tasks"], bundle["risks"], bundle["requirements"]
    status = proj["status"]
    safety = [r for r in risks if r["kind"] == "safety"]
    code = [r for r in risks if r["kind"] == "code"]
    other = [r for r in risks if r["kind"] in ("dependency", "compatibility")]
    unresolved_unknowns = [t for t in tasks if t["status"] in ("pending", "available") and t["phase"] in ("DISCOVERY", "UNDERSTAND_EXISTING_CONDITIONS")]
    blocked = [t for t in tasks if t["status"] == "blocked"]

    if status in ("SAFETY_HOLD",) or safety:
        color = "red"
        issue = safety[0]["description"] if safety else "Safety review needed before continuing."
        headline = f"Before we continue, {issue.lower()}"
        affected = safety[0]["affected_tasks"] if safety else []
        rec = "Resolve the safety concern or get a professional to verify."
    elif status == "PROFESSIONAL_REVIEW_REQUIRED" or code:
        color = "orange"
        issue = code[0]["description"] if code else "A code or permit check is required."
        headline = issue
        affected = code[0]["affected_tasks"] if code else []
        rec = "Confirm local code/permit requirements before this task."
    elif other or blocked:
        color = "orange"
        issue = other[0]["description"] if other else "A dependency is blocking part of this project."
        headline = issue
        affected = (other[0]["affected_tasks"] if other else [t["id"] for t in blocked])
        rec = "Resolve the blocker to unblock the affected tasks."
    elif unresolved_unknowns:
        color = "yellow"
        issue = f"Missing info: {unresolved_unknowns[0]['title'].lower()}."
        headline = f"I need one thing first: {unresolved_unknowns[0]['title'].lower()}."
        affected = [t["id"] for t in unresolved_unknowns]
        rec = "Provide the missing information so I can plan accurately."
    else:
        color = "green"
        issue = None
        headline = "You're good to keep going."
        affected = []
        rec = "Continue with the next step."
    # Can the user do other safe work?
    can_continue_other = any(t["status"] == "available" and t["id"] not in affected for t in tasks)
    return {"status": color, "headline": headline, "blocking_issue": issue,
            "severity": {"red": "critical", "orange": "high", "yellow": "medium", "green": "none"}[color],
            "affected_tasks": affected, "recommended_resolution": rec, "can_continue_other_task": can_continue_other}


def _next_best_action(bundle) -> dict:
    proj, tasks, risks, reqs = bundle["project"], bundle["tasks"], bundle["risks"], bundle["requirements"]
    safety = [r for r in risks if r["kind"] == "safety"]
    code = [r for r in risks if r["kind"] == "code"]

    def mk(action, reason, why, workspace, task_id=None, requires_confirmation=False):
        return {"action": action, "reason": reason, "why": why, "workspace": workspace,
                "task_id": task_id, "requires_confirmation": requires_confirmation,
                "can_continue_other_task": any(t["status"] == "available" for t in tasks)}

    # 1. Safety hold
    if proj["status"] == "SAFETY_HOLD" or safety:
        r = safety[0] if safety else {"description": "Safety review required."}
        return mk(f"Resolve safety hold: {r['description']}", "immediate_safety_hold",
                  "Safety comes first — this blocks affected work until verified.", WORKSPACE_FOR["safety"])
    # 2. Code / permit / professional review
    if proj["status"] == "PROFESSIONAL_REVIEW_REQUIRED" or code:
        r = code[0] if code else {"description": "Code/permit check required."}
        return mk(f"Confirm requirement: {r['description']}", "code_or_professional_review",
                  "This may need a permit or professional sign-off before proceeding.", WORKSPACE_FOR["code"])
    # 3. Missing prerequisite information (discovery/conditions tasks still open)
    for t in tasks:
        if t["status"] in ("available", "pending") and t["phase"] in ("DISCOVERY", "UNDERSTAND_EXISTING_CONDITIONS", "PLAN"):
            return mk(t["title"], "missing_prerequisite_information",
                      "I need this before I can plan the rest accurately.", WORKSPACE_FOR.get(t.get("workspace"), "Project Overview"), t["id"])
    # 4. Blocked dependency
    blocked = [t for t in tasks if t["status"] == "blocked"]
    if blocked:
        return mk(f"Unblock: {blocked[0]['title']}", "blocked_dependency",
                  "This task is waiting on something else to finish.", WORKSPACE_FOR.get(blocked[0].get("workspace"), "Project Overview"), blocked[0]["id"])
    # 5. Procurement / delivery
    need = [r for r in reqs if r.get("procurement_status") in ("need_to_buy", "unavailable")]
    if need:
        return mk(f"Get materials: {need[0]['name']}", "required_procurement",
                  "You'll need this before the next hands-on step.", WORKSPACE_FOR["procure"], requires_confirmation=True)
    # 6. Current execution task
    for t in tasks:
        if t["status"] == "available" and not t["is_inspection"]:
            return mk(t["title"], "current_execution_task", "This is the next hands-on step.",
                      WORKSPACE_FOR.get(t.get("workspace"), "Execution Coach"), t["id"])
    # 7. Verification
    for t in tasks:
        if t["status"] == "available" and t["is_inspection"]:
            return mk(t["title"], "verification_requirement", "Let's confirm the work meets the goal.",
                      WORKSPACE_FOR["verify"], t["id"])
    # 8. Complete
    if all(t["status"] == "complete" for t in tasks) and tasks:
        return mk("Wrap up and document the project", "completion",
                  "Everything's done — let's capture the results.", WORKSPACE_FOR["document"])
    return mk("Tell me what you'd like to do next", "optional", "No blocking work remains.", WORKSPACE_FOR["chat"])


def _recompute_task_availability(tasks: list) -> list:
    """A pending task becomes available once all its dependencies are complete."""
    by_id = {t["id"]: t for t in tasks}
    updates = []
    for t in tasks:
        if t["status"] in ("complete", "in_progress", "blocked"):
            continue
        deps = t.get("depends_on", [])
        ready = all(by_id.get(d, {}).get("status") == "complete" for d in deps)
        new_state = "available" if ready else "pending"
        if t["status"] != new_state:
            t["status"] = new_state
            updates.append((t["id"], new_state))
    return updates


# ---------------- Request models ----------------

class IntentReq(BaseModel):
    text: str


class CreateProjectReq(BaseModel):
    intent_text: Optional[str] = None
    title: Optional[str] = None
    property_id: Optional[str] = None
    room_id: Optional[str] = None
    budget_range: Optional[str] = None
    target_timeline: Optional[str] = None
    skill_level: Optional[str] = None


class TaskReq(BaseModel):
    title: str
    phase: str = "EXECUTE"
    depends_on: list[str] = []
    is_inspection: bool = False
    workspace: str = "execute"


class TaskUpdateReq(BaseModel):
    action: str  # start | complete | block | unblock


class DecisionReq(BaseModel):
    title: str
    detail: Optional[str] = None
    state: str = "idea"
    cost_delta: Optional[float] = None
    provenance: str = "USER_REPORTED"


class DecisionUpdateReq(BaseModel):
    state: str


class RiskReq(BaseModel):
    kind: str  # safety | code | dependency | compatibility
    severity: str = "high"
    description: str
    affected_tasks: list[str] = []


class RippleReq(BaseModel):
    change_type: str  # measurement | material | product | design | budget | schedule
    field: str
    old_value: Optional[str] = None
    new_value: str
    apply: bool = False


class RequirementReq(BaseModel):
    kind: str  # material | tool | rental
    name: str
    quantity: Optional[float] = None
    unit: Optional[str] = None
    cost_estimate: Optional[float] = None
    procurement_status: str = "need_to_buy"


class EngineSubmitReq(BaseModel):
    engine_name: str
    recommendation: str
    confidence: Optional[str] = "medium"
    evidence: Optional[str] = None
    assumptions: list[str] = []
    risks: list[dict] = []            # [{kind, severity, description, affected_tasks}]
    requirements: list[dict] = []     # [{kind, name, quantity, unit, cost_estimate}]
    suggested_workspace: Optional[str] = None


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/orchestrator")

    async def _owned(pid, uid):
        p = await _db.orch_projects.find_one({"id": pid, "user_id": uid}, {"_id": 0})
        if not p:
            raise HTTPException(status_code=404, detail="Project not found.")
        return p

    @r.get("/meta")
    async def meta(user: dict = Depends(get_current_user)):
        return {"phases": PHASES, "states": EXTRA_STATES, "decision_states": DECISION_STATES,
                "task_states": TASK_STATES, "provenance": PROVENANCE, "workspaces": list(set(WORKSPACE_FOR.values()))}

    @r.post("/intent")
    async def intent(req: IntentReq, user: dict = Depends(get_current_user)):
        return {"intent": route_intent(req.text)}

    @r.post("/projects")
    async def create_project(req: CreateProjectReq, user: dict = Depends(get_current_user)):
        uid = user["id"]
        intent = route_intent(req.intent_text) if req.intent_text else \
            {"projectType": "general_project", "goals": ["general"], "scope": [], "constraints": [], "unknowns": ["dimensions", "budget"], "recommendedEngines": ["measurement", "material"]}
        title = req.title or (req.intent_text or "New project").strip()[:80] or intent["projectType"].replace("_", " ").title()
        pid = _nid()
        high_risk = any(e in intent["recommendedEngines"] for e in ("safety", "code"))
        proj = {
            "id": pid, "user_id": uid, "property_id": req.property_id, "room_id": req.room_id,
            "title": title, "project_type": intent["projectType"], "complexity": _complexity(intent),
            "phase": "DISCOVERY", "status": "ACTIVE",
            "objective": req.intent_text or title, "goals": intent["goals"], "scope": intent["scope"],
            "constraints": intent["constraints"], "unknowns": intent["unknowns"],
            "recommended_engines": intent["recommendedEngines"],
            "budget_range": req.budget_range, "target_timeline": req.target_timeline,
            "skill_level": req.skill_level, "high_risk": high_risk,
            "created_at": _now(), "updated_at": _now(),
        }
        await _db.orch_projects.insert_one(dict(proj)); proj.pop("_id", None)

        # Seed tasks with dependencies resolved to ids (linear-ish: each execution task depends on prior).
        seeds = _seed_tasks(intent)
        created = []
        prev_id = None
        for s in seeds:
            tid = _nid()
            deps = [prev_id] if (prev_id and s["phase"] in ("PROCURE", "PREPARE", "EXECUTE", "VERIFY")) else []
            t = {"id": tid, "project_id": pid, "user_id": uid, "title": s["title"], "phase": s["phase"],
                 "order": s["order"], "depends_on": deps, "is_inspection": s["is_inspection"],
                 "workspace": s["workspace"], "status": "pending", "evidence": None, "created_at": _now()}
            created.append(t)
            prev_id = tid
        # Compute initial availability.
        _recompute_task_availability(created)
        if created:
            await _db.orch_tasks.insert_many([dict(t) for t in created])

        # If high risk, raise a code/professional review risk.
        if high_risk:
            await _db.orch_risks.insert_one({"id": _nid(), "project_id": pid, "user_id": uid, "kind": "code",
                                            "severity": "high", "description": "This project may involve electrical/plumbing/structural work — confirm local code/permit requirements.",
                                            "affected_tasks": [], "status": "open", "created_at": _now()})

        await _emit(pid, uid, "PROJECT_CREATED", {"type": intent["projectType"], "goals": intent["goals"]})
        await _emit(pid, uid, "INTENT_CAPTURED", intent)
        return {"project": proj, "intent": intent, "tasks_created": len(created)}

    @r.get("/projects")
    async def list_projects(user: dict = Depends(get_current_user)):
        rows = await _db.orch_projects.find({"user_id": user["id"], "status": {"$ne": "ARCHIVED"}}, {"_id": 0}).sort("updated_at", -1).to_list(200)
        # Attach quick health headline + next action for each.
        out = []
        for p in rows:
            bundle = await _load_bundle(p["id"], user["id"])
            out.append({**p, "health": _health(bundle)["status"], "next_action": _next_best_action(bundle)["action"]})
        return {"projects": out}

    @r.get("/projects/{pid}")
    async def get_project(pid: str, user: dict = Depends(get_current_user)):
        await _owned(pid, user["id"])
        bundle = await _load_bundle(pid, user["id"])
        decisions = await _db.orch_decisions.find({"project_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(200)
        return {"project": bundle["project"], "tasks": bundle["tasks"], "risks": bundle["risks"],
                "requirements": bundle["requirements"], "decisions": decisions,
                "health": _health(bundle), "next_action": _next_best_action(bundle)}

    @r.get("/projects/{pid}/next")
    async def next_action(pid: str, user: dict = Depends(get_current_user)):
        await _owned(pid, user["id"])
        bundle = await _load_bundle(pid, user["id"])
        return {"next_action": _next_best_action(bundle), "health": _health(bundle)}

    @r.get("/projects/{pid}/events")
    async def events(pid: str, user: dict = Depends(get_current_user)):
        await _owned(pid, user["id"])
        rows = await _db.orch_events.find({"project_id": pid}, {"_id": 0}).sort("at", -1).to_list(300)
        return {"events": rows}

    # ---- Tasks ----
    @r.post("/projects/{pid}/tasks")
    async def add_task(pid: str, req: TaskReq, user: dict = Depends(get_current_user)):
        await _owned(pid, user["id"])
        cnt = await _db.orch_tasks.count_documents({"project_id": pid})
        t = {"id": _nid(), "project_id": pid, "user_id": user["id"], "title": req.title.strip()[:160],
             "phase": req.phase if req.phase in PHASES else "EXECUTE", "order": cnt + 1,
             "depends_on": req.depends_on, "is_inspection": req.is_inspection, "workspace": req.workspace,
             "status": "pending", "evidence": None, "created_at": _now()}
        await _db.orch_tasks.insert_one(dict(t)); t.pop("_id", None)
        # Recompute availability across the project.
        tasks = await _db.orch_tasks.find({"project_id": pid}, {"_id": 0}).to_list(500)
        for tid, st in _recompute_task_availability(tasks):
            await _db.orch_tasks.update_one({"id": tid}, {"$set": {"status": st}})
        return {"task": t}

    @r.put("/tasks/{tid}")
    async def update_task(tid: str, req: TaskUpdateReq, user: dict = Depends(get_current_user)):
        t = await _db.orch_tasks.find_one({"id": tid, "user_id": user["id"]}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Task not found.")
        mapping = {"start": "in_progress", "complete": "complete", "block": "blocked", "unblock": "available"}
        if req.action not in mapping:
            raise HTTPException(status_code=400, detail="Invalid action.")
        await _db.orch_tasks.update_one({"id": tid}, {"$set": {"status": mapping[req.action]}})
        etype = {"start": "TASK_STARTED", "complete": "TASK_COMPLETED", "block": "TASK_BLOCKED", "unblock": "TASK_STARTED"}[req.action]
        await _emit(t["project_id"], user["id"], etype, {"task_id": tid, "title": t["title"]})
        # Recompute availability (completing may unlock dependents) -> schedule recalculation.
        tasks = await _db.orch_tasks.find({"project_id": t["project_id"]}, {"_id": 0}).to_list(500)
        changed = _recompute_task_availability(tasks)
        for x, st in changed:
            await _db.orch_tasks.update_one({"id": x}, {"$set": {"status": st}})
        if changed:
            await _emit(t["project_id"], user["id"], "SCHEDULE_RECALCULATED", {"unlocked": [c[0] for c in changed if c[1] == "available"]})
        await _db.orch_projects.update_one({"id": t["project_id"]}, {"$set": {"updated_at": _now()}})
        bundle = await _load_bundle(t["project_id"], user["id"])
        return {"ok": True, "next_action": _next_best_action(bundle), "health": _health(bundle)}

    # ---- Decisions ----
    @r.post("/projects/{pid}/decisions")
    async def add_decision(pid: str, req: DecisionReq, user: dict = Depends(get_current_user)):
        await _owned(pid, user["id"])
        if req.state not in DECISION_STATES:
            raise HTTPException(status_code=400, detail="Invalid decision state.")
        d = {"id": _nid(), "project_id": pid, "user_id": user["id"], "title": req.title.strip()[:160],
             "detail": (req.detail or "")[:1000] or None, "state": req.state, "cost_delta": req.cost_delta,
             "provenance": req.provenance if req.provenance in PROVENANCE else "USER_REPORTED",
             "versions": [{"state": req.state, "at": _now()}], "created_at": _now(), "updated_at": _now()}
        await _db.orch_decisions.insert_one(dict(d)); d.pop("_id", None)
        await _emit(pid, user["id"], "DECISION_CREATED", {"title": d["title"], "state": d["state"]})
        return {"decision": d}

    @r.put("/decisions/{did}")
    async def update_decision(did: str, req: DecisionUpdateReq, user: dict = Depends(get_current_user)):
        d = await _db.orch_decisions.find_one({"id": did, "user_id": user["id"]}, {"_id": 0})
        if not d:
            raise HTTPException(status_code=404, detail="Decision not found.")
        if req.state not in DECISION_STATES:
            raise HTTPException(status_code=400, detail="Invalid decision state.")
        versions = d.get("versions", []) + [{"state": req.state, "at": _now()}]
        await _db.orch_decisions.update_one({"id": did}, {"$set": {"state": req.state, "versions": versions, "updated_at": _now()}})
        evt = "DECISION_COMMITTED" if req.state == "committed" else ("DECISION_SELECTED" if req.state == "selected" else "DECISION_CREATED")
        await _emit(d["project_id"], user["id"], evt, {"decision_id": did, "state": req.state})
        ripple_needed = req.state == "committed"
        return {"ok": True, "ripple_recommended": ripple_needed,
                "message": "Committed changes may affect materials, cost, and schedule. Review a ripple analysis." if ripple_needed else "Updated."}

    # ---- Ripple engine ----
    @r.post("/projects/{pid}/ripple")
    async def ripple(pid: str, req: RippleReq, user: dict = Depends(get_current_user)):
        proj = await _owned(pid, user["id"])
        impacts = []
        requires_confirmation = False
        # Deterministic heuristics per change type.
        def num(v):
            try:
                return float(re.sub(r"[^0-9.\-]", "", str(v)))
            except Exception:
                return None
        old_n, new_n = num(req.old_value), num(req.new_value)
        if req.change_type in ("measurement", "design") and old_n and new_n and old_n > 0:
            pct = (new_n - old_n) / old_n
            reqs = await _db.orch_requirements.find({"project_id": pid, "kind": "material"}, {"_id": 0}).to_list(100)
            add_cost = 0.0
            for m in reqs:
                if m.get("quantity"):
                    new_qty = round(m["quantity"] * (1 + pct), 2)
                    impacts.append({"entity": f"material:{m['name']}", "change": f"quantity {m['quantity']} → {new_qty} {m.get('unit') or ''}".strip()})
                    if m.get("cost_estimate"):
                        delta = m["cost_estimate"] * pct
                        add_cost += delta
                    if req.apply:
                        await _db.orch_requirements.update_one({"id": m["id"]}, {"$set": {"quantity": new_qty}})
            if add_cost:
                impacts.append({"entity": "budget", "change": f"cost changes by about ${abs(round(add_cost))} ({'+' if add_cost>=0 else '-'})"})
                requires_confirmation = True
            if req.change_type == "design":
                impacts.append({"entity": "visualization", "change": "drawings/visualization will update"})
                requires_confirmation = True
        elif req.change_type == "budget":
            impacts.append({"entity": "procurement", "change": "material selections may change to fit the new budget"})
            requires_confirmation = True
        elif req.change_type == "schedule":
            impacts.append({"entity": "schedule", "change": "affected tasks will be resequenced"})
        elif req.change_type in ("material", "product"):
            impacts.append({"entity": "procurement", "change": f"{req.field} changes to {req.new_value}"})
            impacts.append({"entity": "installation", "change": "installation steps may change"})
            requires_confirmation = True

        summary = f"Changing {req.field.replace('_',' ')} to {req.new_value}: " + \
                  ("; ".join(i["change"] for i in impacts) if impacts else "no significant downstream impact.")
        applied = req.apply and not requires_confirmation
        if req.apply and requires_confirmation:
            applied = False  # spending/committed/safety changes need explicit confirm
        await _emit(pid, user["id"], "PROJECT_UPDATED", {"ripple": req.change_type, "field": req.field, "applied": applied})
        return {"summary": summary, "impacts": impacts, "requires_confirmation": requires_confirmation, "applied": applied}

    # ---- Requirements (materials/tools) ----
    @r.post("/projects/{pid}/requirements")
    async def add_requirement(pid: str, req: RequirementReq, user: dict = Depends(get_current_user)):
        await _owned(pid, user["id"])
        d = {"id": _nid(), "project_id": pid, "user_id": user["id"], "kind": req.kind, "name": req.name.strip()[:120],
             "quantity": req.quantity, "unit": req.unit, "cost_estimate": req.cost_estimate,
             "procurement_status": req.procurement_status, "provenance": "AI_INFERRED", "created_at": _now()}
        await _db.orch_requirements.insert_one(dict(d)); d.pop("_id", None)
        await _emit(pid, user["id"], "MATERIALS_CALCULATED", {"name": d["name"]})
        return {"requirement": d}

    @r.put("/requirements/{rid}")
    async def update_requirement(rid: str, status: str, user: dict = Depends(get_current_user)):
        allowed = ["owned", "need_to_buy", "ordered", "shipped", "ready_for_pickup", "delivered", "rental_booked", "unavailable", "substituted", "returned"]
        if status not in allowed:
            raise HTTPException(status_code=400, detail="Invalid procurement status.")
        req = await _db.orch_requirements.find_one({"id": rid, "user_id": user["id"]}, {"_id": 0})
        if not req:
            raise HTTPException(status_code=404, detail="Requirement not found.")
        await _db.orch_requirements.update_one({"id": rid}, {"$set": {"procurement_status": status}})
        await _emit(req["project_id"], user["id"], "PROCUREMENT_UPDATED", {"name": req["name"], "status": status})
        if status in ("delivered", "ready_for_pickup", "owned"):
            await _emit(req["project_id"], user["id"], "DELIVERY_UPDATED", {"name": req["name"], "status": status})
        return {"ok": True}

    # ---- Risks & safety holds ----
    @r.post("/projects/{pid}/risks")
    async def add_risk(pid: str, req: RiskReq, user: dict = Depends(get_current_user)):
        await _owned(pid, user["id"])
        if req.kind not in ("safety", "code", "dependency", "compatibility"):
            raise HTTPException(status_code=400, detail="Invalid risk kind.")
        d = {"id": _nid(), "project_id": pid, "user_id": user["id"], "kind": req.kind, "severity": req.severity,
             "description": req.description.strip()[:500], "affected_tasks": req.affected_tasks,
             "status": "open", "created_at": _now()}
        await _db.orch_risks.insert_one(dict(d)); d.pop("_id", None)
        evt = "SAFETY_HOLD_CREATED" if req.kind == "safety" else ("CODE_CHECK_REQUESTED" if req.kind == "code" else "RISK_DETECTED")
        await _emit(pid, user["id"], evt, {"description": d["description"]})
        if req.kind == "safety":
            await _db.orch_projects.update_one({"id": pid}, {"$set": {"status": "SAFETY_HOLD", "updated_at": _now()}})
        return {"risk": d}

    @r.post("/risks/{rid}/resolve")
    async def resolve_risk(rid: str, user: dict = Depends(get_current_user)):
        risk = await _db.orch_risks.find_one({"id": rid, "user_id": user["id"]}, {"_id": 0})
        if not risk:
            raise HTTPException(status_code=404, detail="Risk not found.")
        await _db.orch_risks.update_one({"id": rid}, {"$set": {"status": "resolved", "resolved_at": _now()}})
        await _emit(risk["project_id"], user["id"], "SAFETY_HOLD_RESOLVED" if risk["kind"] == "safety" else "CODE_CHECK_COMPLETED", {"risk_id": rid})
        # Lift safety hold only if no other open safety risks.
        if risk["kind"] == "safety":
            more = await _db.orch_risks.count_documents({"project_id": risk["project_id"], "kind": "safety", "status": "open"})
            if more == 0:
                await _db.orch_projects.update_one({"id": risk["project_id"]}, {"$set": {"status": "ACTIVE"}})
        return {"ok": True}

    # ---- Lifecycle controls ----
    @r.post("/projects/{pid}/pause")
    async def pause(pid: str, user: dict = Depends(get_current_user)):
        await _owned(pid, user["id"])
        await _db.orch_projects.update_one({"id": pid}, {"$set": {"status": "PAUSED", "updated_at": _now()}})
        await _emit(pid, user["id"], "PROJECT_UPDATED", {"status": "PAUSED"})
        return {"ok": True}

    @r.post("/projects/{pid}/resume")
    async def resume(pid: str, user: dict = Depends(get_current_user)):
        p = await _owned(pid, user["id"])
        # Don't resume out of a safety hold via resume.
        open_safety = await _db.orch_risks.count_documents({"project_id": pid, "kind": "safety", "status": "open"})
        new_status = "SAFETY_HOLD" if open_safety else "ACTIVE"
        await _db.orch_projects.update_one({"id": pid}, {"$set": {"status": new_status, "updated_at": _now()}})
        await _emit(pid, user["id"], "PROJECT_UPDATED", {"status": new_status})
        return {"ok": True, "status": new_status}

    @r.put("/projects/{pid}/phase")
    async def set_phase(pid: str, phase: str, user: dict = Depends(get_current_user)):
        await _owned(pid, user["id"])
        if phase not in PHASES:
            raise HTTPException(status_code=400, detail="Invalid phase.")
        await _db.orch_projects.update_one({"id": pid}, {"$set": {"phase": phase, "updated_at": _now()}})
        await _emit(pid, user["id"], "PROJECT_UPDATED", {"phase": phase})
        return {"ok": True}

    # ---- Completion audit + Project Passport ----
    @r.get("/projects/{pid}/completion-audit")
    async def completion_audit(pid: str, user: dict = Depends(get_current_user)):
        await _owned(pid, user["id"])
        bundle = await _load_bundle(pid, user["id"])
        tasks = bundle["tasks"]
        checks = [
            {"key": "tasks_complete", "label": "All tasks complete", "passed": bool(tasks) and all(t["status"] == "complete" for t in tasks)},
            {"key": "inspection_done", "label": "Verification steps complete", "passed": all(t["status"] == "complete" for t in tasks if t["is_inspection"])},
            {"key": "no_open_safety", "label": "No open safety holds", "passed": not any(r["kind"] == "safety" for r in bundle["risks"])},
            {"key": "no_open_code", "label": "Code/permit concerns resolved", "passed": not any(r["kind"] == "code" for r in bundle["risks"])},
        ]
        ready = all(c["passed"] for c in checks)
        return {"checks": checks, "ready_to_complete": ready}

    @r.post("/projects/{pid}/complete")
    async def complete(pid: str, force: bool = False, user: dict = Depends(get_current_user)):
        p = await _owned(pid, user["id"])
        bundle = await _load_bundle(pid, user["id"])
        tasks = bundle["tasks"]
        blocking = any(r["kind"] == "safety" for r in bundle["risks"])
        if blocking and not force:
            raise HTTPException(status_code=400, detail="Resolve the open safety hold before completing.")
        decisions = await _db.orch_decisions.find({"project_id": pid, "state": "committed"}, {"_id": 0}).to_list(100)
        reqs = bundle["requirements"]
        materials = [r["name"] for r in reqs if r["kind"] == "material"]
        tools = [r["name"] for r in reqs if r["kind"] in ("tool", "rental")]
        est_cost = round(sum((r.get("cost_estimate") or 0) for r in reqs))
        passport = {
            "title": p["title"], "scope": p.get("scope", []), "goals": p.get("goals", []),
            "committed_decisions": [d["title"] for d in decisions],
            "materials_used": materials, "tools_used": tools, "approx_cost": est_cost,
            "tasks_completed": len([t for t in tasks if t["status"] == "complete"]),
            "known_limitations": [r["description"] for r in bundle["risks"]],
            "generated_at": _now(),
        }
        await _db.orch_projects.update_one({"id": pid}, {"$set": {"status": "COMPLETED", "phase": "COMPLETE",
                                                                  "passport": passport, "updated_at": _now()}})
        await _emit(pid, user["id"], "PROJECT_COMPLETED", {"approx_cost": est_cost})
        return {"ok": True, "passport": passport, "knowledge_consent_required": True}

    @r.post("/projects/{pid}/archive")
    async def archive(pid: str, user: dict = Depends(get_current_user)):
        await _owned(pid, user["id"])
        await _db.orch_projects.update_one({"id": pid}, {"$set": {"status": "ARCHIVED", "updated_at": _now()}})
        await _emit(pid, user["id"], "PROJECT_ARCHIVED", {})
        return {"ok": True}

    # ---- Engine contract: specialized engines submit structured recommendations ----
    @r.post("/projects/{pid}/engine-submit")
    async def engine_submit(pid: str, req: EngineSubmitReq, user: dict = Depends(get_current_user)):
        """Engines never mutate state directly — they submit recommendations the
        orchestrator turns into risks/requirements + a recorded event."""
        await _owned(pid, user["id"])
        created_risks, created_reqs = [], []
        for rk in req.risks:
            if rk.get("kind") in ("safety", "code", "dependency", "compatibility"):
                doc = {"id": _nid(), "project_id": pid, "user_id": user["id"], "kind": rk["kind"],
                       "severity": rk.get("severity", "high"), "description": str(rk.get("description", ""))[:500],
                       "affected_tasks": rk.get("affected_tasks", []), "status": "open", "created_at": _now()}
                await _db.orch_risks.insert_one(dict(doc)); created_risks.append(doc["id"])
                if rk["kind"] == "safety":
                    await _db.orch_projects.update_one({"id": pid}, {"$set": {"status": "SAFETY_HOLD"}})
        for m in req.requirements:
            doc = {"id": _nid(), "project_id": pid, "user_id": user["id"], "kind": m.get("kind", "material"),
                   "name": str(m.get("name", ""))[:120], "quantity": m.get("quantity"), "unit": m.get("unit"),
                   "cost_estimate": m.get("cost_estimate"), "procurement_status": "need_to_buy",
                   "provenance": "AI_INFERRED", "created_at": _now()}
            await _db.orch_requirements.insert_one(dict(doc)); created_reqs.append(doc["id"])
        await _emit(pid, user["id"], "PROJECT_UPDATED", {"engine": req.engine_name, "recommendation": req.recommendation[:200], "confidence": req.confidence})
        bundle = await _load_bundle(pid, user["id"])
        return {"accepted": True, "created_risks": created_risks, "created_requirements": created_reqs,
                "next_action": _next_best_action(bundle), "health": _health(bundle)}

    return r


async def seed_orchestrator():
    if _db is None:
        return
    try:
        await _db.orch_projects.create_index("user_id")
        await _db.orch_tasks.create_index("project_id")
        await _db.orch_events.create_index("project_id")
        await _db.orch_decisions.create_index("project_id")
        await _db.orch_risks.create_index("project_id")
        await _db.orch_requirements.create_index("project_id")
        if _logger:
            _logger.info("project orchestrator seeded")
    except Exception as e:
        if _logger:
            _logger.error(f"orchestrator seed failed: {e}")
