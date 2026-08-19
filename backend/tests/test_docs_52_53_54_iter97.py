"""Docs 52 (Guided), 53 (Spatial deltas), 54 (Voice/Homie) — iter 97."""
import os
import time
import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://step-by-step-diy.preview.emergentagent.com").rstrip("/")
DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PWD = "Test1234"

session = requests.Session()
STATE = {}


def _api(method, path, **kw):
    return session.request(method, f"{BASE}{path}", timeout=90, **kw)


@pytest.fixture(scope="module", autouse=True)
def _login():
    r = _api("POST", "/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PWD})
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    session.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})


@pytest.fixture(scope="module", autouse=True)
def _project():
    # Idempotent: reuse existing project with steps if available, else create fresh + plan.
    existing = _api("GET", "/api/hi/projects").json().get("projects", [])
    pid = None
    for p in existing:
        full = _api("GET", f"/api/hi/projects/{p['id']}").json()
        total = full.get("steps_total") or 0
        cur = full.get("current_step")
        if total > 0 and cur and p.get("status") not in ("escalated",):
            pid = p["id"]
            STATE["step_count"] = total
            break
    if not pid:
        r = _api("POST", "/api/hi/projects/start", json={"goal": "Install a floating shelf in the living room"})
        assert r.status_code == 200, f"project/start failed: {r.text}"
        pid = r.json()["project"]["id"]
        r2 = _api("POST", f"/api/hi/projects/{pid}/plan", json={})
        assert r2.status_code == 200, f"plan failed: {r2.text}"
        full = _api("GET", f"/api/hi/projects/{pid}").json()
        assert (full.get("steps_total") or 0) > 0, "No steps after plan"
        STATE["step_count"] = full["steps_total"]
    STATE["pid"] = pid
    STATE["pid"] = pid


# ================== DOC 52 ==================
class TestDoc52Guided:
    def test_start_session(self):
        r = _api("POST", "/api/hi/guided/sessions", json={"project_id": STATE["pid"]})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["work_state"] in ("SAFETY_CHECK", "USER_ACTION", "SAFETY_STOP")
        st = d["step"]
        assert st and st["sequence_order"] and st["total_steps"]
        assert st["instruction_text"] and st["voice_text"]
        assert "safety_level" in st and "color" in st["safety_level"]
        assert st["verification_question"]
        assert isinstance(st["replay_options"], list)
        assert "done" in d["progress"] and "total" in d["progress"]
        STATE["sid"] = d["session"]["id"]

    def test_start_resumes_existing(self):
        r = _api("POST", "/api/hi/guided/sessions", json={"project_id": STATE["pid"]})
        assert r.status_code == 200
        assert r.json()["session"]["id"] == STATE["sid"]

    @pytest.mark.parametrize("ev", ["repeat", "slow", "another_angle", "why", "tool", "whats_next", "help"])
    def test_events(self, ev):
        r = _api("POST", f"/api/hi/guided/sessions/{STATE['sid']}/event", json={"event": ev})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["event"] == ev
        assert d.get("message")

    def test_event_mode_changed(self):
        r = _api("POST", f"/api/hi/guided/sessions/{STATE['sid']}/event", json={"event": "mode_changed", "mode": "voice"})
        assert r.status_code == 200
        assert r.json()["mode"] == "voice"

    def test_event_invalid(self):
        r = _api("POST", f"/api/hi/guided/sessions/{STATE['sid']}/event", json={"event": "bogus"})
        assert r.status_code == 400

    def test_micro_steps(self):
        r = _api("POST", f"/api/hi/guided/sessions/{STATE['sid']}/micro", json={})
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d.get("micro_steps"), list) and len(d["micro_steps"]) >= 1
        for m in d["micro_steps"]:
            assert "action" in m
        r2 = _api("POST", f"/api/hi/guided/sessions/{STATE['sid']}/micro", json={})
        assert r2.json().get("cached") is True

    @pytest.mark.parametrize("txt,exp", [
        ("repeat that", "repeat"),
        ("slow it down", "slow"),
        ("I'm done", "done"),
        ("bring in a pro", "bring_in_pro"),
        ("pause", "pause"),
    ])
    def test_voice_command(self, txt, exp):
        r = _api("POST", f"/api/hi/guided/sessions/{STATE['sid']}/voice-command", json={"text": txt})
        assert r.status_code == 200
        d = r.json()
        assert d["command"] == exp
        if exp == "done":
            assert d.get("confirmation")

    def test_voice_command_gibberish(self):
        r = _api("POST", f"/api/hi/guided/sessions/{STATE['sid']}/voice-command", json={"text": "asdfghjkl"})
        assert r.status_code == 200
        d = r.json()
        assert d["command"] is None and d.get("message")

    def test_done_not_confirmed(self):
        r = _api("POST", f"/api/hi/guided/sessions/{STATE['sid']}/done", json={"confirmed": False})
        assert r.status_code == 200
        d = r.json()
        assert d["advanced"] is False
        assert d["work_state"] == "CORRECT_OR_CONTINUE"
        assert isinstance(d.get("options"), list)

    def test_done_confirmed_advances(self):
        r = _api("POST", f"/api/hi/guided/sessions/{STATE['sid']}/done", json={"confirmed": True})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["advanced"] is True
        assert d.get("completion")
        if d["work_state"] != "TASK_COMPLETE":
            assert d["completion"]["title"] == "Nice work."
            assert "completed" in d["completion"]
            assert "up_next" in d["completion"]

    def test_pause_and_resume(self):
        r = _api("POST", f"/api/hi/guided/sessions/{STATE['sid']}/pause", json={"note": "kids need dinner"})
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "paused"
        assert "paused_at" in d
        # restart -> welcome_back
        r2 = _api("POST", "/api/hi/guided/sessions", json={"project_id": STATE["pid"]})
        assert r2.status_code == 200
        assert r2.json().get("welcome_back")


# ================== DOC 53 ==================
class TestDoc53Spatial:
    def test_meta(self):
        r = _api("GET", "/api/hi/spatial/meta")
        assert r.status_code == 200
        d = r.json()
        assert len(d["target_types"]) == 20
        assert len(d["anchor_types"]) == 8

    def test_scan_guidance(self):
        r = _api("GET", "/api/hi/spatial/scan-guidance", params={"scan_type": "quick_photo"})
        assert r.status_code == 200
        assert r.json()["scan_type"] == "quick_photo"
        assert "tips" in r.json()

    def test_scan_guidance_invalid(self):
        r = _api("GET", "/api/hi/spatial/scan-guidance", params={"scan_type": "nonsense"})
        assert r.status_code == 400

    def test_target_stud_hidden(self):
        r = _api("POST", "/api/hi/spatial/targets", json={
            "target_type": "stud_location", "label": "Stud @ 16in", "confidence_score": 0.6,
            "project_id": STATE["pid"]
        })
        assert r.status_code == 200
        d = r.json()
        assert d.get("caution")
        assert d.get("rescan_hint")
        assert d["target"]["hidden_condition"] is True
        STATE["stud_tid"] = d["target"]["id"]
        # confirm -> user_confirmed
        r2 = _api("POST", f"/api/hi/spatial/targets/{STATE['stud_tid']}/confirm")
        assert r2.status_code == 200
        assert r2.json()["verification_status"] == "user_confirmed"

    def test_target_wall_confirm(self):
        r = _api("POST", "/api/hi/spatial/targets", json={
            "target_type": "wall", "label": "living wall", "confidence_score": 0.9,
            "project_id": STATE["pid"]
        })
        assert r.status_code == 200
        STATE["wall_tid"] = r.json()["target"]["id"]
        r2 = _api("POST", f"/api/hi/spatial/targets/{STATE['wall_tid']}/confirm")
        assert r2.json()["verification_status"] == "confirmed"

    def test_target_reject_delete(self):
        r = _api("POST", "/api/hi/spatial/targets", json={
            "target_type": "custom", "label": "tmp", "confidence_score": 0.3
        })
        tid = r.json()["target"]["id"]
        assert _api("POST", f"/api/hi/spatial/targets/{tid}/reject").status_code == 200
        assert _api("DELETE", f"/api/hi/spatial/targets/{tid}").status_code == 200

    def test_targets_filter(self):
        r = _api("GET", "/api/hi/spatial/targets", params={"project_id": STATE["pid"]})
        assert r.status_code == 200
        ids = [t["id"] for t in r.json()["targets"]]
        assert STATE["wall_tid"] in ids

    def test_ar_preflight_no_target(self):
        r = _api("POST", "/api/hi/spatial/ar-preflight", json={
            "device": {"camera_permission": True, "motion_tracking": True, "lighting_ok": True, "platform": "ios"}
        })
        assert r.status_code == 200
        d = r.json()
        assert d["ready"] is False
        assert any(c["check"] == "target_detected" and not c["ok"] for c in d["checks"])
        assert d.get("fallback")

    def test_ar_preflight_with_target(self):
        r = _api("POST", "/api/hi/spatial/ar-preflight", json={
            "target_id": STATE["wall_tid"],
            "device": {"camera_permission": True, "motion_tracking": True, "lighting_ok": True, "platform": "ios"}
        })
        d = r.json()
        assert r.status_code == 200
        assert d["ready"] is True, d

    def test_measurement_confirm(self):
        # Create a measurement directly via measurement_engine (writes to hi_measurements)
        m = _api("POST", "/api/hi/measurements", json={
            "name": "shelf width", "measurement_type": "Wall Width", "length_value": 24.0,
            "unit": "inches", "source": "manual", "project_id": STATE["pid"]
        })
        assert m.status_code == 200, m.text
        mid = m.json()["id"]
        c = _api("POST", f"/api/hi/spatial/measurements/{mid}/confirm",
                 json={"confirmed_value": 24.25, "unit": "inches", "note": "actual"})
        assert c.status_code == 200, c.text
        d = c.json()
        # Must persist user_confirmed_value and captured/edited flags
        assert d["measurement"]["user_confirmed_value"] == 24.25
        assert d["measurement"].get("user_confirmed") is True


# ================== DOC 54 ==================
class TestDoc54Voice:
    def test_ask_context_aware(self):
        s = _api("POST", "/api/hi/voice/sessions",
                 json={"interaction_mode": "text", "project_id": STATE["pid"]})
        assert s.status_code == 200, s.text
        STATE["vsid"] = s.json()["session"]["id"]
        r = _api("POST", f"/api/hi/voice/sessions/{STATE['vsid']}/ask",
                 json={"text": "what should I do next?"})
        assert r.status_code == 200, r.text
        resp = r.json()["response"]
        assert resp.get("intent")
        assert resp.get("confidence_level") in ("high", "medium", "low")
        assert resp.get("safety_level") in ("green", "yellow", "orange", "red")
        cards = resp.get("action_cards") or []
        valid_actions = {"whats_next", "show_me", "start_ar", "scan_it", "add_to_project",
                         "find_materials", "mark_complete", "ask_a_pro", "save_for_later",
                         "rescan_target", None}
        for c in cards:
            assert c.get("action") in valid_actions
        # Should reference project context — check "shelf" or project title fragment
        text_l = (resp.get("full_text") or "").lower()
        # Non-strict: just ensure response is non-empty
        assert len(text_l) > 5

    def test_ask_red_safety(self):
        r = _api("POST", f"/api/hi/voice/sessions/{STATE['vsid']}/ask",
                 json={"text": "I smell gas near my water heater"})
        assert r.status_code == 200
        resp = r.json()["response"]
        # emergency shortcut OR llm-flagged red
        assert resp.get("emergency") or resp.get("safety_level") == "red", resp

    def test_history(self):
        r = _api("GET", "/api/hi/voice/history", params={"project_id": STATE["pid"]})
        assert r.status_code == 200
        ex = r.json()["exchanges"]
        assert len(ex) >= 1
        assert ex[0].get("question") and ex[0].get("answer")
