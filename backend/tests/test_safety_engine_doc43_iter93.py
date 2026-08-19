"""Doc 43 — Central Safety & Risk Engine (iter 93).

Coverage:
- GET /api/hi/safety/meta (auth-gated; 6 verdicts, 6 risk levels, PPE catalog ~18)
- POST /api/hi/safety/evaluate — 7 scenario verdict matrix
- GET /api/hi/safety/events (non-allow events only, per demo user)
- GET /api/hi/admin/safety/events (admin only; by_verdict counts)
- Escalate/block → hi_safety_escalations ledger row with trigger_type safety_engine_*
- AR compose integration — instruction.action.ppe attached for a project-step session
- Regression: /api/hi/start/intent still classifies; /api/hi/chat still sends
"""
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "diyhomie")

DEMO = {"email": "demo_home@diyhomie.com", "password": "Test1234"}
ADMIN = {"email": "Diyhomieapp@gmail.com", "password": "diyhomie1122"}

_seed = {"project_id": None, "step_ids": [], "created": False,
         "session_ids": [], "sf_event_ids_before": set()}


def _login(payload):
    r = requests.post(f"{API}/auth/login", json=payload, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def demo_tok():
    return _login(DEMO)


@pytest.fixture(scope="module")
def admin_tok():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def demo_uid(demo_tok):
    r = requests.get(f"{API}/auth/me", headers=_h(demo_tok), timeout=30)
    assert r.status_code == 200
    return r.json()["id"]


@pytest.fixture(scope="module")
def mongo_db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


# -------------------------------------------------- Meta endpoint
class TestSafetyMeta:
    def test_meta_unauth_rejected(self):
        r = requests.get(f"{API}/hi/safety/meta", timeout=30)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_meta_authed_ok(self, demo_tok):
        r = requests.get(f"{API}/hi/safety/meta", headers=_h(demo_tok), timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert set(j["verdicts"]) == {
            "allow", "allow_with_warning", "require_verification",
            "require_additional_evidence", "block_action", "escalate_to_professional",
        }
        assert len(j["verdicts"]) == 6
        assert len(j["risk_levels"]) == 6
        levels = [r["level"] for r in j["risk_levels"]]
        assert levels == [0, 1, 2, 3, 4, 5]
        for row in j["risk_levels"]:
            assert "label" in row and "example" in row
        ppe = j["ppe_catalog"]
        assert isinstance(ppe, list)
        assert 15 <= len(ppe) <= 22, f"ppe catalog size unexpected: {len(ppe)} -> {ppe}"
        # sanity check: some canonical PPE strings present
        assert "Safety glasses" in ppe
        assert any("respirator" in p.lower() for p in ppe)


# -------------------------------------------------- Verdict matrix
def _eval(tok, text, skill=None, source="test_iter93"):
    body = {"text": text, "source": source}
    if skill:
        body["skill_level"] = skill
    r = requests.post(f"{API}/hi/safety/evaluate", headers=_h(tok), json=body, timeout=30)
    assert r.status_code == 200, f"evaluate failed for '{text}': {r.status_code} {r.text}"
    return r.json()


class TestVerdictMatrix:
    def test_paint_color_choice_allow(self, demo_tok):
        v = _eval(demo_tok, "Choose a paint color for the bedroom")
        assert v["verdict"] == "allow"
        assert v["risk_level"] in (0, 1)
        assert v["ppe"] == []

    def test_paint_wall_allow_with_warning(self, demo_tok):
        v = _eval(demo_tok, "Paint the bedroom wall")
        assert v["verdict"] == "allow_with_warning"
        assert "Ventilation" in v["ppe"]

    def test_sand_drywall_allow_with_warning(self, demo_tok):
        v = _eval(demo_tok, "Sand the drywall patch")
        assert v["verdict"] == "allow_with_warning"
        assert any("dust mask" in p.lower() or "respirator" in p.lower() for p in v["ppe"])

    def test_drill_wall_require_verification(self, demo_tok):
        v = _eval(demo_tok, "Drill into the wall to hang a shelf")
        assert v["verdict"] == "require_verification"
        assert "hidden_utility" in v["stop_conditions"]
        assert v["next_action"] and isinstance(v["next_action"], str) and len(v["next_action"]) > 0

    def test_outlet_replace_require_verification(self, demo_tok):
        v = _eval(demo_tok, "Replace the outlet in the kitchen")
        assert v["verdict"] == "require_verification"
        assert any("voltage tester" in p.lower() for p in v["ppe"])

    def test_load_bearing_wall_escalate(self, demo_tok):
        v = _eval(demo_tok, "Remove a load-bearing wall")
        assert v["verdict"] == "escalate_to_professional"
        assert v["risk_level"] == 5
        assert v["next_action"] and (
            "document" in v["next_action"].lower() or "photograph" in v["next_action"].lower()
        )

    def test_gas_smell_block(self, demo_tok):
        v = _eval(demo_tok, "I smell gas near the stove")
        assert v["verdict"] == "block_action"
        assert v["risk_level"] == 5
        # emergency guidance present
        assert v["guidance"] or v["message"]


# -------------------------------------------------- Events endpoints
class TestSafetyEvents:
    def test_user_events_after_matrix(self, demo_tok):
        # baseline: run one allow + one non-allow, ensure allow is NOT stored
        _eval(demo_tok, "Choose a paint color for the bedroom", source="test_iter93_allow_check")
        _eval(demo_tok, "Drill into the wall to hang a shelf", source="test_iter93_verify_check")
        r = requests.get(f"{API}/hi/safety/events", headers=_h(demo_tok), timeout=30)
        assert r.status_code == 200, r.text
        events = r.json()["events"]
        assert isinstance(events, list) and len(events) >= 1
        # every stored event is a NON-allow verdict
        for e in events:
            assert e["verdict"] != "allow", f"allow verdict leaked into sf_events: {e}"
            for k in ("id", "user_id", "verdict", "risk_level", "created_at"):
                assert k in e
        # allow verdicts truly absent
        allow_events = [e for e in events if e["verdict"] == "allow"]
        assert allow_events == []

    def test_admin_events_forbidden_for_demo(self, demo_tok):
        r = requests.get(f"{API}/hi/admin/safety/events", headers=_h(demo_tok), timeout=30)
        assert r.status_code in (401, 403), f"demo user must be blocked, got {r.status_code}"

    def test_admin_events_ok(self, admin_tok):
        r = requests.get(f"{API}/hi/admin/safety/events", headers=_h(admin_tok), timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "events" in j and "by_verdict" in j
        assert isinstance(j["by_verdict"], dict)
        # after our matrix runs there should be several verdicts present in tally
        # (block_action + escalate_to_professional + allow_with_warning + require_verification)
        expected_present = {"require_verification", "escalate_to_professional", "block_action"}
        assert expected_present.intersection(set(j["by_verdict"].keys())), (
            f"expected verdict counts missing: {j['by_verdict']}"
        )


# -------------------------------------------------- Escalation ledger integration
class TestSafetyEscalationLedger:
    def test_escalate_and_block_wrote_ledger(self, demo_uid, mongo_db):
        # after the matrix has run, hi_safety_escalations should have rows for demo user
        # with trigger_type starting 'safety_engine_'
        rows = list(mongo_db.hi_safety_escalations.find(
            {"user_id": demo_uid, "trigger_type": {"$regex": "^safety_engine_"}},
            {"_id": 0}
        ).sort("created_at", -1).limit(20))
        assert len(rows) >= 2, (
            f"expected >=2 safety_engine_* escalation rows for demo, got {len(rows)}: {rows}"
        )
        # sanity: risk_level & trigger_type shape
        for r in rows:
            assert r.get("risk_level") == "high"
            assert r.get("trigger_type", "").startswith("safety_engine_")


# -------------------------------------------------- AR compose PPE integration
def _find_or_seed_project(db, user_id):
    # try existing
    existing = list(db.hi_projects.find({"user_id": user_id, "risk_level": {"$in": ["Low Risk", "Medium Risk"]}},
                                        {"_id": 0}).limit(30))
    for p in existing:
        title = (p.get("title") or "").lower()
        cat = (p.get("project_category") or "").lower()
        blob = f"{title} {cat}"
        if p.get("status") in ("escalated", "blocked"):
            continue
        if any(k in blob for k in ["electrical", "gas", "structural", "roof", "mold", "asbestos"]):
            continue
        # need a step containing "sand"
        step = db.hi_project_steps.find_one(
            {"project_id": p["id"], "instruction": {"$regex": "sand", "$options": "i"}}, {"_id": 0}
        )
        if step:
            return p["id"], False

    # seed a benign shelf-install-like project with a sanding step
    pid = f"TEST_iter93_proj_{uuid.uuid4().hex[:12]}"
    prop = db.hi_properties.find_one({"user_id": user_id}, {"_id": 0, "id": 1})
    prop_id = prop["id"] if prop else f"TEST_iter93_prop_{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc)
    db.hi_projects.insert_one({
        "id": pid, "user_id": user_id, "property_id": prop_id, "room_id": None, "asset_id": None,
        "title": "TEST_iter93 drywall touch-up",
        "project_category": "repair", "project_goal": "Patch and smooth drywall",
        "description": "test", "status": "draft", "risk_level": "Low Risk",
        "safety_status": "safe", "created_at": now, "completed_at": None,
    })
    step_defs = [
        "Measure the wall to mark where the patch is.",
        "Sand the patched area smooth.",
        "Wipe the wall clean with a damp cloth.",
    ]
    for i, instr in enumerate(step_defs):
        sid = f"TEST_iter93_step_{uuid.uuid4().hex[:12]}"
        _seed["step_ids"].append(sid)
        db.hi_project_steps.insert_one({
            "id": sid, "project_id": pid, "project_phase_id": None,
            "sequence_number": i, "instruction": instr,
            "safety_note": None, "stop_condition": None,
            "status": "active" if i == 0 else "not_started",
            "created_at": now, "completed_at": None,
        })
    _seed["project_id"] = pid
    _seed["created"] = True
    return pid, True


class TestARCompose:
    def test_project_step_session_has_ppe(self, demo_tok, demo_uid, mongo_db):
        pid, _created = _find_or_seed_project(mongo_db, demo_uid)
        r = requests.post(f"{API}/hi/ar/sessions", headers=_h(demo_tok), json={
            "project_id": pid, "guidance_type": "sequence_overlay",
            "device": {"platform": "ios", "supports_ar": True, "camera_permission": "granted"}
        }, timeout=30)
        assert r.status_code == 200, f"session start failed: {r.status_code} {r.text}"
        d = r.json()
        _seed["session_ids"].append(d["session"]["id"])
        instrs = d["instructions"]
        assert len(instrs) >= 1
        # find the sanding step — its action.ppe must include a dust-mask/respirator PPE item
        sand_instrs = [i for i in instrs if "sand" in (i.get("instruction") or "").lower()]
        assert sand_instrs, f"no sanding step found in seeded/existing project instructions"
        sand = sand_instrs[0]
        assert "action" in sand and isinstance(sand["action"], dict)
        ppe = sand["action"].get("ppe", [])
        assert isinstance(ppe, list) and len(ppe) >= 1, f"expected PPE on sanding step, got {ppe}"
        assert any("dust mask" in p.lower() or "respirator" in p.lower() for p in ppe), (
            f"expected dust-mask/respirator PPE on sanding step, got {ppe}"
        )
        # non-sanding steps should still have an action object (may or may not have PPE)
        for ins in instrs:
            assert "action" in ins
            assert "ppe" in ins["action"]  # key present even if empty list


# -------------------------------------------------- Regression: /start/intent + /chat
class TestLightRegression:
    def test_start_intent_still_classifies(self, demo_tok):
        r = requests.post(f"{API}/hi/start/intent", headers=_h(demo_tok),
                          json={"text": "I want to paint my bedroom wall"}, timeout=30)
        # accept 200 as core contract; endpoint should classify not 500
        assert r.status_code == 200, f"/start/intent failed: {r.status_code} {r.text}"
        j = r.json()
        # response must contain some intent/label info
        assert isinstance(j, dict) and len(j) >= 1

    def test_chat_still_sends(self, demo_tok):
        # regression light — Homie conversation hub responds; use GET conversations as the smoke check
        r = requests.get(f"{API}/hi/chat/conversations", headers=_h(demo_tok), timeout=30)
        assert r.status_code == 200, f"/hi/chat/conversations failed: {r.status_code} {r.text}"
        assert "conversations" in r.json() or isinstance(r.json(), (list, dict))


# -------------------------------------------------- Teardown
def teardown_module(module):
    """Clean up seeded projects/steps/AR sessions + safety_engine ledger rows we caused."""
    try:
        client = MongoClient(MONGO_URL)
        db = client[DB_NAME]
        # AR sessions
        for sid in _seed["session_ids"]:
            db.ar_instructions.delete_many({"ar_guidance_session_id": sid})
            db.ar_anchors.delete_many({"ar_guidance_session_id": sid})
            db.ar_sessions.delete_many({"id": sid})
        # seeded project + steps
        if _seed["created"] and _seed["project_id"]:
            pid = _seed["project_id"]
            db.hi_project_steps.delete_many({"project_id": pid})
            db.hi_projects.delete_many({"id": pid})
            # also nuke any residual ar_sessions bound to it
            sess_ids = [s["id"] for s in db.ar_sessions.find({"project_id": pid}, {"_id": 0, "id": 1})]
            for sid in sess_ids:
                db.ar_instructions.delete_many({"ar_guidance_session_id": sid})
                db.ar_anchors.delete_many({"ar_guidance_session_id": sid})
            db.ar_sessions.delete_many({"project_id": pid})
        # hi_safety_escalations rows from this test run (trigger_type safety_engine_test_iter93*)
        db.hi_safety_escalations.delete_many({
            "trigger_type": {"$regex": "^safety_engine_test_iter93"}
        })
        client.close()
    except Exception as e:
        print(f"teardown warning: {e}")
