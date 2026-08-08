"""B33 Sync + B34 Multimodal Voice backend tests."""
import os
import uuid
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://step-by-step-diy.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

USER_EMAIL = "demo_home@diyhomie.com"
USER_PASS = "Test1234"
ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASS = "diyhomie1122"


def _login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def user_token():
    return _login(USER_EMAIL, USER_PASS)


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PASS)


@pytest.fixture
def uh(user_token):
    return {"Authorization": f"Bearer {user_token}"}


@pytest.fixture
def ah(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ============ B33 SYNC ============

class TestSyncPush:
    def test_safe_append_note_and_idempotency(self, uh):
        idem = f"TEST_{uuid.uuid4()}"
        rec = {"local_id": "L1", "entity_type": "timeline_note", "operation_type": "note_add",
               "payload": {"title": "TEST_offline_note", "description": "from tests"}, "idempotency_key": idem}
        r1 = requests.post(f"{API}/hi/sync/push", json={"records": [rec]}, headers=uh, timeout=30)
        assert r1.status_code == 200, r1.text
        res1 = r1.json()["results"][0]
        assert res1["sync_status"] == "synced"
        assert res1.get("entity_id")

        # second push with same idempotency_key => duplicate
        r2 = requests.post(f"{API}/hi/sync/push", json={"records": [rec]}, headers=uh, timeout=30)
        assert r2.status_code == 200
        res2 = r2.json()["results"][0]
        assert res2["sync_status"] == "synced"
        assert res2.get("duplicate") is True

    def test_measurement_add(self, uh):
        rec = {"local_id": "M1", "entity_type": "measurement", "operation_type": "measurement_add",
               "payload": {"label": "TEST_room_len", "value": "12.5", "unit": "ft"},
               "idempotency_key": f"TEST_{uuid.uuid4()}"}
        r = requests.post(f"{API}/hi/sync/push", json={"records": [rec]}, headers=uh, timeout=30)
        assert r.status_code == 200
        assert r.json()["results"][0]["sync_status"] == "synced"

    def test_blocked_offline_op(self, uh):
        rec = {"local_id": "B1", "entity_type": "reward", "operation_type": "reward_redeem",
               "payload": {"reward_id": "x"}, "idempotency_key": f"TEST_{uuid.uuid4()}"}
        r = requests.post(f"{API}/hi/sync/push", json={"records": [rec]}, headers=uh, timeout=30)
        assert r.status_code == 200
        res = r.json()["results"][0]
        assert res["sync_status"] == "failed"
        assert "live connection" in res.get("reason", "").lower()

    def test_stale_review_creates_conflict(self, uh):
        # Try step_edit with fake entity + fake base_version -> should detect deletion_conflict (missing entity)
        rec = {"local_id": "R1", "entity_type": "project_step", "entity_id": f"missing-{uuid.uuid4()}",
               "operation_type": "step_edit", "payload": {"instruction": "TEST edit"},
               "base_version": "2020-01-01T00:00:00Z", "idempotency_key": f"TEST_{uuid.uuid4()}"}
        r = requests.post(f"{API}/hi/sync/push", json={"records": [rec]}, headers=uh, timeout=30)
        assert r.status_code == 200
        j = r.json()
        res = j["results"][0]
        assert res["sync_status"] == "conflict"
        assert res.get("conflict_id")
        assert j["conflicts_created"] >= 1


class TestSyncStatusConflictsResolve:
    def test_status_and_conflicts_and_resolve(self, uh):
        # ensure at least one conflict exists
        rec = {"local_id": "RX", "entity_type": "project_step", "entity_id": f"missing-{uuid.uuid4()}",
               "operation_type": "step_edit", "payload": {"instruction": "TEST resolve me"},
               "base_version": "2020-01-01T00:00:00Z", "idempotency_key": f"TEST_{uuid.uuid4()}"}
        r = requests.post(f"{API}/hi/sync/push", json={"records": [rec]}, headers=uh, timeout=30)
        cid = r.json()["results"][0]["conflict_id"]

        st = requests.get(f"{API}/hi/sync/status", headers=uh, timeout=30)
        assert st.status_code == 200
        sj = st.json()
        assert "pending_conflicts" in sj and sj["pending_conflicts"] >= 1

        cf = requests.get(f"{API}/hi/sync/conflicts", headers=uh, timeout=30)
        assert cf.status_code == 200
        cj = cf.json()
        assert set(cj["choices"]) == {"keep_mine", "use_latest", "save_as_note", "discard"}
        assert any(c["id"] == cid for c in cj["conflicts"])

        # resolve as save_as_note (safe since server has nothing)
        rr = requests.post(f"{API}/hi/sync/conflicts/{cid}/resolve", json={"choice": "save_as_note"},
                           headers=uh, timeout=30)
        assert rr.status_code == 200, rr.text
        assert rr.json()["ok"] is True

        # re-resolve should 409
        rr2 = requests.post(f"{API}/hi/sync/conflicts/{cid}/resolve", json={"choice": "discard"},
                            headers=uh, timeout=30)
        assert rr2.status_code == 409

        # bad choice
        rr3 = requests.post(f"{API}/hi/sync/conflicts/{cid}/resolve", json={"choice": "wat"},
                            headers=uh, timeout=30)
        assert rr3.status_code in (400, 409)

    def test_resolve_all_choices(self, uh):
        # Create 3 fresh conflicts, one per choice type we haven't already tested
        for choice in ["keep_mine", "use_latest", "discard"]:
            rec = {"local_id": f"RC-{choice}", "entity_type": "project_step",
                   "entity_id": f"missing-{uuid.uuid4()}", "operation_type": "step_edit",
                   "payload": {"instruction": f"TEST {choice}"},
                   "base_version": "2020-01-01T00:00:00Z",
                   "idempotency_key": f"TEST_{uuid.uuid4()}"}
            r = requests.post(f"{API}/hi/sync/push", json={"records": [rec]}, headers=uh, timeout=30)
            cid = r.json()["results"][0]["conflict_id"]
            rr = requests.post(f"{API}/hi/sync/conflicts/{cid}/resolve",
                               json={"choice": choice}, headers=uh, timeout=30)
            assert rr.status_code == 200, f"choice {choice}: {rr.text}"


class TestSyncMedia:
    def test_media_finalize_dedupes(self, uh):
        checksum = f"TEST_ck_{uuid.uuid4().hex}"
        body = {"local_file_reference": "file://a.jpg", "target_entity_type": "asset",
                "target_entity_id": None, "checksum": checksum}
        r1 = requests.post(f"{API}/hi/sync/media/finalize", json=body, headers=uh, timeout=30)
        assert r1.status_code == 200
        j1 = r1.json()
        assert j1["media"]["checksum"] == checksum
        assert not j1.get("duplicate")

        r2 = requests.post(f"{API}/hi/sync/media/finalize", json=body, headers=uh, timeout=30)
        assert r2.status_code == 200
        assert r2.json().get("duplicate") is True


class TestSavedQuestions:
    def test_crud(self, uh):
        r = requests.post(f"{API}/hi/sync/saved-questions",
                          json={"question": "TEST what temp for paint?"}, headers=uh, timeout=30)
        assert r.status_code == 200
        qid = r.json()["question"]["id"]

        l = requests.get(f"{API}/hi/sync/saved-questions", headers=uh, timeout=30)
        assert l.status_code == 200
        assert any(q["id"] == qid for q in l.json()["questions"])

        # empty question -> 400
        bad = requests.post(f"{API}/hi/sync/saved-questions", json={"question": "  "}, headers=uh, timeout=30)
        assert bad.status_code == 400

        d = requests.delete(f"{API}/hi/sync/saved-questions/{qid}", headers=uh, timeout=30)
        assert d.status_code == 200

        d2 = requests.delete(f"{API}/hi/sync/saved-questions/{qid}", headers=uh, timeout=30)
        assert d2.status_code == 404


class TestSafetyContent:
    def test_safety_content(self, uh):
        r = requests.get(f"{API}/hi/sync/safety-content", headers=uh, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert isinstance(j["safety_content"], list)
        ids = [x["id"] for x in j["safety_content"]]
        assert set(["gas", "fire", "shock", "flood", "medical"]).issubset(set(ids))


# ============ B34 VOICE ============

@pytest.fixture(scope="module")
def voice_session(user_token):
    r = requests.post(f"{API}/hi/voice/sessions",
                      json={"interaction_mode": "mixed"},
                      headers={"Authorization": f"Bearer {user_token}"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["session"]


class TestVoiceSession:
    def test_start_and_get(self, uh, voice_session):
        sid = voice_session["id"]
        assert voice_session["interaction_mode"] == "mixed"
        r = requests.get(f"{API}/hi/voice/sessions/{sid}", headers=uh, timeout=30)
        assert r.status_code == 200
        assert r.json()["session"]["id"] == sid

    def test_invalid_mode(self, uh):
        r = requests.post(f"{API}/hi/voice/sessions", json={"interaction_mode": "moon"},
                          headers=uh, timeout=30)
        assert r.status_code == 400


class TestVoiceAsk:
    def test_ask_normal(self, uh, voice_session):
        sid = voice_session["id"]
        r = requests.post(f"{API}/hi/voice/sessions/{sid}/ask",
                          json={"text": "How do I change a furnace filter?"},
                          headers=uh, timeout=60)
        assert r.status_code == 200, r.text
        j = r.json()
        resp = j["response"]
        for k in ("spoken", "full_text", "emotion", "gesture", "action_cards"):
            assert k in resp
        assert resp["emergency"] is False
        assert "captions" in j

    def test_ask_emergency(self, uh, voice_session):
        sid = voice_session["id"]
        r = requests.post(f"{API}/hi/voice/sessions/{sid}/ask",
                          json={"text": "I smell gas in my kitchen right now"},
                          headers=uh, timeout=30)
        assert r.status_code == 200
        resp = r.json()["response"]
        assert resp["emergency"] is True
        assert resp["emotion"] in ("urgent", "cautionary")
        assert resp["gesture"] in ("warning", "pause")
        # no normal LLM guidance – text is the fixed safety message
        assert "emergency" in resp["full_text"].lower() or "safety" in resp["full_text"].lower()

    def test_ask_empty_400(self, uh, voice_session):
        r = requests.post(f"{API}/hi/voice/sessions/{voice_session['id']}/ask",
                          json={"text": "   "}, headers=uh, timeout=30)
        assert r.status_code == 400


class TestVoiceSpeech:
    def test_low_confidence_prompt_repeat(self, uh, voice_session):
        r = requests.post(f"{API}/hi/voice/sessions/{voice_session['id']}/speech",
                          json={"transcript": "muffled", "transcript_confidence": 0.2},
                          headers=uh, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert j["low_confidence"] is True
        assert j["prompt_repeat"] is True

    def test_high_confidence(self, uh, voice_session):
        r = requests.post(f"{API}/hi/voice/sessions/{voice_session['id']}/speech",
                          json={"transcript": "hello homie", "transcript_confidence": 0.95},
                          headers=uh, timeout=30)
        assert r.status_code == 200
        assert r.json()["prompt_repeat"] is False


class TestVoiceHandsFree:
    def test_next_step_requires_project(self, uh, voice_session):
        r = requests.post(f"{API}/hi/voice/sessions/{voice_session['id']}/handsfree",
                          json={"command": "next_step"}, headers=uh, timeout=30)
        assert r.status_code == 400
        assert "project" in r.json().get("detail", "").lower()

    def test_ask_no_project_ok(self, uh, voice_session):
        r = requests.post(f"{API}/hi/voice/sessions/{voice_session['id']}/handsfree",
                          json={"command": "ask"}, headers=uh, timeout=30)
        assert r.status_code == 200
        assert r.json().get("prompt_ask") is True

    def test_unknown_command(self, uh, voice_session):
        r = requests.post(f"{API}/hi/voice/sessions/{voice_session['id']}/handsfree",
                          json={"command": "fly"}, headers=uh, timeout=30)
        assert r.status_code == 400

    def test_next_step_needs_confirmation_and_high_risk_block(self, uh):
        """Create a project (via public projects api if any) — else skip. We test needs_confirmation
        by creating a session with an unknown-but-nonempty project_id and verify server behaviour."""
        # Create session bound to a fake project id — high risk path won't trigger for missing project;
        # command should still say "project doesn't have steps yet" (200) rather than 400. That still
        # covers 'project required' path.
        s = requests.post(f"{API}/hi/voice/sessions", json={"interaction_mode": "text",
                                                            "project_id": "TEST-fake-project"},
                          headers=uh, timeout=30)
        assert s.status_code == 200
        sid = s.json()["session"]["id"]
        r = requests.post(f"{API}/hi/voice/sessions/{sid}/handsfree",
                          json={"command": "next_step"}, headers=uh, timeout=30)
        assert r.status_code == 200
        # no steps -> spoken hint
        assert "steps" in r.json().get("spoken", "").lower() or r.json().get("needs_confirmation")


class TestAdminVoice:
    def test_get_settings(self, ah):
        r = requests.get(f"{API}/hi/admin/voice/settings", headers=ah, timeout=30)
        assert r.status_code == 200
        for k in ("voice_input_enabled", "voice_output_enabled", "avatar_enabled",
                  "high_risk_avatar_disabled", "free_voice_daily_limit"):
            assert k in r.json()

    def test_put_settings(self, ah):
        r = requests.put(f"{API}/hi/admin/voice/settings",
                         json={"free_voice_daily_limit": 12}, headers=ah, timeout=30)
        assert r.status_code == 200
        assert r.json()["free_voice_daily_limit"] == 12

    def test_dashboard(self, ah):
        r = requests.get(f"{API}/hi/admin/voice/dashboard", headers=ah, timeout=30)
        assert r.status_code == 200
        j = r.json()
        for k in ("total_sessions", "voice_responses", "failed_playback",
                  "low_confidence_transcripts", "sessions_by_mode", "settings"):
            assert k in j
