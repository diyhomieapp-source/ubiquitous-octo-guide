"""
Backend regression tests for Doc 47 (Guidance Runtime Engine) and
Doc 48 (Pro-Connect Engine).
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://step-by-step-diy.preview.emergentagent.com").rstrip("/")
USER_EMAIL = "demo_home@diyhomie.com"
USER_PW = "Test1234"
ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PW = "diyhomie1122"


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("token") or data.get("access_token")
    assert token, f"no token in login response: {data}"
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def user_sess():
    return _login(USER_EMAIL, USER_PW)


@pytest.fixture(scope="module")
def admin_sess():
    return _login(ADMIN_EMAIL, ADMIN_PW)


# ================================================================ Doc 47 Guidance
class TestGuidanceProcedures:
    def test_list_procedures(self, user_sess):
        r = user_sess.get(f"{BASE_URL}/api/hi/guide/procedures", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "procedures" in data and "open_sessions" in data
        ids = {p["id"] for p in data["procedures"]}
        assert {"paint_wall_v1", "toilet_replace_v1", "balloon_dog_v1"}.issubset(ids)

    def test_get_procedure_has_spoken(self, user_sess):
        r = user_sess.get(f"{BASE_URL}/api/hi/guide/procedures/balloon_dog_v1", timeout=30)
        assert r.status_code == 200
        data = r.json()
        proc = data["procedure"]
        assert proc["id"] == "balloon_dog_v1"
        assert proc["steps"] and "spoken" in proc["steps"][0]
        assert data["skill_level"] in ("beginner", "intermediate", "advanced")

    def test_meta(self, user_sess):
        r = user_sess.get(f"{BASE_URL}/api/hi/guide/meta", timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("modes", "verification_states", "visual_vocabulary", "fine_motor_primitives"):
            assert k in d and d[k]


class TestGuidanceSession:
    session_id = None
    completed_step = None

    def test_start_session(self, user_sess):
        r = user_sess.post(f"{BASE_URL}/api/hi/guide/sessions",
                           json={"procedure_id": "balloon_dog_v1"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["session"]["procedure_id"] == "balloon_dog_v1"
        TestGuidanceSession.session_id = d["session"]["id"]

    def test_step_events(self, user_sess):
        sid = TestGuidanceSession.session_id
        step = "inflate"
        # show_again
        r = user_sess.post(f"{BASE_URL}/api/hi/guide/sessions/{sid}/steps/{step}/event",
                           json={"event": "show_again"}, timeout=30)
        assert r.status_code == 200 and r.json().get("visual")
        # slow_down
        r = user_sess.post(f"{BASE_URL}/api/hi/guide/sessions/{sid}/steps/{step}/event",
                           json={"event": "slow_down"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["visual"]["speed"] in ("SLOW", "SLOWEST")
        # another_angle flips camera
        r = user_sess.post(f"{BASE_URL}/api/hi/guide/sessions/{sid}/steps/{step}/event",
                           json={"event": "another_angle"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["visual"]["cameraView"] in ("OVERHEAD", "FIRST_PERSON")
        # why
        r = user_sess.post(f"{BASE_URL}/api/hi/guide/sessions/{sid}/steps/{step}/event",
                           json={"event": "why"}, timeout=30)
        assert r.status_code == 200 and r.json().get("message")
        # what_tool
        r = user_sess.post(f"{BASE_URL}/api/hi/guide/sessions/{sid}/steps/{step}/event",
                           json={"event": "what_tool"}, timeout=30)
        assert r.status_code == 200
        # im_stuck returns options
        r = user_sess.post(f"{BASE_URL}/api/hi/guide/sessions/{sid}/steps/{step}/event",
                           json={"event": "im_stuck"}, timeout=30)
        assert r.status_code == 200
        assert "options" in r.json()

    def test_target_detected_thresholds(self, user_sess):
        sid = TestGuidanceSession.session_id
        step = "inflate"
        cases = [(0.9, "acquired"), (0.65, "candidate"), (0.2, "lost")]
        for conf, expected in cases:
            r = user_sess.post(f"{BASE_URL}/api/hi/guide/sessions/{sid}/steps/{step}/event",
                               json={"event": "target_detected", "confidence": conf}, timeout=30)
            assert r.status_code == 200
            assert r.json().get("target_state") == expected, f"conf={conf} got={r.json()}"

    def test_verify_needs_review_no_advance(self, user_sess):
        sid = TestGuidanceSession.session_id
        r = user_sess.post(f"{BASE_URL}/api/hi/guide/sessions/{sid}/steps/inflate/verify",
                           json={"method": "user_confirmation", "confirmed": False}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["verification"]["state"] == "NEEDS_REVIEW"
        assert d["advanced"] is False

    def test_verify_visual_cannot_verify(self, user_sess):
        sid = TestGuidanceSession.session_id
        r = user_sess.post(f"{BASE_URL}/api/hi/guide/sessions/{sid}/steps/inflate/verify",
                           json={"method": "visual", "confidence": 0.3}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["verification"]["state"] == "CANNOT_VERIFY"
        assert d.get("ask_confirmation") is True

    def test_verify_visual_verified(self, user_sess):
        sid = TestGuidanceSession.session_id
        r = user_sess.post(f"{BASE_URL}/api/hi/guide/sessions/{sid}/steps/inflate/verify",
                           json={"method": "visual", "confidence": 0.9}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["verification"]["state"] == "VERIFIED"
        assert d["advanced"] is True
        TestGuidanceSession.completed_step = "inflate"

    def test_resume_returns_welcome_back(self, user_sess):
        # start again with same procedure -> resumed with welcome_back
        r = user_sess.post(f"{BASE_URL}/api/hi/guide/sessions",
                           json={"procedure_id": "balloon_dog_v1"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d.get("resumed") is True
        assert d.get("welcome_back")
        assert d["session"]["id"] == TestGuidanceSession.session_id

    def test_complete_all_steps(self, user_sess):
        """Advance session to completed by user_confirmation."""
        sid = TestGuidanceSession.session_id
        r = user_sess.get(f"{BASE_URL}/api/hi/guide/sessions/{sid}", timeout=30)
        assert r.status_code == 200
        proc = r.json()["procedure"]
        session = r.json()["session"]
        idx = session["current_step_index"]
        steps = proc["steps"]
        last_payload = None
        for s in steps[idx:]:
            r = user_sess.post(f"{BASE_URL}/api/hi/guide/sessions/{sid}/steps/{s['stepId']}/verify",
                               json={"method": "user_confirmation", "confirmed": True}, timeout=30)
            assert r.status_code == 200, f"step {s['stepId']} failed: {r.text}"
            last_payload = r.json()
        assert last_payload.get("completed") is True
        # verify session status now completed
        r = user_sess.get(f"{BASE_URL}/api/hi/guide/sessions/{sid}", timeout=30)
        assert r.json()["session"]["status"] == "completed"


class TestGuidancePrefs:
    def test_get_prefs(self, user_sess):
        r = user_sess.get(f"{BASE_URL}/api/hi/guide/preferences", timeout=30)
        assert r.status_code == 200
        assert "preferences" in r.json()

    def test_skill_level_affects_spoken(self, user_sess):
        for level in ("beginner", "advanced"):
            r = user_sess.put(f"{BASE_URL}/api/hi/guide/preferences",
                              json={"skill_level": level}, timeout=30)
            assert r.status_code == 200
            assert r.json()["preferences"]["skill_level"] == level
            r = user_sess.get(f"{BASE_URL}/api/hi/guide/procedures/balloon_dog_v1", timeout=30)
            spoken = r.json()["procedure"]["steps"][0]["spoken"]
            assert spoken, f"empty spoken for skill={level}"
        # reset
        user_sess.put(f"{BASE_URL}/api/hi/guide/preferences", json={"skill_level": "beginner"}, timeout=30)


# ================================================================ Doc 48 Pro-Connect
class TestProConnectSupport:
    def test_support_with_demos(self, user_sess):
        r = user_sess.get(f"{BASE_URL}/api/hi/proconnect/support",
                          params={"procedure_id": "toilet_replace_v1", "step_id": "close_shutoff"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert any(d0["creator_id"] == "creator_lena" for d0 in d["demos"])

    def test_support_with_insight_attribution(self, user_sess):
        r = user_sess.get(f"{BASE_URL}/api/hi/proconnect/support",
                          params={"procedure_id": "toilet_replace_v1", "step_id": "reconnect_supply"}, timeout=30)
        assert r.status_code == 200
        insights = r.json()["insights"]
        assert insights and insights[0].get("attribution")

    def test_view_and_save_demo(self, user_sess):
        r = user_sess.post(f"{BASE_URL}/api/hi/proconnect/demos/demo_shutoff/view", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "mock://" in d["clip_url"]
        assert d.get("note")
        # save toggle
        r = user_sess.post(f"{BASE_URL}/api/hi/proconnect/demos/demo_shutoff/save", timeout=30)
        assert r.status_code == 200 and r.json()["saved"] is True
        r = user_sess.get(f"{BASE_URL}/api/hi/proconnect/saved", timeout=30)
        assert any(x["id"] == "demo_shutoff" for x in r.json()["demos"])
        # toggle off
        r = user_sess.post(f"{BASE_URL}/api/hi/proconnect/demos/demo_shutoff/save", timeout=30)
        assert r.json()["saved"] is False


class TestCreators:
    def test_creator_profile(self, user_sess):
        r = user_sess.get(f"{BASE_URL}/api/hi/proconnect/creators/creator_lena", timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("creator", "demos", "insights", "featured_procedures"):
            assert k in d

    def test_follow_toggle(self, user_sess):
        r = user_sess.post(f"{BASE_URL}/api/hi/proconnect/creators/creator_lena/follow", timeout=30)
        assert r.status_code == 200
        s1 = r.json()["following"]
        r = user_sess.post(f"{BASE_URL}/api/hi/proconnect/creators/creator_lena/follow", timeout=30)
        assert r.json()["following"] != s1


class TestBriefsAndRequests:
    brief_id = None
    request_id = None

    def test_create_brief_from_session(self, user_sess):
        # start fresh session so we have context
        s = user_sess.post(f"{BASE_URL}/api/hi/guide/sessions",
                           json={"procedure_id": "paint_wall_v1"}, timeout=30).json()
        sid = s["session"]["id"]
        # complete one step for steps_completed content
        user_sess.post(f"{BASE_URL}/api/hi/guide/sessions/{sid}/steps/scan_wall/verify",
                       json={"method": "user_confirmation", "confirmed": True}, timeout=30)
        r = user_sess.post(f"{BASE_URL}/api/hi/proconnect/briefs",
                           json={"session_id": sid, "question": "TEST brief for painting"}, timeout=30)
        assert r.status_code == 200
        b = r.json()["brief"]
        for k in ("project_name", "current_task", "steps_completed", "steps_remaining", "identified_risks", "materials_tools", "home_context"):
            assert k in b, f"missing brief key {k}"
        assert len(b["steps_completed"]) >= 1
        TestBriefsAndRequests.brief_id = b["id"]

    def test_get_brief(self, user_sess):
        r = user_sess.get(f"{BASE_URL}/api/hi/proconnect/briefs/{TestBriefsAndRequests.brief_id}", timeout=30)
        assert r.status_code == 200
        assert r.json()["brief"]["id"] == TestBriefsAndRequests.brief_id

    def test_create_request_valid_types(self, user_sess):
        for atype in ("quick_question", "get_quotes"):
            r = user_sess.post(f"{BASE_URL}/api/hi/proconnect/requests",
                               json={"brief_id": TestBriefsAndRequests.brief_id,
                                     "assistance_type": atype}, timeout=30)
            assert r.status_code == 200, r.text
            req = r.json()["request"]
            assert req["status"] == "submitted"
            if atype == "quick_question":
                TestBriefsAndRequests.request_id = req["id"]

    def test_create_request_invalid_type(self, user_sess):
        r = user_sess.post(f"{BASE_URL}/api/hi/proconnect/requests",
                           json={"brief_id": TestBriefsAndRequests.brief_id,
                                 "assistance_type": "bogus_type"}, timeout=30)
        assert r.status_code == 400

    def test_list_requests_and_cancel(self, user_sess):
        r = user_sess.get(f"{BASE_URL}/api/hi/proconnect/requests", timeout=30)
        assert r.status_code == 200
        assert any(x["id"] == TestBriefsAndRequests.request_id for x in r.json()["requests"])
        r = user_sess.post(f"{BASE_URL}/api/hi/proconnect/requests/{TestBriefsAndRequests.request_id}/cancel", timeout=30)
        assert r.status_code == 200


class TestScopeSplit:
    def test_scope_classification(self, user_sess):
        r = user_sess.get(f"{BASE_URL}/api/hi/proconnect/scope",
                          params={"procedure_id": "toilet_replace_v1"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        buckets = {s["bucket"] for s in d["steps"]}
        assert "diy_friendly" in buckets
        # toilet_replace has safety_notes so should include professional_recommended
        assert "professional_recommended" in buckets or "professional_required" in buckets

    def test_scope_save_and_return(self, user_sess):
        payload = {"procedure_id": "toilet_replace_v1", "selection": "help_specific_parts",
                   "pro_step_ids": ["close_shutoff", "leak_check"]}
        r = user_sess.put(f"{BASE_URL}/api/hi/proconnect/scope", json=payload, timeout=30)
        assert r.status_code == 200
        r = user_sess.get(f"{BASE_URL}/api/hi/proconnect/scope",
                          params={"procedure_id": "toilet_replace_v1"}, timeout=30)
        saved = r.json()["saved_scope"]
        assert saved and saved["selection"] == "help_specific_parts"
        assert set(saved["pro_step_ids"]) == {"close_shutoff", "leak_check"}

    def test_scope_invalid_selection(self, user_sess):
        r = user_sess.put(f"{BASE_URL}/api/hi/proconnect/scope",
                          json={"procedure_id": "toilet_replace_v1", "selection": "bad"}, timeout=30)
        assert r.status_code == 400


class TestAdminProConnect:
    def test_admin_list_requests(self, admin_sess):
        r = admin_sess.get(f"{BASE_URL}/api/hi/admin/proconnect/requests", timeout=30)
        assert r.status_code == 200
        assert "requests" in r.json()

    def test_admin_status_flow(self, admin_sess, user_sess):
        # create fresh brief+request as user
        b = user_sess.post(f"{BASE_URL}/api/hi/proconnect/briefs",
                           json={"procedure_id": "paint_wall_v1", "question": "TEST admin flow"}, timeout=30).json()["brief"]
        req = user_sess.post(f"{BASE_URL}/api/hi/proconnect/requests",
                             json={"brief_id": b["id"], "assistance_type": "remote_review"}, timeout=30).json()["request"]
        rid = req["id"]
        for status in ("matched", "in_progress", "completed"):
            r = admin_sess.put(f"{BASE_URL}/api/hi/admin/proconnect/requests/{rid}/status",
                               json={"status": status}, timeout=30)
            assert r.status_code == 200, f"status {status} failed: {r.text}"
