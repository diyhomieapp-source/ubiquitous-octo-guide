"""
DIYhomie — Professional Existing Conditions Workspace (Build Blueprint 30).

A feature-gated professional workspace INSIDE the DIYhomie ecosystem (not a separate app) for
architects, contractors, designers, surveyors, inspectors & property managers. Reuses the shared
identity, property model and capture/digital-twin foundation — it does NOT duplicate them.

Flow: capture -> validate (QA) -> review -> prepare deliverables -> export/share. The system
NEVER claims survey-grade accuracy, CAD/BIM completeness, or permit-ready/stamped/engineered
deliverables. QA identifies data-quality issues but does not certify accuracy — the professional
makes the final acceptance decision, and every dismissal requires a note. Org/project-scoped
auth, private-by-default client data, audit-logged team actions.

Collections: pro_profiles, pro_organizations, pro_org_members, pro_projects, pro_project_members,
pro_capture_requirements, pro_capture_evidence, pro_qa_issues, pro_deliverables,
pro_export_requests, pro_activity, pro_share_links, pro_settings.
"""
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None

ROLES = ["architect", "designer", "contractor", "surveyor", "property_manager", "inspector", "other"]
PROJECT_TYPES = ["existing_conditions", "remodel_planning", "as_built_future", "design_review", "inspection_support"]
CAPTURE_CATEGORIES = ["exterior", "floor_plan", "openings", "ceiling_heights", "mechanical", "electrical", "plumbing", "photos", "measurements", "document"]
CRITICAL_CATEGORIES = {"floor_plan", "measurements", "ceiling_heights"}
PACKAGE_TYPES = ["existing_conditions_summary", "measurement_report", "photo_report", "client_handoff", "export_future"]
EXPORT_TYPES = ["pdf", "dwg_future", "revit_future", "bim_future"]
DEFAULT_REQUIREMENTS = ["floor_plan", "measurements", "ceiling_heights", "openings", "photos"]

NOT_CERTIFIED = ("Preliminary — reflects captured existing conditions at stated confidence. "
                 "Not survey-certified, CAD-accurate, BIM-complete, permit-ready, stamped or engineered.")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _nid():
    return str(uuid.uuid4())


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


async def _cap(user_id, event, props=None):
    try:
        import analytics_engine
        await analytics_engine.capture({"id": user_id}, event, props or {})
    except Exception:
        pass


def _sentry(event_type, message):
    try:
        import sentry_sdk
        sentry_sdk.capture_message(f"[pro_workspace:{event_type}] {message}", level="error")
    except Exception:
        pass


async def _settings() -> dict:
    s = await _db.pro_settings.find_one({"id": "singleton"}, {"_id": 0})
    if not s:
        s = {"id": "singleton", "feature_enabled": True, "auto_approve": True, "updated_at": _now()}
        await _db.pro_settings.insert_one(dict(s)); s.pop("_id", None)
    return s


async def _profile(user_id: str):
    return await _db.pro_profiles.find_one({"user_id": user_id}, {"_id": 0})


async def _require_pro(user_id: str) -> dict:
    s = await _settings()
    if not s["feature_enabled"]:
        raise HTTPException(status_code=403, detail="Professional workspace is not available right now.")
    p = await _profile(user_id)
    if not p or p["status"] != "active":
        raise HTTPException(status_code=403, detail="Professional access required. Enroll first.")
    return p


async def _project(pid, user_id, roles=None) -> dict:
    proj = await _db.pro_projects.find_one({"id": pid}, {"_id": 0})
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found.")
    if proj["owner_user_id"] == user_id:
        return proj
    mem = await _db.pro_project_members.find_one({"professional_project_id": pid, "user_id": user_id}, {"_id": 0})
    if not mem or (roles and mem["role"] not in roles):
        raise HTTPException(status_code=403, detail="You don't have access to this project.")
    return proj


async def _activity(pid, user_id, action, detail=None):
    await _db.pro_activity.insert_one({"id": _nid(), "professional_project_id": pid, "user_id": user_id,
                                       "action": action, "detail": detail, "created_at": _now()})


# ============================================================= QA engine
async def _run_qa(pid: str) -> List[dict]:
    try:
        await _db.pro_qa_issues.delete_many({"professional_project_id": pid, "status": "open"})
        reqs = await _db.pro_capture_requirements.find({"professional_project_id": pid}, {"_id": 0}).to_list(100)
        evidence = await _db.pro_capture_evidence.find({"professional_project_id": pid}, {"_id": 0}).to_list(500)
        ev_by_cat: dict = {}
        for e in evidence:
            ev_by_cat.setdefault(e["category"], []).append(e)
        issues = []

        def _issue(itype, severity, etype, eid, desc, action):
            issues.append({"id": _nid(), "professional_project_id": pid, "issue_type": itype, "severity": severity,
                           "related_entity_type": etype, "related_entity_id": eid, "description": desc,
                           "recommended_action": action, "status": "open", "created_at": _now()})

        for r in reqs:
            if r["required"] and r["status"] != "complete":
                sev = "blocker" if r["category"] in CRITICAL_CATEGORIES else "warning"
                _issue("incomplete_capture_requirement", sev, "capture_requirement", r["id"],
                       f"Required capture '{r['category']}' is {r['status']}.",
                       f"Complete the {r['category']} capture before delivery.")
            if r["category"] == "ceiling_heights" and r["status"] == "complete" and not ev_by_cat.get("ceiling_heights"):
                _issue("missing_ceiling_height", "warning", "capture_requirement", r["id"],
                       "Ceiling heights marked complete but no height evidence found.", "Add ceiling height measurements.")

        for e in evidence:
            if e.get("confidence") == "low":
                _issue("low_confidence_spatial_evidence", "warning", "capture_evidence", e["id"],
                       f"Low-confidence {e['category']} evidence.", "Re-capture or verify this measurement.")
            if e["category"] == "photos" and not e.get("room_id"):
                _issue("unassigned_photo", "info", "capture_evidence", e["id"],
                       "Photo is not assigned to a room.", "Assign this photo to a room.")

        if issues:
            await _db.pro_qa_issues.insert_many([dict(x) for x in issues])
        return issues
    except Exception as ex:
        _sentry("qa_engine_failure", str(ex))
        return []


async def _completeness(pid: str) -> dict:
    reqs = await _db.pro_capture_requirements.find({"professional_project_id": pid}, {"_id": 0}).to_list(100)
    required = [r for r in reqs if r["required"]]
    complete = [r for r in required if r["status"] == "complete"]
    pct = round(len(complete) / len(required) * 100, 1) if required else 0.0
    open_qa = await _db.pro_qa_issues.count_documents({"professional_project_id": pid, "status": "open"})
    blockers = await _db.pro_qa_issues.count_documents({"professional_project_id": pid, "status": "open", "severity": "blocker"})
    return {"capture_completeness": pct, "required": len(required), "complete": len(complete),
            "open_qa": open_qa, "blockers": blockers, "deliverable_ready": pct >= 100 and blockers == 0}


# ============================================================= models
class EnrollReq(BaseModel):
    professional_role: str
    organization_name: Optional[str] = None


class ProjectReq(BaseModel):
    project_name: str
    project_type: str = "existing_conditions"
    client_reference: Optional[str] = None
    property_id: Optional[str] = None


class ProjectUpdateReq(BaseModel):
    status: Optional[str] = None
    deliverable_status: Optional[str] = None


class RequirementReq(BaseModel):
    category: str
    required: bool = True


class ReqStatusReq(BaseModel):
    status: str


class CaptureReq(BaseModel):
    category: str
    kind: str = "measurement"
    label: Optional[str] = None
    value: Optional[str] = None
    room_id: Optional[str] = None
    confidence: str = "medium"


class QANoteReq(BaseModel):
    note: str


class PackageReq(BaseModel):
    package_type: str


class PackageStatusReq(BaseModel):
    status: str


class ExportReq(BaseModel):
    export_type: str = "pdf"


class MemberReq(BaseModel):
    email: str
    role: str = "editor"


class ShareReq(BaseModel):
    deliverable_id: str
    client_reference: Optional[str] = None


# ============================================================= user router
def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/pro", dependencies=[Depends(get_current_user)])

    @r.get("/me")
    async def me(user: dict = Depends(get_current_user)):
        s = await _settings()
        return {"profile": await _profile(user["id"]), "feature_enabled": s["feature_enabled"],
                "roles": ROLES, "project_types": PROJECT_TYPES, "capture_categories": CAPTURE_CATEGORIES}

    @r.post("/enroll")
    async def enroll(req: EnrollReq, user: dict = Depends(get_current_user)):
        s = await _settings()
        if not s["feature_enabled"]:
            raise HTTPException(status_code=403, detail="Professional workspace is not available right now.")
        if req.professional_role not in ROLES:
            raise HTTPException(status_code=400, detail="Invalid role.")
        existing = await _profile(user["id"])
        if existing:
            return {"profile": existing}
        org_id = None
        if req.organization_name:
            org_id = _nid()
            await _db.pro_organizations.insert_one({"id": org_id, "name": req.organization_name.strip()[:120],
                                                    "organization_type": "firm", "status": "active", "created_at": _now()})
            await _db.pro_org_members.insert_one({"id": _nid(), "organization_id": org_id, "user_id": user["id"],
                                                  "role": "owner", "status": "active", "created_at": _now()})
        status = "active" if s["auto_approve"] else "pending"
        prof = {"id": _nid(), "user_id": user["id"], "organization_id": org_id,
                "professional_role": req.professional_role, "status": status, "created_at": _now()}
        await _db.pro_profiles.insert_one(dict(prof)); prof.pop("_id", None)
        return {"profile": prof}

    @r.post("/projects")
    async def create_project(req: ProjectReq, user: dict = Depends(get_current_user)):
        prof = await _require_pro(user["id"])
        if req.project_type not in PROJECT_TYPES:
            raise HTTPException(status_code=400, detail="Invalid project type.")
        proj = {"id": _nid(), "organization_id": prof.get("organization_id"), "owner_user_id": user["id"],
                "client_reference": (req.client_reference or "").strip()[:120] or None,
                "property_id": req.property_id, "project_name": req.project_name.strip()[:160],
                "project_type": req.project_type, "status": "draft", "deliverable_status": "not_started",
                "created_at": _now(), "updated_at": _now()}
        await _db.pro_projects.insert_one(dict(proj)); proj.pop("_id", None)
        await _db.pro_project_members.insert_one({"id": _nid(), "professional_project_id": proj["id"],
                                                  "user_id": user["id"], "role": "owner", "created_at": _now()})
        for cat in DEFAULT_REQUIREMENTS:
            await _db.pro_capture_requirements.insert_one({
                "id": _nid(), "professional_project_id": proj["id"], "category": cat, "required": True,
                "status": "pending", "created_at": _now()})
        await _activity(proj["id"], user["id"], "project_created")
        await _cap(user["id"], "professional_project_created", {"type": req.project_type})
        return {"project": proj}

    @r.get("/projects")
    async def list_projects(user: dict = Depends(get_current_user)):
        await _require_pro(user["id"])
        owned = await _db.pro_projects.find({"owner_user_id": user["id"]}, {"_id": 0}).sort("updated_at", -1).to_list(200)
        member_ids = [m["professional_project_id"] for m in await _db.pro_project_members.find({"user_id": user["id"]}, {"_id": 0}).to_list(500)]
        shared = await _db.pro_projects.find({"id": {"$in": member_ids}, "owner_user_id": {"$ne": user["id"]}}, {"_id": 0}).to_list(200)
        return {"projects": owned + shared}

    @r.get("/projects/{pid}")
    async def get_project(pid: str, user: dict = Depends(get_current_user)):
        await _require_pro(user["id"])
        proj = await _project(pid, user["id"])
        reqs = await _db.pro_capture_requirements.find({"professional_project_id": pid}, {"_id": 0}).to_list(100)
        qa = await _db.pro_qa_issues.find({"professional_project_id": pid, "status": "open"}, {"_id": 0}).to_list(200)
        deliverables = await _db.pro_deliverables.find({"professional_project_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(50)
        members = await _db.pro_project_members.find({"professional_project_id": pid}, {"_id": 0}).to_list(50)
        activity = await _db.pro_activity.find({"professional_project_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(30)
        evidence = await _db.pro_capture_evidence.find({"professional_project_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(300)
        return {"project": proj, "requirements": reqs, "qa_issues": qa, "deliverables": deliverables,
                "members": members, "activity": activity, "evidence": evidence,
                "completeness": await _completeness(pid), "disclaimer": NOT_CERTIFIED}

    @r.put("/projects/{pid}")
    async def update_project(pid: str, req: ProjectUpdateReq, user: dict = Depends(get_current_user)):
        await _require_pro(user["id"])
        await _project(pid, user["id"], roles=["owner", "editor"])
        upd = {k: v for k, v in req.dict().items() if v is not None}
        if upd.get("status") and upd["status"] not in ("draft", "active", "review", "delivered", "archived"):
            raise HTTPException(status_code=400, detail="Invalid status.")
        if upd:
            upd["updated_at"] = _now()
            await _db.pro_projects.update_one({"id": pid}, {"$set": upd})
            await _activity(pid, user["id"], "project_updated", str(upd.get("status") or ""))
        return await _db.pro_projects.find_one({"id": pid}, {"_id": 0})

    @r.post("/projects/{pid}/requirements")
    async def add_requirement(pid: str, req: RequirementReq, user: dict = Depends(get_current_user)):
        await _require_pro(user["id"])
        await _project(pid, user["id"], roles=["owner", "editor"])
        if req.category not in CAPTURE_CATEGORIES:
            raise HTTPException(status_code=400, detail="Invalid category.")
        doc = {"id": _nid(), "professional_project_id": pid, "category": req.category, "required": req.required,
               "status": "pending", "created_at": _now()}
        await _db.pro_capture_requirements.insert_one(dict(doc)); doc.pop("_id", None)
        return {"requirement": doc}

    @r.put("/requirements/{rid}")
    async def set_requirement_status(rid: str, req: ReqStatusReq, user: dict = Depends(get_current_user)):
        await _require_pro(user["id"])
        rq = await _db.pro_capture_requirements.find_one({"id": rid}, {"_id": 0})
        if not rq:
            raise HTTPException(status_code=404, detail="Requirement not found.")
        await _project(rq["professional_project_id"], user["id"], roles=["owner", "editor"])
        if req.status not in ("pending", "in_progress", "complete", "needs_review"):
            raise HTTPException(status_code=400, detail="Invalid status.")
        await _db.pro_capture_requirements.update_one({"id": rid}, {"$set": {"status": req.status}})
        if req.status == "complete":
            await _cap(user["id"], "capture_requirement_completed", {"category": rq["category"]})
        return {"ok": True}

    @r.post("/projects/{pid}/capture")
    async def add_capture(pid: str, req: CaptureReq, user: dict = Depends(get_current_user)):
        await _require_pro(user["id"])
        await _project(pid, user["id"], roles=["owner", "editor"])
        if req.category not in CAPTURE_CATEGORIES:
            raise HTTPException(status_code=400, detail="Invalid category.")
        try:
            ev = {"id": _nid(), "professional_project_id": pid, "category": req.category, "kind": req.kind,
                  "label": (req.label or "").strip()[:120] or None, "value": (req.value or "").strip()[:200] or None,
                  "room_id": req.room_id, "source": "manual", "confidence": req.confidence if req.confidence in ("low", "medium", "high") else "medium",
                  "verification_status": "unverified", "created_at": _now()}
            await _db.pro_capture_evidence.insert_one(dict(ev)); ev.pop("_id", None)
            # advance requirement to in_progress if pending
            await _db.pro_capture_requirements.update_one(
                {"professional_project_id": pid, "category": req.category, "status": "pending"},
                {"$set": {"status": "in_progress"}})
            await _activity(pid, user["id"], "capture_added", req.category)
            return {"evidence": ev}
        except Exception as e:
            _sentry("professional_capture_failure", str(e))
            raise HTTPException(status_code=502, detail="Couldn't save capture. Try again.")

    @r.post("/projects/{pid}/qa/run")
    async def qa_run(pid: str, user: dict = Depends(get_current_user)):
        await _require_pro(user["id"])
        await _project(pid, user["id"])
        issues = await _run_qa(pid)
        for i in issues:
            await _cap(user["id"], "qa_issue_created", {"type": i["issue_type"], "severity": i["severity"]})
        return {"issues": issues, "completeness": await _completeness(pid),
                "note": "QA flags data-quality issues only — it does not certify accuracy. You make the final call."}

    @r.get("/projects/{pid}/qa")
    async def qa_list(pid: str, severity: Optional[str] = None, user: dict = Depends(get_current_user)):
        await _require_pro(user["id"])
        await _project(pid, user["id"])
        flt = {"professional_project_id": pid}
        if severity in ("info", "warning", "blocker"):
            flt["severity"] = severity
        return {"issues": await _db.pro_qa_issues.find(flt, {"_id": 0}).sort("created_at", -1).to_list(300)}

    @r.post("/qa/{iid}/resolve")
    async def qa_resolve(iid: str, req: QANoteReq, user: dict = Depends(get_current_user)):
        await _require_pro(user["id"])
        issue = await _db.pro_qa_issues.find_one({"id": iid}, {"_id": 0})
        if not issue:
            raise HTTPException(status_code=404, detail="Issue not found.")
        await _project(issue["professional_project_id"], user["id"], roles=["owner", "editor", "reviewer"])
        await _db.pro_qa_issues.update_one({"id": iid}, {"$set": {"status": "resolved", "resolution_note": (req.note or "").strip()[:500] or None, "resolved_at": _now()}})
        await _cap(user["id"], "qa_issue_resolved", {"type": issue["issue_type"]})
        return {"ok": True}

    @r.post("/qa/{iid}/dismiss")
    async def qa_dismiss(iid: str, req: QANoteReq, user: dict = Depends(get_current_user)):
        await _require_pro(user["id"])
        if not (req.note or "").strip():
            raise HTTPException(status_code=400, detail="A note is required to dismiss a QA issue.")
        issue = await _db.pro_qa_issues.find_one({"id": iid}, {"_id": 0})
        if not issue:
            raise HTTPException(status_code=404, detail="Issue not found.")
        await _project(issue["professional_project_id"], user["id"], roles=["owner", "editor", "reviewer"])
        await _db.pro_qa_issues.update_one({"id": iid}, {"$set": {"status": "dismissed", "dismissal_note": req.note.strip()[:500], "resolved_at": _now()}})
        return {"ok": True}

    @r.post("/projects/{pid}/deliverables")
    async def create_deliverable(pid: str, req: PackageReq, user: dict = Depends(get_current_user)):
        await _require_pro(user["id"])
        await _project(pid, user["id"], roles=["owner", "editor"])
        if req.package_type not in PACKAGE_TYPES:
            raise HTTPException(status_code=400, detail="Invalid package type.")
        try:
            evidence = await _db.pro_capture_evidence.find({"professional_project_id": pid}, {"_id": 0}).to_list(500)
            rooms = len({e.get("room_id") for e in evidence if e.get("room_id")})
            content = {"measurements": len([e for e in evidence if e["category"] == "measurements"]),
                       "photos": len([e for e in evidence if e["category"] == "photos"]),
                       "rooms_referenced": rooms, "evidence_total": len(evidence),
                       "completeness": (await _completeness(pid))["capture_completeness"]}
            pkg = {"id": _nid(), "professional_project_id": pid, "package_type": req.package_type,
                   "status": "draft", "content_summary": content, "label": NOT_CERTIFIED, "created_at": _now()}
            await _db.pro_deliverables.insert_one(dict(pkg)); pkg.pop("_id", None)
            await _db.pro_projects.update_one({"id": pid}, {"$set": {"deliverable_status": "in_progress", "updated_at": _now()}})
            await _activity(pid, user["id"], "deliverable_created", req.package_type)
            await _cap(user["id"], "deliverable_package_created", {"type": req.package_type})
            return {"deliverable": pkg}
        except Exception as e:
            _sentry("deliverable_generation_failure", str(e))
            raise HTTPException(status_code=502, detail="Couldn't build the deliverable. Try again.")

    @r.put("/deliverables/{did}/status")
    async def deliverable_status(did: str, req: PackageStatusReq, user: dict = Depends(get_current_user)):
        await _require_pro(user["id"])
        d = await _db.pro_deliverables.find_one({"id": did}, {"_id": 0})
        if not d:
            raise HTTPException(status_code=404, detail="Deliverable not found.")
        await _project(d["professional_project_id"], user["id"], roles=["owner", "editor", "reviewer"])
        if req.status not in ("draft", "review", "approved", "shared", "archived"):
            raise HTTPException(status_code=400, detail="Invalid status.")
        await _db.pro_deliverables.update_one({"id": did}, {"$set": {"status": req.status, "updated_at": _now()}})
        return {"ok": True, "status": req.status}

    @r.post("/projects/{pid}/exports")
    async def create_export(pid: str, req: ExportReq, user: dict = Depends(get_current_user)):
        await _require_pro(user["id"])
        proj = await _project(pid, user["id"], roles=["owner", "editor"])
        if req.export_type not in EXPORT_TYPES:
            raise HTTPException(status_code=400, detail="Invalid export type.")
        comp = await _completeness(pid)
        twin_version = f"pin-{_nid()[:12]}"
        # pdf ready immediately; future CAD/BIM formats are queued (not yet available)
        status = "ready" if req.export_type == "pdf" else "queued"
        exp = {"id": _nid(), "professional_project_id": pid, "export_type": req.export_type,
               "digital_twin_version": twin_version,
               "verification_summary": {"completeness": comp["capture_completeness"], "open_qa": comp["open_qa"], "blockers": comp["blockers"]},
               "status": status, "label": NOT_CERTIFIED,
               "note": "PDF export ready to review before client delivery." if status == "ready" else "CAD/BIM export is not yet available — queued for a future verified workflow.",
               "created_at": _now()}
        await _db.pro_export_requests.insert_one(dict(exp)); exp.pop("_id", None)
        await _activity(pid, user["id"], "export_requested", req.export_type)
        await _cap(user["id"], "export_requested", {"type": req.export_type})
        return {"export": exp}

    @r.get("/projects/{pid}/exports")
    async def list_exports(pid: str, user: dict = Depends(get_current_user)):
        await _require_pro(user["id"])
        await _project(pid, user["id"])
        return {"exports": await _db.pro_export_requests.find({"professional_project_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(50)}

    @r.post("/projects/{pid}/members")
    async def add_member(pid: str, req: MemberReq, user: dict = Depends(get_current_user)):
        await _require_pro(user["id"])
        await _project(pid, user["id"], roles=["owner"])
        if req.role not in ("owner", "editor", "reviewer", "viewer", "client_guest"):
            raise HTTPException(status_code=400, detail="Invalid role.")
        target = await _db.users.find_one({"email": req.email.strip().lower()}, {"_id": 0, "id": 1})
        if not target:
            raise HTTPException(status_code=404, detail="No DIYhomie user with that email.")
        await _db.pro_project_members.update_one(
            {"professional_project_id": pid, "user_id": target["id"]},
            {"$set": {"role": req.role}, "$setOnInsert": {"id": _nid(), "professional_project_id": pid,
             "user_id": target["id"], "created_at": _now()}}, upsert=True)
        await _activity(pid, user["id"], "member_added", req.role)
        return {"ok": True}

    @r.post("/projects/{pid}/share")
    async def share_deliverable(pid: str, req: ShareReq, user: dict = Depends(get_current_user)):
        await _require_pro(user["id"])
        await _project(pid, user["id"], roles=["owner", "editor"])
        d = await _db.pro_deliverables.find_one({"id": req.deliverable_id, "professional_project_id": pid}, {"_id": 0})
        if not d:
            raise HTTPException(status_code=404, detail="Deliverable not found.")
        if d["status"] not in ("approved", "shared"):
            raise HTTPException(status_code=409, detail="Approve the deliverable before sharing it with a client.")
        token = _nid()
        link = {"id": _nid(), "professional_project_id": pid, "deliverable_id": req.deliverable_id,
                "token": token, "client_reference": (req.client_reference or "").strip()[:120] or None,
                "scope": ["deliverable"], "status": "active", "created_at": _now()}
        await _db.pro_share_links.insert_one(dict(link))
        await _db.pro_deliverables.update_one({"id": req.deliverable_id}, {"$set": {"status": "shared"}})
        await _activity(pid, user["id"], "client_package_shared", req.deliverable_id)
        await _cap(user["id"], "client_package_shared", {})
        return {"ok": True, "share_token": token,
                "note": "Client link shares only this approved deliverable — never billing, other clients, internal QA notes or unrelated data."}

    return r


# ============================================================= admin router
class ProSettingsReq(BaseModel):
    feature_enabled: Optional[bool] = None
    auto_approve: Optional[bool] = None


class ProfileStatusReq(BaseModel):
    status: str


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/admin/pro", dependencies=[Depends(require_admin)])

    @r.get("/settings")
    async def get_settings(admin: dict = Depends(require_admin)):
        return await _settings()

    @r.put("/settings")
    async def put_settings(req: ProSettingsReq, admin: dict = Depends(require_admin)):
        upd = {k: v for k, v in req.dict().items() if v is not None}
        if upd:
            upd["updated_at"] = _now()
            await _db.pro_settings.update_one({"id": "singleton"}, {"$set": upd}, upsert=True)
        return await _settings()

    @r.get("/profiles")
    async def profiles(admin: dict = Depends(require_admin)):
        return {"profiles": await _db.pro_profiles.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)}

    @r.put("/profiles/{pid}/status")
    async def profile_status(pid: str, req: ProfileStatusReq, admin: dict = Depends(require_admin)):
        if req.status not in ("pending", "active", "suspended"):
            raise HTTPException(status_code=400, detail="Invalid status.")
        res = await _db.pro_profiles.update_one({"id": pid}, {"$set": {"status": req.status}})
        if not res.matched_count:
            raise HTTPException(status_code=404, detail="Profile not found.")
        return {"ok": True, "status": req.status}

    @r.get("/dashboard")
    async def dashboard(admin: dict = Depends(require_admin)):
        async def _pc(st):
            return await _db.pro_profiles.count_documents({"status": st})
        async def _prc(st):
            return await _db.pro_projects.count_documents({"status": st})
        return {"profiles_by_status": {st: await _pc(st) for st in ["pending", "active", "suspended"]},
                "projects_by_status": {st: await _prc(st) for st in ["draft", "active", "review", "delivered", "archived"]},
                "total_projects": await _db.pro_projects.count_documents({}),
                "open_qa_issues": await _db.pro_qa_issues.count_documents({"status": "open"}),
                "deliverables": await _db.pro_deliverables.count_documents({}),
                "organizations": await _db.pro_organizations.count_documents({}),
                "settings": await _settings()}

    return r


# ============================================================= seed
async def seed_pro():
    if _db is None:
        return
    try:
        await _settings()
        if _logger:
            _logger.info("pro workspace (B30) seeded")
    except Exception as e:
        if _logger:
            _logger.error(f"pro workspace seed failed: {e}")
