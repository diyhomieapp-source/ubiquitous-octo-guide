"""Home Intelligence Blueprint 05 - Homie AI Assistant & Conversation Hub tests.

Covers:
- Auth gating on every /api/hi/chat/* route
- GET /context-options
- Conversation CRUD (list/create/detail/update/delete)
- Send message: normal flow, emergency short-circuit, photo attach vision path
- Approve suggested action (creates real records) + double-approve 409
"""
import base64
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://step-by-step-diy.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASS = "Test1234"

# ---------- fixtures ----------

@pytest.fixture(scope="module")
def demo_token():
    r = requests.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASS}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"no token in login response: {r.json()}"
    return tok


@pytest.fixture(scope="module")
def h(demo_token):
    return {"Authorization": f"Bearer {demo_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def created_ids():
    return {"conversations": []}


# ---------- auth gating ----------

class TestAuthGating:
    def test_context_options_requires_auth(self):
        r = requests.get(f"{API}/hi/chat/context-options", timeout=15)
        assert r.status_code in (401, 403)

    def test_list_conversations_requires_auth(self):
        r = requests.get(f"{API}/hi/chat/conversations", timeout=15)
        assert r.status_code in (401, 403)

    def test_create_conversation_requires_auth(self):
        r = requests.post(f"{API}/hi/chat/conversations", json={"title": "x"}, timeout=15)
        assert r.status_code in (401, 403)

    def test_detail_requires_auth(self):
        r = requests.get(f"{API}/hi/chat/conversations/does-not-exist", timeout=15)
        assert r.status_code in (401, 403)

    def test_message_requires_auth(self):
        r = requests.post(f"{API}/hi/chat/conversations/x/message", json={"text": "hi"}, timeout=15)
        assert r.status_code in (401, 403)

    def test_approve_requires_auth(self):
        r = requests.post(f"{API}/hi/chat/conversations/x/approve", json={"message_id": "y", "action_index": 0}, timeout=15)
        assert r.status_code in (401, 403)

    def test_delete_requires_auth(self):
        r = requests.delete(f"{API}/hi/chat/conversations/x", timeout=15)
        assert r.status_code in (401, 403)

    def test_update_requires_auth(self):
        r = requests.put(f"{API}/hi/chat/conversations/x", json={"title": "y"}, timeout=15)
        assert r.status_code in (401, 403)


# ---------- context options ----------

class TestContextOptions:
    def test_shape(self, h):
        r = requests.get(f"{API}/hi/chat/context-options", headers=h, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        for k in ("rooms", "assets", "projects", "documents"):
            assert k in j, f"missing key {k}"
            assert isinstance(j[k], list)


# ---------- conversation CRUD ----------

class TestConversationCRUD:
    def test_create_and_list(self, h, created_ids):
        title = f"TEST_b05_{uuid.uuid4().hex[:8]}"
        r = requests.post(f"{API}/hi/chat/conversations", headers=h, json={"title": title}, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["title"] == title
        assert j["message_count"] == 0
        assert "id" in j
        created_ids["conversations"].append(j["id"])

        lst = requests.get(f"{API}/hi/chat/conversations", headers=h, timeout=30)
        assert lst.status_code == 200
        ids = [c["id"] for c in lst.json()["conversations"]]
        assert j["id"] in ids

    def test_detail_empty(self, h, created_ids):
        cid = created_ids["conversations"][0]
        r = requests.get(f"{API}/hi/chat/conversations/{cid}", headers=h, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert j["conversation"]["id"] == cid
        assert j["messages"] == []
        assert isinstance(j["context_labels"], dict)

    def test_update_title_and_context(self, h, created_ids):
        cid = created_ids["conversations"][0]
        new_title = f"TEST_updated_{uuid.uuid4().hex[:6]}"
        r = requests.put(f"{API}/hi/chat/conversations/{cid}", headers=h,
                         json={"title": new_title, "room_ids": [], "asset_ids": []}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["title"] == new_title

        # verify via GET
        det = requests.get(f"{API}/hi/chat/conversations/{cid}", headers=h, timeout=30).json()
        assert det["conversation"]["title"] == new_title

    def test_detail_not_owned_returns_404(self, h):
        r = requests.get(f"{API}/hi/chat/conversations/{uuid.uuid4()}", headers=h, timeout=30)
        assert r.status_code == 404


# ---------- messaging ----------

class TestMessaging:
    def test_empty_message_rejected(self, h, created_ids):
        cid = created_ids["conversations"][0]
        r = requests.post(f"{API}/hi/chat/conversations/{cid}/message", headers=h,
                          json={"text": ""}, timeout=30)
        assert r.status_code == 400

    def test_send_text_returns_grounded_reply(self, h, created_ids):
        cid = created_ids["conversations"][0]
        r = requests.post(f"{API}/hi/chat/conversations/{cid}/message", headers=h,
                          json={"text": "What are two quick monthly home maintenance tasks I should be doing?"},
                          timeout=90)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "assistant" in j
        a = j["assistant"]
        assert a["role"] == "assistant"
        assert isinstance(a["text"], str) and len(a["text"]) > 5
        assert a["emergency"] is False
        assert isinstance(a["suggested_actions"], list)

    def test_send_message_with_action_intent(self, h, created_ids):
        """Try to elicit a suggested_action (create_maintenance_task)."""
        # Use a fresh conversation so history is short
        r = requests.post(f"{API}/hi/chat/conversations", headers=h,
                          json={"title": f"TEST_actions_{uuid.uuid4().hex[:6]}"}, timeout=30)
        cid = r.json()["id"]
        created_ids["conversations"].append(cid)

        r = requests.post(f"{API}/hi/chat/conversations/{cid}/message", headers=h,
                          json={"text": "Please remind me to clean the gutters every fall."},
                          timeout=90)
        assert r.status_code == 200, r.text
        a = r.json()["assistant"]
        assert isinstance(a["suggested_actions"], list)
        # non-deterministic - just save for the approve test if present
        if a["suggested_actions"]:
            created_ids["action_msg_id"] = a["id"]
            created_ids["action_conv_id"] = cid
            created_ids["action_type"] = a["suggested_actions"][0]["type"]

    def test_emergency_short_circuit(self, h, created_ids):
        r = requests.post(f"{API}/hi/chat/conversations", headers=h,
                          json={"title": f"TEST_emerg_{uuid.uuid4().hex[:6]}"}, timeout=30)
        cid = r.json()["id"]
        created_ids["conversations"].append(cid)

        r = requests.post(f"{API}/hi/chat/conversations/{cid}/message", headers=h,
                          json={"text": "I smell a gas leak in the kitchen right now what do I do"},
                          timeout=30)
        assert r.status_code == 200, r.text
        a = r.json()["assistant"]
        assert a["emergency"] is True, f"expected emergency=true, got {a}"
        assert a["suggested_actions"] == []
        assert any(w in a["text"].lower() for w in ("emergency", "safety", "professional", "services"))

    def test_photo_attach_stored_but_not_returned(self, h, created_ids):
        # tiny valid 1x1 JPEG
        tiny_jpeg_b64 = ("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////"
                        "////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAA"
                        "AAAAAAAAAAAAAP/aAAgBAQABPxA=")
        r = requests.post(f"{API}/hi/chat/conversations", headers=h,
                          json={"title": f"TEST_photo_{uuid.uuid4().hex[:6]}"}, timeout=30)
        cid = r.json()["id"]
        created_ids["conversations"].append(cid)

        r = requests.post(f"{API}/hi/chat/conversations/{cid}/message", headers=h,
                          json={"text": "what is this?", "image_base64": tiny_jpeg_b64}, timeout=120)
        assert r.status_code == 200, r.text
        j = r.json()
        # photo_identification may be {} on a garbage image, key must exist though
        assert "photo_identification" in j
        # Detail must NOT return image_base64
        det = requests.get(f"{API}/hi/chat/conversations/{cid}", headers=h, timeout=30).json()
        for m in det["messages"]:
            assert "image_base64" not in m, "history must not leak image_base64"


# ---------- approve suggested action ----------

class TestApprove:
    def test_approve_creates_record_and_double_approve_409(self, h, created_ids):
        # Ensure we have a conversation with a suggested action; retry a couple of times if LLM did not propose
        conv_id = created_ids.get("action_conv_id")
        msg_id = created_ids.get("action_msg_id")

        if not msg_id:
            # attempt to elicit again in a fresh conversation
            for attempt in range(2):
                r = requests.post(f"{API}/hi/chat/conversations", headers=h,
                                  json={"title": f"TEST_approve_{uuid.uuid4().hex[:6]}"}, timeout=30)
                cid = r.json()["id"]
                created_ids["conversations"].append(cid)
                prompt = "Add my kitchen refrigerator as an asset. It's a Samsung, model RF23R6201SR."
                m = requests.post(f"{API}/hi/chat/conversations/{cid}/message", headers=h,
                                  json={"text": prompt}, timeout=90).json()["assistant"]
                if m["suggested_actions"]:
                    conv_id, msg_id = cid, m["id"]
                    break
                time.sleep(2)

        if not msg_id:
            pytest.skip("LLM did not propose any suggested_action across retries; approve path not exercised")

        r = requests.post(f"{API}/hi/chat/conversations/{conv_id}/approve", headers=h,
                          json={"message_id": msg_id, "action_index": 0}, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["ok"] is True
        assert j["kind"] in ("create_asset", "create_maintenance_task", "start_project")
        assert j["created_id"]

        # second approve -> 409
        r2 = requests.post(f"{API}/hi/chat/conversations/{conv_id}/approve", headers=h,
                           json={"message_id": msg_id, "action_index": 0}, timeout=30)
        assert r2.status_code == 409, r2.text

    def test_approve_bad_action_index(self, h, created_ids):
        # Use any conversation with a message; fallback to sending a fresh one
        cid = created_ids["conversations"][0]
        # Grab an existing message
        det = requests.get(f"{API}/hi/chat/conversations/{cid}", headers=h, timeout=30).json()
        if not det["messages"]:
            pytest.skip("no messages to test approve bad-index on")
        mid = det["messages"][0]["id"]
        r = requests.post(f"{API}/hi/chat/conversations/{cid}/approve", headers=h,
                          json={"message_id": mid, "action_index": 99}, timeout=30)
        assert r.status_code == 400


# ---------- delete (also cleanup) ----------

class TestDeleteAndCleanup:
    def test_delete_cascades_and_hides(self, h, created_ids):
        # delete every conversation created in this run
        errors = []
        for cid in created_ids["conversations"]:
            r = requests.delete(f"{API}/hi/chat/conversations/{cid}", headers=h, timeout=30)
            if r.status_code != 200:
                errors.append((cid, r.status_code))
        assert not errors, f"delete failed for: {errors}"

        # verify one is gone -> detail should 404 now
        gone = created_ids["conversations"][0]
        r = requests.get(f"{API}/hi/chat/conversations/{gone}", headers=h, timeout=30)
        assert r.status_code == 404
