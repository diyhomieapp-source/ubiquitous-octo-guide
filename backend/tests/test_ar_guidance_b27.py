"""B27 — AR Step-by-Step Visual Guidance Runtime tests"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

USER = {"email": "demo_home@diyhomie.com", "password": __import__("os").environ.get("TEST_USER_PASSWORD", "")}
ADMIN = {"email": "Diyhomieapp@gmail.com", "password": __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")}


def _login(payload):
    r = requests.post(f"{API}/auth/login", json=payload, timeout=30)
    assert r.status_code == 200, f"Login failed for {payload['email']}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def user_tok():
    return _login(USER)


@pytest.fixture(scope="module")
def admin_tok():
    return _login(ADMIN)


def h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ------------------------------ Eligibility
class TestEligibility:
    def test_web_platform_limited(self, user_tok):
        r = requests.post(f"{API}/hi/ar/eligibility", headers=h(user_tok), json={
            "guidance_type": "placement_marker",
            "device": {"platform": "web", "supports_ar": False, "camera_permission": "undetermined"}
        }, timeout=30)
        assert r.status_code == 200, r.text
        e = r.json()["eligibility"]
        assert e["status"] == "LIMITED"
        assert e["fallback"] == "2d"

    def test_ios_no_room_estimated(self, user_tok):
        r = requests.post(f"{API}/hi/ar/eligibility", headers=h(user_tok), json={
            "guidance_type": "placement_marker",
            "device": {"platform": "ios", "supports_ar": True, "camera_permission": "granted"}
        }, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        e = j["eligibility"]
        # No room -> LIMITED estimated true, context populated
        assert e["status"] in ("LIMITED", "AVAILABLE")
        assert e["estimated"] is True
        assert j["context"] is not None

    def test_context_populated_on_available(self, user_tok):
        r = requests.post(f"{API}/hi/ar/eligibility", headers=h(user_tok), json={
            "guidance_type": "orientation_marker",
            "device": {"platform": "ios", "supports_ar": True, "camera_permission": "granted"}
        }, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert j["eligibility"]["status"] in ("AVAILABLE", "LIMITED")
        assert j["context"] is not None


# ------------------------------ Safety Gating (uses existing seeded projects)
def _find_project(tok, needle):
    # Use hi/projects list endpoint
    r = requests.get(f"{API}/hi/projects", headers=h(tok), timeout=30)
    if r.status_code != 200:
        return None
    for p in (r.json() if isinstance(r.json(), list) else r.json().get("projects", [])):
        if needle.lower() in (p.get("title") or "").lower():
            return p
    return None


class TestSafety:
    def test_professional_required_electrical(self, user_tok):
        p = _find_project(user_tok, "electrical panel")
        if not p:
            pytest.skip("no seeded electrical project")
        pid = p["id"]
        er = requests.post(f"{API}/hi/ar/eligibility", headers=h(user_tok), json={
            "project_id": pid, "guidance_type": "sequence_overlay",
            "device": {"platform": "ios", "supports_ar": True, "camera_permission": "granted"}
        }, timeout=30)
        assert er.status_code == 200
        e = er.json()["eligibility"]
        assert e["status"] == "PROFESSIONAL_REQUIRED", e
        assert e["fallback"] == "professional"

        # Session must 409
        sr = requests.post(f"{API}/hi/ar/sessions", headers=h(user_tok), json={
            "project_id": pid, "guidance_type": "sequence_overlay",
            "device": {"platform": "ios", "supports_ar": True, "camera_permission": "granted"}
        }, timeout=30)
        assert sr.status_code == 409, sr.text
        payload = sr.json().get("detail")
        assert isinstance(payload, dict) and payload.get("eligibility", {}).get("status") == "PROFESSIONAL_REQUIRED"

    def test_low_risk_available(self, user_tok):
        p = _find_project(user_tok, "floating shelf")
        if not p:
            pytest.skip("no seeded floating shelf project")
        pid = p["id"]
        er = requests.post(f"{API}/hi/ar/eligibility", headers=h(user_tok), json={
            "project_id": pid, "guidance_type": "sequence_overlay",
            "device": {"platform": "ios", "supports_ar": True, "camera_permission": "granted"}
        }, timeout=30)
        assert er.status_code == 200
        e = er.json()["eligibility"]
        assert e["status"] in ("AVAILABLE", "LIMITED"), e
        # start session — should succeed and build instructions from steps
        sr = requests.post(f"{API}/hi/ar/sessions", headers=h(user_tok), json={
            "project_id": pid, "guidance_type": "sequence_overlay",
            "device": {"platform": "ios", "supports_ar": True, "camera_permission": "granted"}
        }, timeout=30)
        assert sr.status_code == 200, sr.text
        j = sr.json()
        assert len(j["instructions"]) >= 1
        # verify project_step_id link populated (if project has steps)
        # cleanup — cancel
        requests.post(f"{API}/hi/ar/sessions/{j['session']['id']}/cancel", headers=h(user_tok),
                      json={"result": "user_cancelled"}, timeout=30)


# ------------------------------ Session Lifecycle
class TestSessionLifecycle:
    @pytest.fixture(scope="class")
    def sid(self, user_tok):
        r = requests.post(f"{API}/hi/ar/sessions", headers=h(user_tok), json={
            "guidance_type": "orientation_marker",
            "device": {"platform": "ios", "supports_ar": True, "camera_permission": "granted"}
        }, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["session"]["status"] == "created"
        assert isinstance(d["instructions"], list) and len(d["instructions"]) >= 1
        assert "controls" in d and "show_text" in d["controls"]
        return d["session"]["id"], d["instructions"][0]["id"]

    def test_list_and_get(self, user_tok, sid):
        s_id, _ = sid
        r = requests.get(f"{API}/hi/ar/sessions", headers=h(user_tok), timeout=30)
        assert r.status_code == 200
        assert any(x["id"] == s_id for x in r.json()["sessions"])
        r2 = requests.get(f"{API}/hi/ar/sessions/{s_id}", headers=h(user_tok), timeout=30)
        assert r2.status_code == 200
        j = r2.json()
        assert j["session"]["id"] == s_id
        assert len(j["instructions"]) >= 1

    def test_calibrate_and_confirm(self, user_tok, sid):
        s_id, i_id = sid
        r = requests.post(f"{API}/hi/ar/sessions/{s_id}/calibrate", headers=h(user_tok),
                          json={"anchor_confirmed": True}, timeout=30)
        assert r.status_code == 200 and r.json()["status"] == "active"

        r = requests.post(f"{API}/hi/ar/sessions/{s_id}/instructions/{i_id}/confirm",
                          headers=h(user_tok), timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert j["ok"] is True and "remaining" in j and "all_confirmed" in j

    def test_pause_resume_recenter(self, user_tok, sid):
        s_id, _ = sid
        assert requests.post(f"{API}/hi/ar/sessions/{s_id}/pause", headers=h(user_tok), timeout=30).status_code == 200
        assert requests.post(f"{API}/hi/ar/sessions/{s_id}/resume", headers=h(user_tok), timeout=30).status_code == 200
        assert requests.post(f"{API}/hi/ar/sessions/{s_id}/recenter", headers=h(user_tok), timeout=30).status_code == 200

    def test_report_tracking_sets_paused(self, user_tok, sid):
        s_id, _ = sid
        r = requests.post(f"{API}/hi/ar/sessions/{s_id}/report-tracking", headers=h(user_tok),
                          json={"reason": "lost anchor"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["fallback"] == "2d"
        # verify session paused
        r2 = requests.get(f"{API}/hi/ar/sessions/{s_id}", headers=h(user_tok), timeout=30)
        assert r2.json()["session"]["status"] == "paused"

    def test_fallback(self, user_tok, sid):
        s_id, _ = sid
        r = requests.post(f"{API}/hi/ar/sessions/{s_id}/fallback", headers=h(user_tok),
                          json={"to": "text"}, timeout=30)
        assert r.status_code == 200 and r.json()["to"] == "text"

    def test_complete_no_change(self, user_tok, sid):
        s_id, _ = sid
        r = requests.post(f"{API}/hi/ar/sessions/{s_id}/complete", headers=h(user_tok),
                          json={"work_item_confirmed": False}, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert j["ok"] is True and j["work_item_updated"] is False

    def test_calibrate_failure(self, user_tok):
        # New session for failure test
        r = requests.post(f"{API}/hi/ar/sessions", headers=h(user_tok), json={
            "guidance_type": "orientation_marker",
            "device": {"platform": "ios", "supports_ar": True, "camera_permission": "granted"}
        }, timeout=30)
        s_id = r.json()["session"]["id"]
        cr = requests.post(f"{API}/hi/ar/sessions/{s_id}/calibrate", headers=h(user_tok),
                           json={"anchor_confirmed": False}, timeout=30)
        assert cr.status_code == 200
        assert cr.json()["status"] == "failed"
        # get session shows outcome insufficient_tracking
        gr = requests.get(f"{API}/hi/ar/sessions/{s_id}", headers=h(user_tok), timeout=30)
        assert gr.json()["outcome"]["result"] == "insufficient_tracking"

    def test_skip_and_cancel(self, user_tok):
        r = requests.post(f"{API}/hi/ar/sessions", headers=h(user_tok), json={
            "guidance_type": "placement_marker",
            "device": {"platform": "ios", "supports_ar": True, "camera_permission": "granted"}
        }, timeout=30)
        j = r.json()
        s_id = j["session"]["id"]; i_id = j["instructions"][0]["id"]
        sr = requests.post(f"{API}/hi/ar/sessions/{s_id}/instructions/{i_id}/skip", headers=h(user_tok), timeout=30)
        assert sr.status_code == 200
        cr = requests.post(f"{API}/hi/ar/sessions/{s_id}/cancel", headers=h(user_tok),
                           json={"result": "user_cancelled"}, timeout=30)
        assert cr.status_code == 200


# ------------------------------ Admin
class TestAdmin:
    def test_dashboard(self, admin_tok):
        r = requests.get(f"{API}/hi/admin/ar/dashboard", headers=h(admin_tok), timeout=30)
        assert r.status_code == 200
        j = r.json()
        for k in ("total_sessions", "by_status", "by_result", "completion_rate", "tracking_failures", "settings"):
            assert k in j

    def test_toggle_feature_off_then_on(self, admin_tok, user_tok):
        # off
        r = requests.put(f"{API}/hi/admin/ar/settings", headers=h(admin_tok),
                         json={"feature_enabled": False}, timeout=30)
        assert r.status_code == 200 and r.json()["feature_enabled"] is False
        er = requests.post(f"{API}/hi/ar/eligibility", headers=h(user_tok), json={
            "device": {"platform": "ios", "supports_ar": True, "camera_permission": "granted"}
        }, timeout=30)
        assert er.status_code == 200
        assert er.json()["eligibility"]["status"] == "UNAVAILABLE"
        # restore
        r2 = requests.put(f"{API}/hi/admin/ar/settings", headers=h(admin_tok),
                          json={"feature_enabled": True}, timeout=30)
        assert r2.status_code == 200 and r2.json()["feature_enabled"] is True

    def test_platform_toggle(self, admin_tok):
        r = requests.put(f"{API}/hi/admin/ar/platforms", headers=h(admin_tok),
                        json={"platform": "web", "enabled": True}, timeout=30)
        assert r.status_code == 200
        assert r.json()["platforms"].get("web") is True
        # restore to default false
        requests.put(f"{API}/hi/admin/ar/platforms", headers=h(admin_tok),
                     json={"platform": "web", "enabled": False}, timeout=30)

    def test_guidance_type_toggle(self, admin_tok):
        r = requests.put(f"{API}/hi/admin/ar/guidance-types", headers=h(admin_tok),
                         json={"guidance_type": "inspection_marker", "disabled": True}, timeout=30)
        assert r.status_code == 200
        assert "inspection_marker" in r.json()["disabled_guidance_types"]
        # restore
        requests.put(f"{API}/hi/admin/ar/guidance-types", headers=h(admin_tok),
                     json={"guidance_type": "inspection_marker", "disabled": False}, timeout=30)

    def test_non_admin_forbidden(self, user_tok):
        endpoints = [
            ("GET", "/hi/admin/ar/dashboard", None),
            ("GET", "/hi/admin/ar/settings", None),
            ("PUT", "/hi/admin/ar/settings", {"feature_enabled": True}),
            ("PUT", "/hi/admin/ar/platforms", {"platform": "web", "enabled": False}),
            ("PUT", "/hi/admin/ar/guidance-types", {"guidance_type": "sequence_overlay", "disabled": False}),
        ]
        for m, path, body in endpoints:
            if m == "GET":
                r = requests.get(f"{API}{path}", headers=h(user_tok), timeout=30)
            else:
                r = requests.put(f"{API}{path}", headers=h(user_tok), json=body, timeout=30)
            assert r.status_code == 403, f"{path} expected 403 got {r.status_code} {r.text[:100]}"
