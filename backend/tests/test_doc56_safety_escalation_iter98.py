"""
Doc 56 — Safety, Confidence, Stop-Work & Professional Escalation tests (iter98).
Endpoints under /api/hi/safetysys
"""
import os
import time
import pytest
import requests

BASE = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
if not BASE:
    # Fallback per review request context
    BASE = "https://step-by-step-diy.preview.emergentagent.com"

API = f"{BASE}/api"
EMAIL = "demo_home@diyhomie.com"
PW = "Test1234"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PW}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def project_id(headers):
    """Reuse an existing planned project or create a new one."""
    r = requests.get(f"{API}/hi/projects", headers=headers, timeout=20)
    assert r.status_code == 200, r.text
    projects = r.json().get("projects", [])
    # Prefer a project already planned
    for p in projects:
        if p.get("status") in ("planned", "in_progress", "active"):
            return p["id"]
    if projects:
        return projects[0]["id"]
    # Create one otherwise
    r = requests.post(f"{API}/hi/projects", headers=headers, json={"title": "Doc56 Test Project", "notes": "iter98"}, timeout=30)
    assert r.status_code in (200, 201), r.text
    return r.json()["project"]["id"]


# ---------- Checkpoints ----------
class TestCheckpointDefinitions:
    def test_electrical_checkpoint_has_4_items(self, headers):
        r = requests.get(f"{API}/hi/safetysys/checkpoints/electrical", headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["checkpoint_type"] == "electrical"
        assert len(body["items"]) == 4

    def test_unknown_checkpoint_type_404(self, headers):
        r = requests.get(f"{API}/hi/safetysys/checkpoints/nonsense_x", headers=headers, timeout=15)
        assert r.status_code == 404


# ---------- Assessments ----------
class TestAssessments:
    def test_green_informational(self, headers, project_id):
        r = requests.post(f"{API}/hi/safetysys/assessments", headers=headers,
                          json={"project_id": project_id, "task_text": "Roll paint onto the wall"}, timeout=20)
        assert r.status_code == 200, r.text
        a = r.json()["assessment"]
        assert a["risk_color"] == "GREEN"
        assert a["acknowledgment_tier"] == "informational"

    def test_drilling_checkpoint_detected(self, headers, project_id):
        r = requests.post(f"{API}/hi/safetysys/assessments", headers=headers,
                          json={"project_id": project_id, "task_text": "Drill anchor holes into the wall"}, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        a = body["assessment"]
        assert a["checkpoint_type"] == "drilling"
        assert a["acknowledgment_tier"] in ("caution_confirmation", "critical_confirmation")
        assert "checkpoint" in body
        assert len(body["checkpoint"]["items"]) == 4

    def test_gas_red_hard_stop(self, headers, project_id):
        r = requests.post(f"{API}/hi/safetysys/assessments", headers=headers,
                          json={"project_id": project_id, "task_text": "Disconnect the gas line"}, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        a = body["assessment"]
        assert a["risk_color"] == "RED"
        assert a["acknowledgment_tier"] == "hard_stop"
        assert "stop" in body
        assert set(body["stop"]["options"]) == {"rescan", "show_safer_options", "bring_in_pro"}

    def test_missing_project_404(self, headers):
        r = requests.post(f"{API}/hi/safetysys/assessments", headers=headers,
                          json={"project_id": "does-not-exist", "task_text": "paint"}, timeout=15)
        assert r.status_code == 404


# ---------- Acknowledge ----------
class TestAcknowledge:
    def _mk_caution(self, headers, project_id):
        r = requests.post(f"{API}/hi/safetysys/assessments", headers=headers,
                          json={"project_id": project_id, "task_text": "Drill anchor holes into the wall"}, timeout=20)
        return r.json()["assessment"]["id"]

    def _mk_red(self, headers, project_id):
        r = requests.post(f"{API}/hi/safetysys/assessments", headers=headers,
                          json={"project_id": project_id, "task_text": "Disconnect the gas line"}, timeout=20)
        return r.json()["assessment"]["id"]

    def test_hard_stop_ack_returns_409(self, headers, project_id):
        aid = self._mk_red(headers, project_id)
        r = requests.post(f"{API}/hi/safetysys/assessments/{aid}/acknowledge", headers=headers,
                          json={"confirmed": True}, timeout=15)
        assert r.status_code == 409

    def test_caution_ack_confirmed_unlocks(self, headers, project_id):
        aid = self._mk_caution(headers, project_id)
        r = requests.post(f"{API}/hi/safetysys/assessments/{aid}/acknowledge", headers=headers,
                          json={"confirmed": True}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("unlocked") is True

    def test_caution_ack_not_confirmed_returns_ok_false(self, headers, project_id):
        aid = self._mk_caution(headers, project_id)
        r = requests.post(f"{API}/hi/safetysys/assessments/{aid}/acknowledge", headers=headers,
                          json={"confirmed": False}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is False


# ---------- Override ----------
class TestOverride:
    def _mk(self, headers, project_id, text):
        r = requests.post(f"{API}/hi/safetysys/assessments", headers=headers,
                          json={"project_id": project_id, "task_text": text}, timeout=20)
        return r.json()["assessment"]

    def test_red_override_409(self, headers, project_id):
        a = self._mk(headers, project_id, "Disconnect the gas line")
        r = requests.post(f"{API}/hi/safetysys/assessments/{a['id']}/override", headers=headers,
                          json={"reason": "I know what I'm doing"}, timeout=15)
        assert r.status_code == 409

    def test_override_empty_reason_400(self, headers, project_id):
        a = self._mk(headers, project_id, "Drill anchor holes into the wall")
        # yellow/orange
        assert a["risk_color"] in ("YELLOW", "ORANGE", "GREEN")
        r = requests.post(f"{API}/hi/safetysys/assessments/{a['id']}/override", headers=headers,
                          json={"reason": ""}, timeout=15)
        # If green there is no gate but Doc 56 spec still requires reason for override
        assert r.status_code == 400

    def test_override_with_reason_recorded(self, headers, project_id):
        a = self._mk(headers, project_id, "Drill anchor holes into the wall")
        r = requests.post(f"{API}/hi/safetysys/assessments/{a['id']}/override", headers=headers,
                          json={"reason": "Stud finder + no wiring; verified twice."}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body["override"]["user_reason"].startswith("Stud finder")


# ---------- Checkpoints POST ----------
class TestCheckpointSubmit:
    def test_partial_checked_items_not_unlocked(self, headers, project_id):
        # get definition
        d = requests.get(f"{API}/hi/safetysys/checkpoints/drilling", headers=headers).json()
        items = d["items"]
        r = requests.post(f"{API}/hi/safetysys/checkpoints", headers=headers,
                          json={"project_id": project_id, "checkpoint_type": "drilling",
                                "checked_items": items[:2]}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["unlocked"] is False
        assert len(body["missing"]) == 2

    def test_all_items_unlocked_true(self, headers, project_id):
        d = requests.get(f"{API}/hi/safetysys/checkpoints/drilling", headers=headers).json()
        items = d["items"]
        r = requests.post(f"{API}/hi/safetysys/checkpoints", headers=headers,
                          json={"project_id": project_id, "checkpoint_type": "drilling",
                                "checked_items": items}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["unlocked"] is True
        assert body["missing"] == []


# ---------- History ----------
class TestHistory:
    def test_history_aggregates_and_sorted(self, headers, project_id):
        r = requests.get(f"{API}/hi/safetysys/projects/{project_id}/history", headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        assert isinstance(items, list)
        assert len(items) >= 1
        types = {it["type"] for it in items}
        # We've created assessments + checkpoints + overrides above
        assert "assessment" in types
        # Sort desc
        ats = [it["at"] for it in items]
        assert ats == sorted(ats, reverse=True)


# ---------- Urgent ----------
class TestUrgent:
    def test_urgent_gas(self, headers, project_id):
        r = requests.post(f"{API}/hi/safetysys/urgent", headers=headers,
                          json={"project_id": project_id, "task_text": "I smell gas"}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["urgent"] is True
        assert body["category"] == "gas"

    def test_urgent_benign(self, headers, project_id):
        r = requests.post(f"{API}/hi/safetysys/urgent", headers=headers,
                          json={"project_id": project_id, "task_text": "hang a picture frame"}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["urgent"] is False
