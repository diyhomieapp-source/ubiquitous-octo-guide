"""Backend tests for Home Intelligence Blueprint 07 — Tool/Material/Supply Inventory.

Covers:
- Auth gating on every /api/hi/inventory/* route
- Inventory CRUD (add/list/detail/update/archive/locations/filters)
- POST /identify graceful handling of tiny/invalid image
- Match against project 4ae43f68-20cf-4412-b4a6-1bda9764b9f7 (expect already_have>=1)
- Apply match writes user_status to project materials
- Templates-in-Homie: chat reply reflects published 'Ladder Safety' template guidance
"""
import base64
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001")).rstrip("/")
API = f"{BASE_URL}/api"
TIMEOUT = 60

DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASS = __import__("os").environ.get("TEST_USER_PASSWORD", "")
DEMO_PROJECT_ID = "4ae43f68-20cf-4412-b4a6-1bda9764b9f7"


# -------- fixtures --------
@pytest.fixture(scope="module")
def demo_token():
    r = requests.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASS}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, "no token"
    return tok


@pytest.fixture(scope="module")
def h(demo_token):
    return {"Authorization": f"Bearer {demo_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def state():
    return {"created_ids": []}


# -------- Auth gating --------
class TestAuthGating:
    def test_list_requires_auth(self):
        r = requests.get(f"{API}/hi/inventory", timeout=15)
        assert r.status_code in (401, 403)

    def test_add_requires_auth(self):
        r = requests.post(f"{API}/hi/inventory", json={"name": "x"}, timeout=15)
        assert r.status_code in (401, 403)

    def test_locations_requires_auth(self):
        r = requests.get(f"{API}/hi/inventory/locations", timeout=15)
        assert r.status_code in (401, 403)

    def test_detail_requires_auth(self):
        r = requests.get(f"{API}/hi/inventory/does-not-exist", timeout=15)
        assert r.status_code in (401, 403)

    def test_update_requires_auth(self):
        r = requests.put(f"{API}/hi/inventory/x", json={"name": "y"}, timeout=15)
        assert r.status_code in (401, 403)

    def test_delete_requires_auth(self):
        r = requests.delete(f"{API}/hi/inventory/x", timeout=15)
        assert r.status_code in (401, 403)

    def test_identify_requires_auth(self):
        r = requests.post(f"{API}/hi/inventory/identify", json={"image_base64": "abc"}, timeout=15)
        assert r.status_code in (401, 403)

    def test_match_requires_auth(self):
        r = requests.get(f"{API}/hi/inventory/match/{DEMO_PROJECT_ID}", timeout=15)
        assert r.status_code in (401, 403)

    def test_apply_requires_auth(self):
        r = requests.post(f"{API}/hi/inventory/match/{DEMO_PROJECT_ID}/apply", json={"apply": True}, timeout=15)
        assert r.status_code in (401, 403)


# -------- CRUD --------
class TestInventoryCRUD:
    def test_add_item_requires_name(self, h):
        r = requests.post(f"{API}/hi/inventory", headers=h, json={"name": "   ", "category": "Tool"}, timeout=TIMEOUT)
        assert r.status_code == 400, r.text

    def test_add_item_success(self, h, state):
        payload = {
            "name": f"TEST_Circular Saw {uuid.uuid4().hex[:6]}",
            "category": "Tool",
            "brand": "TEST_DeWalt",
            "quantity": "1",
            "storage_location": "TEST_Garage Shelf",
            "status": "have",
        }
        r = requests.post(f"{API}/hi/inventory", headers=h, json=payload, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["name"] == payload["name"]
        assert d["category"] == "Tool"
        assert d["status"] == "have"
        assert d["storage_location"] == "TEST_Garage Shelf"
        assert "id" in d
        assert "photo_base64" not in d
        state["created_ids"].append(d["id"])
        state["item"] = d

    def test_list_and_filter(self, h, state):
        # ensure list contains our item
        r = requests.get(f"{API}/hi/inventory", headers=h, timeout=TIMEOUT)
        assert r.status_code == 200
        items = r.json()["items"]
        assert any(x["id"] == state["item"]["id"] for x in items)

        # filter by category
        r2 = requests.get(f"{API}/hi/inventory?category=Tool", headers=h, timeout=TIMEOUT)
        assert r2.status_code == 200
        for it in r2.json()["items"]:
            assert it["category"] == "Tool"

        # search q
        r3 = requests.get(f"{API}/hi/inventory?q=TEST_Circular", headers=h, timeout=TIMEOUT)
        assert r3.status_code == 200
        assert any(x["id"] == state["item"]["id"] for x in r3.json()["items"])

        # filter location
        r4 = requests.get(f"{API}/hi/inventory?location=TEST_Garage Shelf", headers=h, timeout=TIMEOUT)
        assert r4.status_code == 200
        assert any(x["id"] == state["item"]["id"] for x in r4.json()["items"])

    def test_locations_distinct(self, h):
        r = requests.get(f"{API}/hi/inventory/locations", headers=h, timeout=TIMEOUT)
        assert r.status_code == 200
        locs = r.json()["locations"]
        assert isinstance(locs, list)
        assert "TEST_Garage Shelf" in locs

    def test_detail(self, h, state):
        iid = state["item"]["id"]
        r = requests.get(f"{API}/hi/inventory/{iid}", headers=h, timeout=TIMEOUT)
        assert r.status_code == 200
        assert r.json()["id"] == iid

    def test_detail_not_found(self, h):
        r = requests.get(f"{API}/hi/inventory/{uuid.uuid4()}", headers=h, timeout=TIMEOUT)
        assert r.status_code == 404

    def test_update(self, h, state):
        iid = state["item"]["id"]
        r = requests.put(f"{API}/hi/inventory/{iid}", headers=h,
                         json={"status": "low", "brand": "TEST_Ryobi", "notes": "TEST_note"}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "low"
        assert d["brand"] == "TEST_Ryobi"
        # verify persisted via GET
        g = requests.get(f"{API}/hi/inventory/{iid}", headers=h, timeout=TIMEOUT).json()
        assert g["status"] == "low"
        assert g["notes"] == "TEST_note"

    def test_archive_removes_from_list(self, h, state):
        iid = state["item"]["id"]
        r = requests.delete(f"{API}/hi/inventory/{iid}", headers=h, timeout=TIMEOUT)
        assert r.status_code == 200 and r.json().get("ok") is True
        # should NOT appear in list anymore
        items = requests.get(f"{API}/hi/inventory", headers=h, timeout=TIMEOUT).json()["items"]
        assert not any(x["id"] == iid for x in items)


# -------- Identify --------
class TestIdentify:
    def test_identify_empty_400(self, h):
        r = requests.post(f"{API}/hi/inventory/identify", headers=h, json={"image_base64": ""}, timeout=TIMEOUT)
        assert r.status_code == 400

    def test_identify_tiny_image_no_500(self, h):
        # 1x1 transparent PNG
        b64 = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lE"
               "QVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=")
        r = requests.post(f"{API}/hi/inventory/identify", headers=h, json={"image_base64": b64}, timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "identification" in d
        assert isinstance(d["identification"], dict)


# -------- Match against demo project --------
class TestMatch:
    def test_match_demo_project(self, h):
        r = requests.get(f"{API}/hi/inventory/match/{DEMO_PROJECT_ID}", headers=h, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("already_have", "need_to_buy", "need_verification", "counts"):
            assert k in d
        counts = d["counts"]
        assert counts["total"] >= 1
        # Demo has Cordless Drill inventory item → matches material 'Drill or screwdriver'
        assert counts["already_have"] >= 1, f"expected already_have>=1, got {counts}"

    def test_match_project_not_found(self, h):
        r = requests.get(f"{API}/hi/inventory/match/{uuid.uuid4()}", headers=h, timeout=TIMEOUT)
        assert r.status_code == 404

    def test_apply_match_updates_project_materials(self, h):
        r = requests.post(f"{API}/hi/inventory/match/{DEMO_PROJECT_ID}/apply", headers=h,
                          json={"apply": True}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is True
        assert d.get("updated", 0) >= 1
        # verify by checking project materials
        m = requests.get(f"{API}/hi/projects/{DEMO_PROJECT_ID}/materials", headers=h, timeout=TIMEOUT)
        assert m.status_code == 200, m.text
        mats = m.json().get("materials") or m.json()
        if isinstance(mats, dict):
            mats = mats.get("materials", [])
        statuses = {mm.get("user_status") for mm in mats}
        # at least one status should be a match-applied one
        assert statuses & {"have_it", "need_it", "unsure"}, f"no statuses updated: {statuses}"


# -------- Templates-in-Homie --------
class TestTemplatesInHomie:
    def test_chat_reply_reflects_ladder_template(self, h):
        # create a conversation
        r = requests.post(f"{API}/hi/chat/conversations", headers=h,
                          json={"title": "TEST_Ladder Safety Q"}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        conv_id = r.json().get("id") or r.json().get("conversation", {}).get("id")
        assert conv_id, r.text

        # send question about ladder/gutter safety
        msg = requests.post(
            f"{API}/hi/chat/conversations/{conv_id}/message",
            headers=h,
            json={"text": "What ladder safety tips should I follow when cleaning gutters?"},
            timeout=120,
        )
        assert msg.status_code == 200, msg.text
        body = msg.json()
        reply_text = ""
        # find assistant reply text (backend may return {reply:{content}} or a messages list)
        if isinstance(body.get("reply"), dict):
            reply_text = body["reply"].get("content", "") or body["reply"].get("text", "")
        elif isinstance(body.get("message"), dict):
            reply_text = body["message"].get("content", "") or body["message"].get("text", "")
        else:
            for k in ("assistant_message", "assistant"):
                if isinstance(body.get(k), dict):
                    reply_text = body[k].get("content", "") or body[k].get("text", "")
        # Fallback: full body as string
        if not reply_text:
            reply_text = str(body)

        lower = reply_text.lower()
        matched = ("3 points" in lower or "three points" in lower or "overreach" in lower
                   or "point of contact" in lower or "points of contact" in lower)
        assert matched, f"reply did not reflect template guidance. reply={reply_text[:600]}"

        # confirm structure includes suggested_actions somewhere
        has_actions = ("suggested_actions" in str(body))
        assert has_actions, "expected suggested_actions in response structure"

        # cleanup
        requests.delete(f"{API}/hi/chat/conversations/{conv_id}", headers=h, timeout=30)
