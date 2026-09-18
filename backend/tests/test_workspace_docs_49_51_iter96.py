"""Doc 49 (Active Project Workspace) + Doc 51 (NBA/NOW card) — iteration 96.

Endpoints:
- /api/hi/workspace/meta, /prefs, /now-summaries, /override-reasons
- /api/hi/workspace/projects/{pid}/briefing (quick/standard/detailed)
- /api/hi/workspace/projects/{pid}/whats-next?minutes_available=5|60
- /api/hi/workspace/projects/{pid}/readiness
- /api/hi/workspace/projects/{pid}/problem (9 types incl. may_be_unsafe, found_obstruction)
- /api/hi/workspace/projects/{pid}/timeline
- /api/hi/workspace/projects/{pid}/offline-bundle
- /api/hi/workspace/projects/{pid}/now
- /api/hi/workspace/projects/{pid}/steps/{sid}/skip-override
- PUT /api/hi/projects/steps/{sid} status=waiting
- PUT /api/hi/projects/materials/{mid} user_status=use_alternative

Uses an existing demo project with plan when possible; else creates a lightweight seed
(TEST-prefixed) so we can exercise timeline/problem/override paths without an LLM plan call.
"""
import os
import time
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "diyhomie")
DEMO = {"email": "demo_home@diyhomie.com", "password": __import__("os").environ.get("TEST_USER_PASSWORD", "")}

_state = {"seeded_pid": None, "seeded_mid": None, "seeded_step_ids": [], "created_problem_ids": [],
          "created_override_ids": [], "restored_safety": None}


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def tok():
    r = requests.post(f"{API}/auth/login", json=DEMO, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def uid(tok):
    r = requests.get(f"{API}/auth/me", headers=_h(tok), timeout=30)
    assert r.status_code == 200
    return r.json()["id"]


@pytest.fixture(scope="module")
def mongo_db():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module")
def planned_pid(mongo_db, uid):
    """Return a project id that has at least one step (real plan preferred)."""
    step = mongo_db.hi_project_steps.find_one({}, {"_id": 0, "project_id": 1})
    if step:
        proj = mongo_db.hi_projects.find_one({"id": step["project_id"], "user_id": uid}, {"_id": 0, "id": 1})
        if proj:
            return proj["id"]
    # fallback: any demo project (may not have plan)
    p = mongo_db.hi_projects.find_one({"user_id": uid}, {"_id": 0, "id": 1})
    return p["id"] if p else None


@pytest.fixture(scope="module")
def seeded_pid(mongo_db, uid):
    """Seed a lightweight project with 3 steps + 2 materials for override/problem/timeline tests."""
    now = datetime.now(timezone.utc).isoformat()
    pid = f"TEST_iter96_proj_{int(time.time())}"
    mongo_db.hi_projects.insert_one({
        "id": pid, "user_id": uid, "title": "TEST_iter96 workspace stub",
        "status": "active", "safety_status": "Safe to continue", "risk_level": "Low Risk",
        "estimated_duration": "30 minutes", "created_at": now, "updated_at": now,
    })
    _state["seeded_pid"] = pid
    _state["restored_safety"] = "Safe to continue"
    phase_id = f"{pid}_ph1"
    mongo_db.hi_project_phases.insert_one({
        "id": phase_id, "project_id": pid, "name": "Prep", "sequence_number": 1, "created_at": now,
    })
    step_ids = []
    for i, (instr, est) in enumerate([
        ("Gather tools and clear workspace", "5 minutes"),
        ("Measure the target area", "10 minutes"),
        ("Complete the primary action", "45 minutes"),
    ], start=1):
        sid = f"{pid}_s{i}"
        mongo_db.hi_project_steps.insert_one({
            "id": sid, "project_id": pid, "project_phase_id": phase_id,
            "sequence_number": i, "instruction": instr, "estimated_time": est,
            "status": "active" if i == 1 else "not_started",
            "tools_needed": ["tape measure", "gloves"] if i == 2 else [],
            "safety_note": "Wear safety glasses" if i == 3 else None,
            "created_at": now,
        })
        step_ids.append(sid)
    _state["seeded_step_ids"] = step_ids
    mid = f"{pid}_m1"
    mongo_db.hi_project_materials.insert_one({
        "id": mid, "project_id": pid, "name": "3-inch screws", "quantity": "1 box",
        "user_status": "need_it", "created_at": now,
    })
    _state["seeded_mid"] = mid
    mongo_db.hi_project_materials.insert_one({
        "id": f"{pid}_m2", "project_id": pid, "name": "wood glue", "quantity": "1",
        "user_status": "have_it", "created_at": now,
    })
    return pid


# ================================================================ Meta / prefs / lists
class TestMeta:
    def test_meta_shape(self, tok):
        r = requests.get(f"{API}/hi/workspace/meta", headers=_h(tok), timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert len(j["project_states"]) == 12, j["project_states"]
        assert len(j["task_states"]) == 11
        assert len(j["briefing_styles"]) == 3
        assert len(j["problem_types"]) == 9
        codes = {p["code"] for p in j["problem_types"]}
        assert {"may_be_unsafe", "found_obstruction", "other"}.issubset(codes)

    def test_override_reasons(self, tok):
        r = requests.get(f"{API}/hi/workspace/override-reasons", headers=_h(tok), timeout=30)
        assert r.status_code == 200
        assert len(r.json()["reasons"]) == 6

    def test_prefs_get_default_and_persist(self, tok):
        r = requests.get(f"{API}/hi/workspace/prefs", headers=_h(tok), timeout=30)
        assert r.status_code == 200
        r2 = requests.put(f"{API}/hi/workspace/prefs", headers=_h(tok),
                          json={"briefing_style": "detailed"}, timeout=30)
        assert r2.status_code == 200
        assert r2.json()["prefs"]["briefing_style"] == "detailed"
        # revert
        requests.put(f"{API}/hi/workspace/prefs", headers=_h(tok),
                     json={"briefing_style": "standard"}, timeout=30)


# ================================================================ Briefing (real plan preferred)
class TestBriefing:
    @pytest.mark.parametrize("style", ["quick", "standard", "detailed"])
    def test_briefing_styles(self, tok, planned_pid, style):
        if not planned_pid:
            pytest.skip("no project available")
        r = requests.get(f"{API}/hi/workspace/projects/{planned_pid}/briefing?style={style}",
                         headers=_h(tok), timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["style"] == style
        assert "spoken" in j and j["spoken"]
        assert "state" in j and "state" in j["state"] and "label" in j["state"]
        assert "progress" in j and set(j["progress"].keys()) >= {"done", "total", "pct"}
        if style == "detailed":
            assert "tools_needed" in j
            assert "materials_missing" in j
            assert "known_issues" in j

    def test_briefing_bad_pid(self, tok):
        r = requests.get(f"{API}/hi/workspace/projects/does_not_exist/briefing",
                         headers=_h(tok), timeout=30)
        assert r.status_code == 404


# ================================================================ What's Next
class TestWhatsNext:
    def test_whats_next_5min_prep_or_ok(self, tok, planned_pid):
        if not planned_pid:
            pytest.skip("no project available")
        r = requests.get(f"{API}/hi/workspace/projects/{planned_pid}/whats-next?minutes_available=5",
                         headers=_h(tok), timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["minutes_available"] == 5
        assert "recommendation" in j
        # If real execute-phase step exists, we expect prep micro-task; else at least recommendation present.
        rec = j["recommendation"]
        assert "title" in rec and "why" in rec

    def test_whats_next_60min(self, tok, planned_pid):
        if not planned_pid:
            pytest.skip("no project available")
        r = requests.get(f"{API}/hi/workspace/projects/{planned_pid}/whats-next?minutes_available=60",
                         headers=_h(tok), timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert j["minutes_available"] == 60


# ================================================================ Readiness / materials
class TestReadiness:
    def test_readiness_and_options(self, tok, seeded_pid):
        r = requests.get(f"{API}/hi/workspace/projects/{seeded_pid}/readiness",
                         headers=_h(tok), timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["ready"] is False
        assert set(j["options"]) == {"have_it", "need_it", "use_alternative", "ask_homie", "buy_it"}
        assert any(m["name"] == "3-inch screws" for m in j["missing"])

    def test_material_use_alternative(self, tok, seeded_pid, mongo_db):
        mid = _state["seeded_mid"]
        r = requests.put(f"{API}/hi/projects/materials/{mid}", headers=_h(tok),
                         json={"user_status": "use_alternative"}, timeout=30)
        assert r.status_code == 200, r.text
        # verify persisted
        m = mongo_db.hi_project_materials.find_one({"id": mid}, {"_id": 0, "user_status": 1})
        assert m["user_status"] == "use_alternative"


# ================================================================ Problem reporting
class TestProblem:
    def test_bad_type(self, tok, seeded_pid):
        r = requests.post(f"{API}/hi/workspace/projects/{seeded_pid}/problem",
                          headers=_h(tok), json={"problem_type": "made_up"}, timeout=30)
        assert r.status_code == 400

    def test_may_be_unsafe_routes_pro_review(self, tok, seeded_pid, mongo_db):
        r = requests.post(f"{API}/hi/workspace/projects/{seeded_pid}/problem", headers=_h(tok),
                         json={"problem_type": "may_be_unsafe",
                               "note": "There is live electrical wiring exposed near the work area."},
                         timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["route"] == "pro_review"
        assert j["state"]["state"] in ("PRO_REVIEW", "BLOCKED"), j["state"]
        _state["created_problem_ids"].append(j["problem"]["id"])
        p = mongo_db.hi_projects.find_one({"id": seeded_pid}, {"_id": 0, "safety_status": 1})
        # safety_engine may or may not upgrade it; either way state should be PRO_REVIEW or BLOCKED
        assert p is not None

    def test_found_obstruction_creates_blocker(self, tok, seeded_pid, mongo_db):
        # Reset safety_status so we don't stay in PRO_REVIEW
        mongo_db.hi_projects.update_one({"id": seeded_pid},
                                        {"$set": {"safety_status": "Safe to continue"}})
        r = requests.post(f"{API}/hi/workspace/projects/{seeded_pid}/problem", headers=_h(tok),
                         json={"problem_type": "found_obstruction",
                               "note": "Pipe behind drywall.", "photo_base64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="},
                         timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["route"] == "adjust_plan"
        # blocker exists
        b = mongo_db.pi_blockers.find_one({"project_id": seeded_pid, "status": "active",
                                           "blocker_type": "found_obstruction"}, {"_id": 0, "id": 1})
        assert b, "expected an active pi_blockers row for found_obstruction"
        _state["created_problem_ids"].append(j["problem"]["id"])
        # photo persisted
        m = mongo_db.hi_project_media.find_one({"project_id": seeded_pid, "media_type": "photo"},
                                               {"_id": 0, "id": 1})
        assert m, "expected photo saved to hi_project_media"


# ================================================================ Timeline / offline
class TestTimelineOffline:
    def test_timeline_desc(self, tok, seeded_pid):
        r = requests.get(f"{API}/hi/workspace/projects/{seeded_pid}/timeline",
                         headers=_h(tok), timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "items" in j and isinstance(j["items"], list)
        # ordering
        ats = [i["at"] for i in j["items"]]
        assert ats == sorted(ats, reverse=True)
        types = {i["type"] for i in j["items"]}
        assert "problem" in types or "blocker" in types
        assert "material_ready" in types  # wood glue have_it

    def test_offline_bundle_shape(self, tok, seeded_pid):
        r = requests.get(f"{API}/hi/workspace/projects/{seeded_pid}/offline-bundle",
                         headers=_h(tok), timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "project" in j and "phases" in j and "materials" in j and "briefing" in j
        assert "cached_at" in j
        assert isinstance(j["phases"], list) and len(j["phases"]) >= 1
        assert "steps" in j["phases"][0]


# ================================================================ Doc 51 NOW / override
class TestNowCard:
    def test_now_card_shape(self, tok, planned_pid, mongo_db):
        if not planned_pid:
            pytest.skip("no project")
        # make sure no lingering blocker on this planned project skewing shape
        r = requests.get(f"{API}/hi/workspace/projects/{planned_pid}/now",
                         headers=_h(tok), timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        for k in ("projectId", "taskId", "status", "actionType", "title", "reason",
                  "location", "requiredTools", "safety", "nextTaskPreview", "progress"):
            assert k in j, f"missing key {k}"
        assert j["safety"]["color"] in ("GREEN", "YELLOW", "ORANGE", "RED")

    def test_now_summaries_shape(self, tok):
        r = requests.get(f"{API}/hi/workspace/now-summaries", headers=_h(tok), timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert "summaries" in j and isinstance(j["summaries"], dict)


class TestOverride:
    def test_bad_reason(self, tok, seeded_pid):
        sid = _state["seeded_step_ids"][0]
        r = requests.post(f"{API}/hi/workspace/projects/{seeded_pid}/steps/{sid}/skip-override",
                          headers=_h(tok), json={"reason": "made_up"}, timeout=30)
        assert r.status_code == 400
        assert "reasons" in r.json()["detail"]

    def test_skip_with_reason_and_timeline(self, tok, seeded_pid, mongo_db):
        sid = _state["seeded_step_ids"][1]  # measure step
        r = requests.post(f"{API}/hi/workspace/projects/{seeded_pid}/steps/{sid}/skip-override",
                          headers=_h(tok), json={"reason": "different_method",
                                                 "note": "Doing measurement by eye"}, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["status"] == "skipped"
        st = mongo_db.hi_project_steps.find_one({"id": sid}, {"_id": 0, "status": 1, "override_reason": 1})
        assert st["status"] == "skipped"
        assert st["override_reason"] == "different_method"
        ov = mongo_db.ws_overrides.find_one({"step_id": sid}, {"_id": 0, "id": 1})
        assert ov is not None
        _state["created_override_ids"].append(ov["id"])
        # appears in timeline as plan_change
        tl = requests.get(f"{API}/hi/workspace/projects/{seeded_pid}/timeline",
                          headers=_h(tok), timeout=30).json()["items"]
        assert any(i["type"] == "plan_change" and "skipped with override" in i["title"] for i in tl)

    def test_step_status_waiting_accepted(self, tok, seeded_pid, mongo_db):
        sid = _state["seeded_step_ids"][2]
        r = requests.put(f"{API}/hi/projects/steps/{sid}", headers=_h(tok),
                         json={"status": "waiting"}, timeout=30)
        assert r.status_code == 200, r.text
        st = mongo_db.hi_project_steps.find_one({"id": sid}, {"_id": 0, "status": 1})
        assert st["status"] == "waiting"


# ================================================================ Cleanup
def test_zzz_cleanup(mongo_db):
    pid = _state["seeded_pid"]
    if not pid:
        return
    mongo_db.hi_projects.delete_many({"id": pid})
    mongo_db.hi_project_phases.delete_many({"project_id": pid})
    mongo_db.hi_project_steps.delete_many({"project_id": pid})
    mongo_db.hi_project_materials.delete_many({"project_id": pid})
    mongo_db.hi_project_media.delete_many({"project_id": pid})
    mongo_db.pi_blockers.delete_many({"project_id": pid})
    mongo_db.ws_problems.delete_many({"project_id": pid})
    mongo_db.ws_overrides.delete_many({"project_id": pid})
