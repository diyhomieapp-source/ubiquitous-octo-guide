"""Doc 43 safety planning fix + Doc 44 §15 'I'm stuck' recovery flow (iter 94).

Coverage:
- POST /api/hi/safety/evaluate — planning short-circuit for paint color choice + regression matrix
- GET  /api/hi/pi/stuck/options — 8 options with code+label
- POST /api/hi/pi/projects/{pid}/stuck — measurement_mismatch, found_utility (+safety route), bogus code, bogus pid
- Regression: /api/hi/safety/meta still 200
- Cleanup: restore project status + delete pi_stuck_reports rows we created
"""
import os
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "diyhomie")

DEMO = {"email": "demo_home@diyhomie.com", "password": __import__("os").environ.get("TEST_USER_PASSWORD", "")}

_state = {"pid": None, "prev_status": None, "created_report_ids": []}


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
def demo_uid(demo_tok):
    r = requests.get(f"{API}/auth/me", headers=_h(demo_tok), timeout=30)
    assert r.status_code == 200
    return r.json()["id"]


@pytest.fixture(scope="module")
def mongo_db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="module")
def project_id(mongo_db, demo_uid):
    p = mongo_db.hi_projects.find_one({"user_id": demo_uid}, {"_id": 0, "id": 1, "status": 1})
    if not p:
        # seed a lightweight one
        pid = f"TEST_iter94_proj_{datetime.now(timezone.utc).timestamp():.0f}"
        mongo_db.hi_projects.insert_one({
            "id": pid, "user_id": demo_uid, "title": "TEST_iter94 stub",
            "status": "draft", "safety_status": "safe", "risk_level": "Low Risk",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        _state["pid"] = pid
        _state["prev_status"] = "draft"
        _state["seeded"] = True
        return pid
    _state["pid"] = p["id"]
    _state["prev_status"] = p.get("status")
    _state["seeded"] = False
    return p["id"]


# ---------------- Doc 43 safety fix -------------------------------
def _eval(tok, text, **extra):
    body = {"text": text, "source": "test_iter94", **extra}
    r = requests.post(f"{API}/hi/safety/evaluate", headers=_h(tok), json=body, timeout=30)
    assert r.status_code == 200, f"evaluate failed: {r.status_code} {r.text}"
    return r.json()


class TestSafetyPlanningFix:
    def test_paint_color_choice_allow(self, demo_tok):
        v = _eval(demo_tok, "Choose a paint color for the bedroom")
        assert v["verdict"] == "allow", f"expected allow, got {v}"
        assert v["risk_level"] == 0, f"expected 0, got {v['risk_level']}"
        assert v["ppe"] == [], f"expected [], got {v['ppe']}"

    def test_paint_wall_action_still_warned(self, demo_tok):
        v = _eval(demo_tok, "Paint the bedroom wall")
        assert v["verdict"] == "allow_with_warning"
        assert "Ventilation" in v["ppe"]

    def test_sand_drywall_warn(self, demo_tok):
        v = _eval(demo_tok, "Sand the drywall patch")
        assert v["verdict"] == "allow_with_warning"

    def test_drill_wall_verify(self, demo_tok):
        v = _eval(demo_tok, "Drill into the wall to hang a shelf")
        assert v["verdict"] == "require_verification"

    def test_gas_smell_block(self, demo_tok):
        v = _eval(demo_tok, "I smell gas near the stove")
        assert v["verdict"] == "block_action"

    def test_meta_regression(self, demo_tok):
        r = requests.get(f"{API}/hi/safety/meta", headers=_h(demo_tok), timeout=30)
        assert r.status_code == 200


# ---------------- Doc 44 §15 stuck flow ---------------------------
class TestStuckOptions:
    def test_stuck_options_shape(self, demo_tok):
        r = requests.get(f"{API}/hi/pi/stuck/options", headers=_h(demo_tok), timeout=30)
        assert r.status_code == 200, r.text
        opts = r.json()["options"]
        assert isinstance(opts, list) and len(opts) == 8, f"expected 8, got {len(opts)}"
        for o in opts:
            assert "code" in o and "label" in o
        codes = {o["code"] for o in opts}
        for expected in ("measurement_mismatch", "found_utility", "feel_unsafe",
                         "cant_find_part", "route_blocked", "doesnt_fit",
                         "dont_understand", "other"):
            assert expected in codes, f"missing code {expected}"


class TestStuckRouting:
    def test_measurement_mismatch_route(self, demo_tok, project_id, mongo_db):
        r = requests.post(f"{API}/hi/pi/projects/{project_id}/stuck", headers=_h(demo_tok),
                          json={"reason_code": "measurement_mismatch"}, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["route"] == "measurement"
        assert j["guidance"] and j["next_action"]
        assert j["project_status"] != "blocked", f"measurement mismatch must NOT block: {j}"
        # project row still not blocked
        p = mongo_db.hi_projects.find_one({"id": project_id}, {"_id": 0, "status": 1})
        assert p["status"] != "blocked"
        # created a pi_stuck_reports row
        row = mongo_db.pi_stuck_reports.find_one({"project_id": project_id, "reason_code": "measurement_mismatch"},
                                                 sort=[("created_at", -1)])
        assert row is not None
        _state["created_report_ids"].append(row["id"])

    def test_found_utility_safety_route_blocks(self, demo_tok, demo_uid, project_id, mongo_db):
        r = requests.post(f"{API}/hi/pi/projects/{project_id}/stuck", headers=_h(demo_tok),
                          json={"reason_code": "found_utility",
                                "note": "I hit a live electrical wire behind the wall"}, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["route"] == "safety"
        assert j["project_status"] == "blocked", f"safety route must block: {j}"
        assert j.get("safety") is not None, f"safety object missing: {j}"
        for k in ("verdict", "message", "next_action"):
            assert k in j["safety"], f"missing {k} in safety: {j['safety']}"
        # Mongo: pi_stuck_reports row
        row = mongo_db.pi_stuck_reports.find_one({"project_id": project_id, "reason_code": "found_utility"},
                                                 sort=[("created_at", -1)])
        assert row is not None
        _state["created_report_ids"].append(row["id"])
        # sf_events source=stuck_flow
        sf = mongo_db.sf_events.find_one({"user_id": demo_uid, "source": "stuck_flow"},
                                         sort=[("created_at", -1)])
        assert sf is not None, "no sf_events row with source=stuck_flow"
        # project status now blocked
        p = mongo_db.hi_projects.find_one({"id": project_id}, {"_id": 0, "status": 1})
        assert p["status"] == "blocked"

    def test_bogus_reason_400(self, demo_tok, project_id):
        r = requests.post(f"{API}/hi/pi/projects/{project_id}/stuck", headers=_h(demo_tok),
                          json={"reason_code": "not_a_real_code"}, timeout=30)
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"

    def test_bogus_project_404(self, demo_tok):
        r = requests.post(f"{API}/hi/pi/projects/NOT_A_REAL_PID/stuck", headers=_h(demo_tok),
                          json={"reason_code": "measurement_mismatch"}, timeout=30)
        assert r.status_code == 404, f"expected 404, got {r.status_code} {r.text}"


# ---------------- teardown: restore prior status + delete created reports
def teardown_module(module):
    try:
        client = MongoClient(MONGO_URL)
        db = client[DB_NAME]
        if _state["pid"]:
            # restore prior status
            if _state.get("seeded"):
                db.hi_projects.delete_one({"id": _state["pid"]})
            elif _state["prev_status"] is not None:
                db.hi_projects.update_one({"id": _state["pid"]},
                                          {"$set": {"status": _state["prev_status"]}})
        if _state["created_report_ids"]:
            db.pi_stuck_reports.delete_many({"id": {"$in": _state["created_report_ids"]}})
        client.close()
    except Exception as e:
        print(f"teardown warning: {e}")
