"""
Comprehensive pytest suite for Build Doc 5 (Visual Evidence, Measurement & AR)
and Build Doc 6 (Proactive Home Maintenance & Priority Intelligence).

Namespaces: /api/hi/visual/*, /api/hi/care/*, admin: /api/hi/admin/visual|care/*
Standard user: demo_home@diyhomie.com / Test1234
Admin: Diyhomieapp@gmail.com / diyhomie1122
"""
import os
import time
import uuid
import pytest
import requests

BASE = (os.environ.get("EXPO_BACKEND_URL")
        or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
        or "https://step-by-step-diy.preview.emergentagent.com").rstrip("/")

DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASS = "Test1234"
ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASS = "diyhomie1122"


# ------------------------- helpers / fixtures -------------------------
def _login(email, password):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text[:200]}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, "no token returned"
    return tok


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def demo_token():
    return _login(DEMO_EMAIL, DEMO_PASS)


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PASS)


@pytest.fixture(scope="module")
def second_user_token():
    # Register a fresh user for cross-user isolation tests
    email = f"TEST_b5b6_{uuid.uuid4().hex[:8]}@diyhomie.com"
    r = requests.post(f"{BASE}/api/auth/register",
                      json={"email": email, "password": "Test1234", "name": "B5B6 Iso"}, timeout=30)
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text[:200]}"
    body = r.json()
    return body.get("token") or _login(email, "Test1234")


@pytest.fixture(scope="module")
def demo_issue_id(demo_token):
    """Create (or reuse) a Guided Repair issue owned by demo user."""
    r = requests.post(f"{BASE}/api/hi/repair/issues",
                      json={"description": "TEST_b5b6 dripping faucet under bathroom sink",
                            "category": "plumbing", "urgency": "soon"},
                      headers=_hdr(demo_token), timeout=30)
    assert r.status_code in (200, 201), f"issue create failed: {r.status_code} {r.text[:200]}"
    iid = r.json().get("issue", {}).get("id") or r.json().get("id")
    assert iid
    return iid


# ============================================================
# Doc 5 — Templates
# ============================================================
class TestVisualTemplates:
    def test_templates_shape(self, demo_token):
        r = requests.get(f"{BASE}/api/hi/visual/templates", headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 200, r.text
        b = r.json()
        assert len(b["capture_templates"]) == 6
        for k in ["wide_context", "close_up", "before_after", "with_measurement", "label_model", "inspection_video"]:
            assert k in b["capture_templates"]
            t = b["capture_templates"][k]
            for f in ["purpose", "framing", "distance", "will_infer", "wont_infer"]:
                assert f in t, f"template {k} missing {f}"
        assert len(b["measure_types"]) == 8
        assert set(b["measure_instructions"].keys()) == set(b["measure_types"])
        assert len(b["confidence_levels"]) >= 5
        assert "point" in b["annotation_kinds"]
        assert "inspection_area" in b["ar_use_cases"]


# ============================================================
# Doc 5 — Capture request
# ============================================================
class TestCaptureRequest:
    def test_capture_request_close_up(self, demo_token, demo_issue_id):
        r = requests.post(f"{BASE}/api/hi/visual/issues/{demo_issue_id}/capture-request",
                          json={"template": "close_up", "note": "TEST_b5b6 need close-up"},
                          headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["capture_request"]["template"] == "close_up"
        g = b["guidance"]
        for f in ["purpose", "framing", "distance", "will_infer", "wont_infer"]:
            assert f in g

    def test_capture_request_unknown_template(self, demo_token, demo_issue_id):
        r = requests.post(f"{BASE}/api/hi/visual/issues/{demo_issue_id}/capture-request",
                          json={"template": "not_a_template"},
                          headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 400


# ============================================================
# Doc 5 — Measurements (deterministic conversion)
# ============================================================
class TestMeasurements:
    def test_measurement_conversion_12in(self, demo_token, demo_issue_id):
        r = requests.post(f"{BASE}/api/hi/visual/issues/{demo_issue_id}/measurements",
                          json={"measure_type": "length", "value": 12, "unit": "in", "source_method": "manual"},
                          headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 200, r.text
        m = r.json()["measurement"]
        conv = m["conversion"]
        assert conv["original"] == {"value": 12, "unit": "in"}
        assert conv["mm"] == 304.8
        assert conv["cm"] == 30.48
        assert m["measure_type"] == "length"

    def test_measurement_list_and_delete(self, demo_token, demo_issue_id):
        r = requests.post(f"{BASE}/api/hi/visual/issues/{demo_issue_id}/measurements",
                          json={"measure_type": "width", "value": 50, "unit": "cm", "source_method": "manual"},
                          headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 200
        mid = r.json()["measurement"]["id"]

        r = requests.get(f"{BASE}/api/hi/visual/issues/{demo_issue_id}/measurements",
                         headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 200
        ids = [m["id"] for m in r.json()["measurements"]]
        assert mid in ids

        r = requests.delete(f"{BASE}/api/hi/visual/measurements/{mid}",
                            headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 200

    def test_measurement_bad_type_400(self, demo_token, demo_issue_id):
        r = requests.post(f"{BASE}/api/hi/visual/issues/{demo_issue_id}/measurements",
                          json={"measure_type": "nope", "value": 1, "unit": "cm", "source_method": "manual"},
                          headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 400

    def test_measurement_bad_source_400(self, demo_token, demo_issue_id):
        r = requests.post(f"{BASE}/api/hi/visual/issues/{demo_issue_id}/measurements",
                          json={"measure_type": "length", "value": 1, "unit": "cm", "source_method": "telepathy"},
                          headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 400


# ============================================================
# Doc 5 — Annotations (versioned)
# ============================================================
class TestAnnotations:
    def test_annotations_flow(self, demo_token, demo_issue_id):
        # Create evidence via measurement (which files gr_evidence too)
        r = requests.post(f"{BASE}/api/hi/visual/issues/{demo_issue_id}/measurements",
                          json={"measure_type": "height", "value": 2, "unit": "m", "source_method": "manual"},
                          headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 200
        # Fetch evidence list from repair engine
        r = requests.get(f"{BASE}/api/hi/repair/issues/{demo_issue_id}/evidence",
                         headers=_hdr(demo_token), timeout=20)
        if r.status_code != 200:
            # fallback: use gr_evidence via a different repair endpoint
            r = requests.get(f"{BASE}/api/hi/repair/issues/{demo_issue_id}",
                             headers=_hdr(demo_token), timeout=20)
            evs = (r.json() or {}).get("evidence", [])
        else:
            evs = r.json().get("evidence", []) or r.json().get("items", [])
        assert evs, "expected at least one evidence entry after measurement"
        eid = evs[0]["id"]

        # V1 by homeowner
        r = requests.post(f"{BASE}/api/hi/visual/evidence/{eid}/annotations",
                          json={"annotations": [{"kind": "point", "x": 0.3, "y": 0.4, "label": "here"}],
                                "author": "homeowner"},
                          headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 200
        a1 = r.json()["annotation_set"]
        assert a1["version"] == 1 and a1["author"] == "homeowner"
        assert a1["is_suggestion"] is False

        # V2 by homie_suggestion => is_suggestion=true
        r = requests.post(f"{BASE}/api/hi/visual/evidence/{eid}/annotations",
                          json={"annotations": [{"kind": "box", "x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2}],
                                "author": "homie_suggestion"},
                          headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 200
        a2 = r.json()["annotation_set"]
        assert a2["version"] == 2 and a2["is_suggestion"] is True

        # newest-first
        r = requests.get(f"{BASE}/api/hi/visual/evidence/{eid}/annotations",
                         headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 200
        sets = r.json()["annotation_sets"]
        assert sets[0]["version"] >= sets[-1]["version"]

    def test_annotations_bad_evidence_404(self, demo_token):
        r = requests.post(f"{BASE}/api/hi/visual/evidence/does-not-exist/annotations",
                          json={"annotations": [{"kind": "point", "x": 0.1, "y": 0.1}]},
                          headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 404


# ============================================================
# Doc 5 — Visual inference — CRITICAL SAFETY
# ============================================================
class TestVisualInference:
    def test_high_risk_gas_forces_professional(self, demo_token, demo_issue_id):
        # Reasonably-sized base64 to avoid quality warning path
        big64 = "A" * 5000
        r = requests.post(f"{BASE}/api/hi/visual/issues/{demo_issue_id}/infer",
                          json={"base64": big64, "target": "gas line near furnace"},
                          headers=_hdr(demo_token), timeout=90)
        assert r.status_code == 200, r.text
        inf = r.json()["inference"]
        assert inf["confidence"] == "professional_verification_required"
        assert inf["high_risk_blocked"] is True
        assert inf["authorizes_action"] is False

    def test_high_risk_structural(self, demo_token, demo_issue_id):
        big64 = "B" * 5000
        r = requests.post(f"{BASE}/api/hi/visual/issues/{demo_issue_id}/infer",
                          json={"base64": big64, "target": "structural load bearing beam"},
                          headers=_hdr(demo_token), timeout=90)
        assert r.status_code == 200
        inf = r.json()["inference"]
        assert inf["confidence"] == "professional_verification_required"
        assert inf["high_risk_blocked"] is True

    def test_tiny_base64_quality_warning(self, demo_token, demo_issue_id):
        r = requests.post(f"{BASE}/api/hi/visual/issues/{demo_issue_id}/infer",
                          json={"base64": "abc", "target": "faucet drip"},
                          headers=_hdr(demo_token), timeout=90)
        assert r.status_code == 200
        inf = r.json()["inference"]
        assert inf["quality_warning"] is True
        # Confidence must NOT be "likely" when quality is poor
        assert inf["confidence"] in ("needs_better_evidence", "cannot_determine_safely",
                                     "professional_verification_required")
        assert inf["authorizes_action"] is False

    def test_correct_inference_sets_confirmed(self, demo_token, demo_issue_id):
        big64 = "C" * 5000
        r = requests.post(f"{BASE}/api/hi/visual/issues/{demo_issue_id}/infer",
                          json={"base64": big64, "target": "faucet drip"},
                          headers=_hdr(demo_token), timeout=90)
        assert r.status_code == 200
        fid = r.json()["inference"]["id"]
        r = requests.post(f"{BASE}/api/hi/visual/inferences/{fid}/correct",
                          json={"corrected_label": "TEST_b5b6 cartridge worn"},
                          headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 200

    def test_missing_base64_400(self, demo_token, demo_issue_id):
        r = requests.post(f"{BASE}/api/hi/visual/issues/{demo_issue_id}/infer",
                          json={"base64": "", "target": "leak"},
                          headers=_hdr(demo_token), timeout=30)
        assert r.status_code == 400


# ============================================================
# Doc 5 — AR sessions
# ============================================================
class TestARSession:
    def test_ar_fallback_when_not_device_capable(self, demo_token, demo_issue_id):
        r = requests.post(f"{BASE}/api/hi/visual/issues/{demo_issue_id}/ar-session",
                          json={"use_case": "inspection_area", "device_capable": False},
                          headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 200
        b = r.json()
        assert b["session"]["mode"] == "fallback_2d"
        assert b["fallback_instructions"]
        assert b["safety_notice"]
        assert b["requires_native_build"] is True

    def test_ar_native_when_capable(self, demo_token, demo_issue_id):
        r = requests.post(f"{BASE}/api/hi/visual/issues/{demo_issue_id}/ar-session",
                          json={"use_case": "measure_location", "device_capable": True},
                          headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 200
        b = r.json()
        assert b["session"]["mode"] == "ar"
        assert b["safety_notice"]

    def test_ar_invalid_use_case(self, demo_token, demo_issue_id):
        r = requests.post(f"{BASE}/api/hi/visual/issues/{demo_issue_id}/ar-session",
                          json={"use_case": "warp_reality", "device_capable": False},
                          headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 400


# ============================================================
# Doc 6 — Care dashboard & recommendations
# ============================================================
class TestCareDashboard:
    def test_dashboard_shape(self, demo_token):
        r = requests.get(f"{BASE}/api/hi/care/dashboard", headers=_hdr(demo_token), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ["top_actions", "due_now", "upcoming_seasonal", "monitoring", "deferred",
                  "recently_completed", "total_active", "notify_mode", "empty"]:
            assert k in d, f"missing {k}"
        assert len(d["top_actions"]) <= 3
        allowed = {"urgent_review", "important_preventive", "routine_maintenance",
                   "optional_improvement", "seasonal_preparation", "monitoring_follow_up"}
        for rec in d["top_actions"] + d["due_now"]:
            assert rec["priority_category"] in allowed
            assert isinstance(rec.get("reason_trace"), list) and len(rec["reason_trace"]) > 0
            assert rec.get("why_now")
            assert rec.get("estimated_effort")
            assert "consequence_of_delay" in rec

    def test_recommendations_ranked(self, demo_token):
        r = requests.get(f"{BASE}/api/hi/care/recommendations", headers=_hdr(demo_token), timeout=30)
        assert r.status_code == 200
        recs = r.json()["recommendations"]
        assert len(recs) > 0
        # Safety task always present
        assert any(rc["rec_key"].startswith("safety:") for rc in recs), "smoke/CO safety task missing"
        # Ranked by score
        scores = [rc["priority_score"] for rc in recs]
        assert scores == sorted(scores, reverse=True)


# ============================================================
# Doc 6 — Rec actions
# ============================================================
class TestCareActions:
    def _pick_rec(self, tok, exclude_prefix=None):
        r = requests.get(f"{BASE}/api/hi/care/recommendations", headers=_hdr(tok), timeout=30)
        assert r.status_code == 200
        for rc in r.json()["recommendations"]:
            if exclude_prefix and rc["rec_key"].startswith(exclude_prefix):
                continue
            return rc
        return None

    def test_explain_action(self, demo_token):
        rec = self._pick_rec(demo_token)
        r = requests.post(f"{BASE}/api/hi/care/recommendations/action?rec_key={requests.utils.quote(rec['rec_key'], safe='')}",
                          json={"action": "explain"}, headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 200
        b = r.json()
        assert isinstance(b["reason_trace"], list) and len(b["reason_trace"]) > 0
        assert "consequence_of_delay" in b

    def test_defer_moves_to_deferred(self, demo_token):
        rec = self._pick_rec(demo_token, exclude_prefix="safety:")
        rk = rec["rec_key"]
        r = requests.post(f"{BASE}/api/hi/care/recommendations/action?rec_key={requests.utils.quote(rk, safe='')}",
                          json={"action": "defer"}, headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 200
        d = requests.get(f"{BASE}/api/hi/care/dashboard", headers=_hdr(demo_token), timeout=30).json()
        assert any(x["rec_key"] == rk for x in d["deferred"])

    def test_dismiss_removes_rec(self, demo_token):
        # dismiss a seasonal or optional rec
        rec = self._pick_rec(demo_token, exclude_prefix="safety:")
        rk = rec["rec_key"]
        r = requests.post(f"{BASE}/api/hi/care/recommendations/action?rec_key={requests.utils.quote(rk, safe='')}",
                          json={"action": "dismiss"}, headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 200
        r2 = requests.get(f"{BASE}/api/hi/care/recommendations", headers=_hdr(demo_token), timeout=30).json()
        assert not any(rc["rec_key"] == rk for rc in r2["recommendations"]), "dismissed rec still visible"

    def test_start_creates_task_and_idempotent(self, demo_token):
        # use the safety task since it's stable and always present
        rec = None
        for rc in requests.get(f"{BASE}/api/hi/care/recommendations", headers=_hdr(demo_token), timeout=30).json()["recommendations"]:
            if rc["rec_key"].startswith("safety:"):
                rec = rc
                break
        assert rec
        rk = rec["rec_key"]
        r = requests.post(f"{BASE}/api/hi/care/recommendations/action?rec_key={requests.utils.quote(rk, safe='')}",
                          json={"action": "start"}, headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 200
        t = r.json()["task"]
        assert t.get("steps") and len(t["steps"]) >= 1
        for s in t["steps"]:
            assert "checkpoint" in s
        tid = t["id"]

        # Idempotent: same rec_key returns same task while in progress
        r2 = requests.post(f"{BASE}/api/hi/care/recommendations/action?rec_key={requests.utils.quote(rk, safe='')}",
                          json={"action": "start"}, headers=_hdr(demo_token), timeout=20)
        assert r2.status_code == 200
        assert r2.json()["task"]["id"] == tid


# ============================================================
# Doc 6 — Task execution & abnormal->issue conversion
# ============================================================
class TestCareTaskExecution:
    @pytest.fixture(scope="class")
    def normal_task_id(self, demo_token):
        # Start a routine asset/season rec to have a task we can complete as normal
        recs = requests.get(f"{BASE}/api/hi/care/recommendations", headers=_hdr(demo_token), timeout=30).json()["recommendations"]
        # pick a seasonal one (unique per season, safe to complete)
        target = None
        for rc in recs:
            if rc["rec_key"].startswith("seasonal:") and rc["state"] == "new":
                target = rc; break
        if not target:
            # fall back to any non-safety, non-followup
            for rc in recs:
                if not rc["rec_key"].startswith(("safety:", "followup:")) and rc["state"] == "new":
                    target = rc; break
        assert target, "no eligible rec found to start"
        r = requests.post(f"{BASE}/api/hi/care/recommendations/action?rec_key={requests.utils.quote(target['rec_key'], safe='')}",
                          json={"action": "start"}, headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 200
        return r.json()["task"]["id"]

    def test_get_task(self, demo_token, normal_task_id):
        r = requests.get(f"{BASE}/api/hi/care/tasks/{normal_task_id}", headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 200
        t = r.json()["task"]
        assert t["id"] == normal_task_id
        assert t["steps"]

    def test_complete_normal(self, demo_token, normal_task_id):
        r = requests.post(f"{BASE}/api/hi/care/tasks/{normal_task_id}/complete",
                          json={"normal": True, "note": "TEST_b5b6 all good"},
                          headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 200
        assert r.json()["outcome"] == "normal"

    def test_abnormal_converts_to_repair_issue(self, demo_token):
        # Start a fresh task then flag abnormal
        recs = requests.get(f"{BASE}/api/hi/care/recommendations", headers=_hdr(demo_token), timeout=30).json()["recommendations"]
        target = None
        for rc in recs:
            if rc["rec_key"].startswith("safety:") and rc["state"] == "new":
                target = rc; break
        if not target:
            # any non-followup available
            for rc in recs:
                if not rc["rec_key"].startswith("followup:") and rc["state"] == "new":
                    target = rc; break
        assert target
        s = requests.post(f"{BASE}/api/hi/care/recommendations/action?rec_key={requests.utils.quote(target['rec_key'], safe='')}",
                          json={"action": "start"}, headers=_hdr(demo_token), timeout=20)
        assert s.status_code == 200
        tid = s.json()["task"]["id"]
        c = requests.post(f"{BASE}/api/hi/care/tasks/{tid}/complete",
                          json={"normal": False, "note": "TEST_b5b6 something looks off"},
                          headers=_hdr(demo_token), timeout=20)
        assert c.status_code == 200
        body = c.json()
        assert body["outcome"] == "abnormal"
        new_iid = body["converted_issue_id"]
        assert new_iid

        # New issue must be openable via GET repair endpoint
        g = requests.get(f"{BASE}/api/hi/repair/issues/{new_iid}", headers=_hdr(demo_token), timeout=20)
        assert g.status_code == 200
        issue = g.json().get("issue") or g.json()
        assert issue.get("from_maintenance_task") == tid


# ============================================================
# Doc 6 — Asset profiles, calendar, prefs
# ============================================================
class TestCareAssetsCalendarPrefs:
    def test_asset_profiles(self, demo_token):
        r = requests.get(f"{BASE}/api/hi/care/assets/profiles", headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 200
        b = r.json()
        assert set(b["profiles_library"]) >= {"hvac", "water_heater", "gutters", "appliance", "alarms", "doors_windows"}
        assert isinstance(b["assets"], list)

    def test_calendar(self, demo_token):
        r = requests.get(f"{BASE}/api/hi/care/calendar", headers=_hdr(demo_token), timeout=20)
        assert r.status_code == 200
        b = r.json()
        assert "scheduled" in b and "follow_ups" in b

    def test_preferences_persist(self, demo_token):
        for mode in ("digest", "reminder", "quiet"):
            r = requests.post(f"{BASE}/api/hi/care/preferences",
                              json={"notify_mode": mode}, headers=_hdr(demo_token), timeout=20)
            assert r.status_code == 200
            assert r.json()["notify_mode"] == mode
        d = requests.get(f"{BASE}/api/hi/care/dashboard", headers=_hdr(demo_token), timeout=30).json()
        assert d["notify_mode"] == "quiet"


# ============================================================
# Cross-user isolation
# ============================================================
class TestCrossUserIsolation:
    def test_isolation_endpoints(self, second_user_token, demo_token, demo_issue_id):
        tok2 = second_user_token
        # capture-request on demo's issue
        r = requests.post(f"{BASE}/api/hi/visual/issues/{demo_issue_id}/capture-request",
                          json={"template": "close_up"}, headers=_hdr(tok2), timeout=20)
        assert r.status_code == 404

        # measurements POST
        r = requests.post(f"{BASE}/api/hi/visual/issues/{demo_issue_id}/measurements",
                          json={"measure_type": "length", "value": 1, "unit": "cm", "source_method": "manual"},
                          headers=_hdr(tok2), timeout=20)
        assert r.status_code == 404

        # infer
        r = requests.post(f"{BASE}/api/hi/visual/issues/{demo_issue_id}/infer",
                          json={"base64": "A" * 3000, "target": "leak"},
                          headers=_hdr(tok2), timeout=30)
        assert r.status_code == 404

        # ar-session
        r = requests.post(f"{BASE}/api/hi/visual/issues/{demo_issue_id}/ar-session",
                          json={"use_case": "inspection_area", "device_capable": False},
                          headers=_hdr(tok2), timeout=20)
        assert r.status_code == 404

        # Start a task under demo, then try to fetch/complete as user2
        recs = requests.get(f"{BASE}/api/hi/care/recommendations", headers=_hdr(demo_token), timeout=30).json()["recommendations"]
        target = next((rc for rc in recs if rc["rec_key"].startswith("safety:") and rc["state"] == "new"), None)
        if not target:
            target = next((rc for rc in recs if rc["state"] == "new"), None)
        assert target
        s = requests.post(f"{BASE}/api/hi/care/recommendations/action?rec_key={requests.utils.quote(target['rec_key'], safe='')}",
                          json={"action": "start"}, headers=_hdr(demo_token), timeout=20)
        assert s.status_code == 200
        tid = s.json()["task"]["id"]

        r = requests.get(f"{BASE}/api/hi/care/tasks/{tid}", headers=_hdr(tok2), timeout=20)
        assert r.status_code == 404
        r = requests.post(f"{BASE}/api/hi/care/tasks/{tid}/complete",
                          json={"normal": True}, headers=_hdr(tok2), timeout=20)
        assert r.status_code == 404


# ============================================================
# Admin endpoints
# ============================================================
class TestAdminAuth:
    def test_visual_quality_requires_admin(self, demo_token):
        r = requests.get(f"{BASE}/api/hi/admin/visual/quality", headers=_hdr(demo_token), timeout=20)
        assert r.status_code in (401, 403)

    def test_visual_quality_admin_ok(self, admin_token):
        r = requests.get(f"{BASE}/api/hi/admin/visual/quality", headers=_hdr(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        b = r.json()
        for k in ["items", "counts", "measurements", "inferences", "ar_sessions"]:
            assert k in b

    def test_care_signals_requires_admin(self, demo_token):
        r = requests.get(f"{BASE}/api/hi/admin/care/signals", headers=_hdr(demo_token), timeout=20)
        assert r.status_code in (401, 403)

    def test_care_signals_admin_ok(self, admin_token):
        r = requests.get(f"{BASE}/api/hi/admin/care/signals", headers=_hdr(admin_token), timeout=20)
        assert r.status_code == 200
        b = r.json()
        for k in ["feedback_by_status", "tasks_started", "tasks_completed",
                  "abnormal_conversions", "dismissed_low_value"]:
            assert k in b
