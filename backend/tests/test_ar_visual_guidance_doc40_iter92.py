"""Doc 40 — Dynamic AR Visual Guidance layer (iter 92).

Coverage:
- GET /api/hi/ar/meta/actions (32 primitives, 33 tools, 8 anchor types, visual_objects)
- GET /api/hi/ar/meta/packages + /api/hi/ar/meta/packages/{pid} (4 packages, toilet_replacement details, 404)
- POST /api/hi/ar/sessions + confidence-aware /instructions/{iid}/target
- Project-step instructions carry structured `action` payload (fixture-seeded if needed)
- Regression: eligibility, confirm, pause/resume, fallback, complete still work
"""
import os
import uuid
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "diyhomie")

USER = {"email": "demo_home@diyhomie.com", "password": "Test1234"}

_seed_state = {"project_id": None, "step_ids": [], "created": False}


def _login(payload):
    r = requests.post(f"{API}/auth/login", json=payload, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def user_tok():
    return _login(USER)


@pytest.fixture(scope="module")
def user_id(user_tok):
    r = requests.get(f"{API}/auth/me", headers=_h(user_tok), timeout=30)
    assert r.status_code == 200
    return r.json()["id"]


@pytest.fixture(scope="module")
def mongo_db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


# -------------------------------------------------- META endpoints
class TestMetaActions:
    def test_actions_32_primitives(self, user_tok):
        r = requests.get(f"{API}/hi/ar/meta/actions", headers=_h(user_tok), timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert isinstance(j["primitives"], list)
        assert len(j["primitives"]) == 32, f"expected 32 primitives, got {len(j['primitives'])}"
        # Each primitive has required keys
        for p in j["primitives"]:
            for k in ("id", "motion", "tool", "direction", "anchor", "visuals"):
                assert k in p, f"missing {k} in {p}"
            assert isinstance(p["visuals"], list)
        # Specific check: LOOSEN_BOLT
        ids = {p["id"] for p in j["primitives"]}
        assert "LOOSEN_BOLT" in ids and "DRIVE_SCREW" in ids and "CAULK_PATH" in ids

    def test_tools_33(self, user_tok):
        r = requests.get(f"{API}/hi/ar/meta/actions", headers=_h(user_tok), timeout=30)
        j = r.json()
        assert len(j["tools"]) == 33, f"expected 33 tools got {len(j['tools'])}"
        for t in j["tools"]:
            for k in ("id", "label", "grip_point", "interaction_point", "rotation_axis"):
                assert k in t

    def test_anchor_types_8(self, user_tok):
        r = requests.get(f"{API}/hi/ar/meta/actions", headers=_h(user_tok), timeout=30)
        j = r.json()
        assert len(j["anchor_types"]) == 8
        assert set(j["anchor_types"]) == {"world", "object", "component", "surface", "edge", "point", "path", "plane"}

    def test_visual_objects_present(self, user_tok):
        r = requests.get(f"{API}/hi/ar/meta/actions", headers=_h(user_tok), timeout=30)
        j = r.json()
        assert isinstance(j["visual_objects"], list) and len(j["visual_objects"]) > 0

    def test_auth_required(self):
        r = requests.get(f"{API}/hi/ar/meta/actions", timeout=30)
        assert r.status_code in (401, 403)


class TestMetaPackages:
    def test_list_4_packages(self, user_tok):
        r = requests.get(f"{API}/hi/ar/meta/packages", headers=_h(user_tok), timeout=30)
        assert r.status_code == 200
        pkgs = r.json()["packages"]
        assert len(pkgs) == 4
        ids = {p["id"] for p in pkgs}
        assert ids == {"painting", "toilet_replacement", "drywall_repair", "flooring"}
        for p in pkgs:
            assert "label" in p and "action_count" in p and p["action_count"] > 0

    def test_toilet_replacement_details(self, user_tok):
        r = requests.get(f"{API}/hi/ar/meta/packages/toilet_replacement", headers=_h(user_tok), timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["id"] == "toilet_replacement"
        actions = j["actions"]
        assert len(actions) == 11, f"expected 11 actions got {len(actions)}"
        # First is CLOSE_SHUTOFF
        assert actions[0]["action_id"] == "CLOSE_SHUTOFF"
        # Sequences are 0..10
        assert [a["sequence"] for a in actions] == list(range(11))
        # LOOSEN_BOLT present with adjustable_wrench + counterclockwise + component anchor + rotation_arrow visual
        lb = next(a for a in actions if a["action_id"] == "LOOSEN_BOLT")
        assert lb["tool"] == "adjustable_wrench"
        assert lb["direction"] == "counterclockwise"
        assert lb["anchor"] == "component"
        assert "rotation_arrow" in lb["visuals"]

    def test_bogus_package_404(self, user_tok):
        r = requests.get(f"{API}/hi/ar/meta/packages/not_a_real_pkg", headers=_h(user_tok), timeout=30)
        assert r.status_code == 404


# -------------------------------------------------- Confidence-aware targeting
class TestTargetConfidence:
    @pytest.fixture(scope="class")
    def sess(self, user_tok):
        r = requests.post(f"{API}/hi/ar/sessions", headers=_h(user_tok), json={
            "guidance_type": "sequence_overlay",
            "device": {"platform": "ios", "supports_ar": True, "camera_permission": "granted"}
        }, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        sid = d["session"]["id"]
        iid = d["instructions"][0]["id"]
        yield sid, iid
        # cleanup
        try:
            requests.post(f"{API}/hi/ar/sessions/{sid}/cancel", headers=_h(user_tok),
                          json={"result": "user_cancelled"}, timeout=30)
        except Exception:
            pass

    def test_high_confidence_acquired(self, user_tok, sess):
        sid, iid = sess
        r = requests.post(f"{API}/hi/ar/sessions/{sid}/instructions/{iid}/target",
                          headers=_h(user_tok), json={"confidence": 0.95}, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["target_state"] == "acquired"
        assert j["behavior"] == "anchor_and_guide"
        assert j["confidence"] == 0.95

    def test_mid_confidence_candidate(self, user_tok, sess):
        sid, iid = sess
        r = requests.post(f"{API}/hi/ar/sessions/{sid}/instructions/{iid}/target",
                          headers=_h(user_tok), json={"confidence": 0.6}, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert j["target_state"] == "candidate"
        assert j["behavior"] == "request_confirmation"

    def test_low_confidence_lost(self, user_tok, sess):
        sid, iid = sess
        r = requests.post(f"{API}/hi/ar/sessions/{sid}/instructions/{iid}/target",
                          headers=_h(user_tok), json={"confidence": 0.2}, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert j["target_state"] == "lost"
        assert j["behavior"] == "request_rescan"

    def test_user_confirmed_overrides_low(self, user_tok, sess):
        sid, iid = sess
        r = requests.post(f"{API}/hi/ar/sessions/{sid}/instructions/{iid}/target",
                          headers=_h(user_tok), json={"confidence": 0.2, "user_confirmed": True}, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert j["target_state"] == "acquired"
        assert j["behavior"] == "anchor_and_guide"

    def test_bogus_instruction_404(self, user_tok, sess):
        sid, _ = sess
        r = requests.post(f"{API}/hi/ar/sessions/{sid}/instructions/not_a_real_iid/target",
                          headers=_h(user_tok), json={"confidence": 0.9}, timeout=30)
        assert r.status_code == 404


# -------------------------------------------------- Action payload on project-step instructions
def _find_or_seed_project_with_steps(db, user_id, user_tok):
    """Return (project_id, created_bool). If demo user has no project with hi_project_steps, seed one."""
    # look for existing project with steps
    existing = list(db.hi_projects.find({"user_id": user_id}, {"_id": 0, "id": 1, "title": 1,
                                                                 "risk_level": 1, "safety_status": 1,
                                                                 "project_category": 1, "status": 1}).limit(50))
    for p in existing:
        # skip anything that would fail AR eligibility
        title = (p.get("title") or "").lower()
        cat = (p.get("project_category") or "").lower()
        blob = f"{title} {cat}"
        bad_kws = ["electrical panel", "breaker", "gas", "structural", "roof", "asbestos",
                   "lead paint", "sewer", "furnace", "wiring a circuit", "electrical", "chemical",
                   "mold", "high voltage", "ladder", "height"]
        if p.get("risk_level") == "High Risk" or p.get("risk_level") == "Professional Recommended":
            continue
        if any(k in blob for k in bad_kws):
            continue
        if p.get("status") in ("escalated", "blocked"):
            continue
        step_count = db.hi_project_steps.count_documents({"project_id": p["id"]})
        if step_count > 0:
            return p["id"], False

    # seed a benign project + steps
    pid = f"TEST_iter92_proj_{uuid.uuid4().hex[:12]}"
    # need property_id — pick user's property or synthesize
    prop = db.hi_properties.find_one({"user_id": user_id}, {"_id": 0, "id": 1})
    prop_id = prop["id"] if prop else f"TEST_iter92_prop_{uuid.uuid4().hex[:8]}"
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    db.hi_projects.insert_one({
        "id": pid, "user_id": user_id, "property_id": prop_id, "room_id": None, "asset_id": None,
        "title": "TEST_iter92 floating shelf install",
        "project_category": "install", "project_goal": "Install a floating shelf",
        "description": "test", "status": "draft", "risk_level": "Low Risk",
        "safety_status": "safe", "created_at": now, "completed_at": None,
    })
    steps = []
    step_defs = [
        ("Measure the wall to mark where the shelf will go.", None, None),
        ("Slide the stud finder across the wall and mark where it signals.", None, None),
        ("Drive a screw here until the head sits just below the surface.", None, None),
        ("Place the shelf onto the mounted bracket.", None, None),
    ]
    for i, (instr, safety, stop) in enumerate(step_defs):
        sid = f"TEST_iter92_step_{uuid.uuid4().hex[:12]}"
        steps.append(sid)
        db.hi_project_steps.insert_one({
            "id": sid, "project_id": pid, "project_phase_id": None,
            "sequence_number": i, "instruction": instr,
            "safety_note": safety, "stop_condition": stop,
            "status": "active" if i == 0 else "not_started",
            "created_at": now, "completed_at": None,
        })
    _seed_state["project_id"] = pid
    _seed_state["step_ids"] = steps
    _seed_state["created"] = True
    return pid, True


class TestActionPayloadOnSession:
    @pytest.fixture(scope="class")
    def project_session(self, user_tok, user_id, mongo_db):
        pid, created = _find_or_seed_project_with_steps(mongo_db, user_id, user_tok)
        r = requests.post(f"{API}/hi/ar/sessions", headers=_h(user_tok), json={
            "project_id": pid, "guidance_type": "sequence_overlay",
            "device": {"platform": "ios", "supports_ar": True, "camera_permission": "granted"}
        }, timeout=30)
        assert r.status_code == 200, f"session start failed with project {pid}: {r.status_code} {r.text}"
        d = r.json()
        yield d, pid
        # cleanup
        try:
            requests.post(f"{API}/hi/ar/sessions/{d['session']['id']}/cancel",
                          headers=_h(user_tok), json={"result": "user_cancelled"}, timeout=30)
        except Exception:
            pass

    def test_instructions_have_action_payload(self, project_session):
        d, _pid = project_session
        instrs = d["instructions"]
        assert len(instrs) >= 1
        for ins in instrs:
            assert "action" in ins, f"instruction missing action: {ins.keys()}"
            a = ins["action"]
            assert isinstance(a, dict)
            for k in ("action_id", "motion", "anchor", "visuals", "voice", "verification", "safety_level"):
                assert k in a, f"action missing {k}: {a}"
            # anchor has type + tracking_required
            assert "type" in a["anchor"] and "tracking_required" in a["anchor"]
            # verification has type + prompt
            assert "type" in a["verification"] and "prompt" in a["verification"]
            # visuals is a list
            assert isinstance(a["visuals"], list) and len(a["visuals"]) >= 1
            # safety_level is normal/caution
            assert a["safety_level"] in ("normal", "caution")

    def test_action_id_valid(self, project_session):
        d, _ = project_session
        # every action_id in payload must be one of the 32 primitives
        valid = {"LOOSEN_BOLT", "TIGHTEN_BOLT", "DRIVE_SCREW", "REMOVE_SCREW", "DRILL", "HAMMER",
                 "TAP_JOINT", "PRY", "CUT", "SAW", "MEASURE", "MARK", "LEVEL_CHECK", "APPLY_TAPE",
                 "CUT_IN_EDGE", "ROLL_SURFACE", "APPLY_COMPOUND", "EMBED_TAPE", "SAND_SURFACE",
                 "SCRAPE", "CAULK_PATH", "PLACE_OBJECT", "ALIGN_OBJECT", "LIFT_OBJECT",
                 "CLOSE_SHUTOFF", "OPEN_SHUTOFF", "DISCONNECT_SUPPLY", "RECONNECT_SUPPLY",
                 "INSPECT", "CHECK_FOR_LEAK", "FIND_STUD", "WIPE_CLEAN"}
        for ins in d["instructions"]:
            assert ins["action"]["action_id"] in valid


# -------------------------------------------------- Regression: existing AR flow
class TestARRegression:
    @pytest.fixture(scope="class")
    def sess(self, user_tok):
        r = requests.post(f"{API}/hi/ar/sessions", headers=_h(user_tok), json={
            "guidance_type": "orientation_marker",
            "device": {"platform": "ios", "supports_ar": True, "camera_permission": "granted"}
        }, timeout=30)
        assert r.status_code == 200
        d = r.json()
        yield d["session"]["id"], d["instructions"][0]["id"]
        try:
            requests.post(f"{API}/hi/ar/sessions/{d['session']['id']}/cancel",
                          headers=_h(user_tok), json={"result": "user_cancelled"}, timeout=30)
        except Exception:
            pass

    def test_eligibility(self, user_tok):
        r = requests.post(f"{API}/hi/ar/eligibility", headers=_h(user_tok), json={
            "guidance_type": "orientation_marker",
            "device": {"platform": "ios", "supports_ar": True, "camera_permission": "granted"}
        }, timeout=30)
        assert r.status_code == 200
        e = r.json()["eligibility"]
        assert e["status"] in ("AVAILABLE", "LIMITED")

    def test_confirm_instruction(self, user_tok, sess):
        sid, iid = sess
        # calibrate first so instruction can transition
        requests.post(f"{API}/hi/ar/sessions/{sid}/calibrate", headers=_h(user_tok),
                      json={"anchor_confirmed": True}, timeout=30)
        r = requests.post(f"{API}/hi/ar/sessions/{sid}/instructions/{iid}/confirm",
                          headers=_h(user_tok), timeout=30)
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_pause_resume(self, user_tok, sess):
        sid, _ = sess
        r1 = requests.post(f"{API}/hi/ar/sessions/{sid}/pause", headers=_h(user_tok), timeout=30)
        assert r1.status_code == 200
        r2 = requests.post(f"{API}/hi/ar/sessions/{sid}/resume", headers=_h(user_tok), timeout=30)
        assert r2.status_code == 200

    def test_fallback(self, user_tok, sess):
        sid, _ = sess
        r = requests.post(f"{API}/hi/ar/sessions/{sid}/fallback", headers=_h(user_tok),
                          json={"to": "text"}, timeout=30)
        assert r.status_code == 200 and r.json()["to"] == "text"

    def test_complete(self, user_tok, sess):
        sid, _ = sess
        r = requests.post(f"{API}/hi/ar/sessions/{sid}/complete", headers=_h(user_tok),
                          json={"work_item_confirmed": False}, timeout=30)
        assert r.status_code == 200 and r.json()["ok"] is True


# -------------------------------------------------- Teardown
def teardown_module(module):
    """Clean up any seeded fixtures + AR sessions/instructions/anchors we created."""
    try:
        client = MongoClient(MONGO_URL)
        db = client[DB_NAME]
        # Clean up seeded project + steps if we created them
        if _seed_state["created"] and _seed_state["project_id"]:
            pid = _seed_state["project_id"]
            db.hi_project_steps.delete_many({"project_id": pid})
            db.hi_projects.delete_many({"id": pid})
        # Clean up all AR sessions created for demo user during this run's TEST_iter92 project
        # Also clean orphaned test-generated ar_sessions with the seed project id
        if _seed_state["project_id"]:
            sess_ids = [s["id"] for s in db.ar_sessions.find({"project_id": _seed_state["project_id"]}, {"_id": 0, "id": 1})]
            for sid in sess_ids:
                db.ar_instructions.delete_many({"ar_guidance_session_id": sid})
                db.ar_anchors.delete_many({"ar_guidance_session_id": sid})
            db.ar_sessions.delete_many({"project_id": _seed_state["project_id"]})
        client.close()
    except Exception as e:
        print(f"teardown warning: {e}")
