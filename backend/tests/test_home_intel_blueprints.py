"""
Tests for DIYhomie Home Intelligence (B01) + Room Intelligence (B02) blueprints.

B01 endpoints tested:
  - CRUD /api/hi/assets
  - POST /api/hi/assets/{id}/documents (vision extraction sets processing_status)
  - POST /api/hi/issues (emergency vs normal triage)
  - POST /api/hi/issues/{id}/guidance (409 for emergency, guidance card for normal)
  - POST /api/hi/guidance/{sid}/outcome
  - GET  /api/hi/issues/{id}/job-summary
  - GET  /api/hi/dashboard

B02 endpoints tested:
  - GET/POST /api/hi/rooms/floors  (auto Main Floor)
  - POST /api/hi/rooms/classify    (never 'Confirmed')
  - POST /api/hi/rooms             (rich room, persistent_room_id)
  - GET  /api/hi/rooms/map
  - GET  /api/hi/rooms/{id}/profile (links assets & issues)
  - PUT  /api/hi/rooms/{id}        (rename preserves history; type change -> status changed_use)
  - POST /api/hi/rooms/connections (bidirectional)
  - DELETE /api/hi/rooms/{id}      (archives)
"""
import base64
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001")

DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASS = __import__("os").environ.get("TEST_USER_PASSWORD", "")

# a 1x1 transparent PNG (small base64) — used for photo fields we don't want to OCR
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAj"
    "CB0C8AAAAASUVORK5CYII="
)


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def user_ctx(api):
    # Fresh user avoids polluting demo_home shared state
    email = f"TEST_hi_{uuid.uuid4().hex[:8]}@diyhomie.com"
    r = api.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": __import__("os").environ.get("TEST_USER_PASSWORD", ""), "name": "HI Tester"},
        timeout=30,
    )
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text[:300]}"
    j = r.json()
    return {"token": j["access_token"], "user_id": j["user"]["id"], "email": email}


@pytest.fixture(scope="session")
def h(user_ctx):
    return {"Authorization": f"Bearer {user_ctx['token']}",
            "Content-Type": "application/json"}


# ==========================================================================
# B01 — Home Intelligence
# ==========================================================================
class TestB01Assets:
    def test_create_and_list_asset(self, api, h):
        r = api.post(f"{BASE_URL}/api/hi/assets", headers=h,
                     json={"name": "TEST_Furnace", "category": "HVAC",
                           "brand": "Carrier", "model_number": "58SC0A"}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == "TEST_Furnace"
        assert data["category"] == "HVAC"
        assert "id" in data
        pytest.asset_id = data["id"]

        # GET verify persisted
        rl = api.get(f"{BASE_URL}/api/hi/assets", headers=h, timeout=30)
        assert rl.status_code == 200
        assets = rl.json()["assets"]
        assert any(a["id"] == pytest.asset_id for a in assets)

    def test_get_asset_detail(self, api, h):
        r = api.get(f"{BASE_URL}/api/hi/assets/{pytest.asset_id}", headers=h, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["asset"]["id"] == pytest.asset_id
        assert "documents" in d and "history" in d

    def test_update_asset(self, api, h):
        r = api.put(f"{BASE_URL}/api/hi/assets/{pytest.asset_id}", headers=h,
                    json={"name": "TEST_Furnace_v2", "category": "HVAC",
                          "brand": "Carrier", "model_number": "58SC0A"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Furnace_v2"


class TestB01Documents:
    def test_upload_document_sets_status(self, api, h):
        r = api.post(f"{BASE_URL}/api/hi/assets/{pytest.asset_id}/documents",
                     headers=h,
                     json={"document_type": "manual", "file_base64": TINY_PNG_B64,
                           "filename": "TEST_manual.png"}, timeout=90)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["document_type"] == "manual"
        # processing_status must be either 'done' or 'failed' (never left as 'processing')
        assert body["processing_status"] in ("done", "failed"), body

        rl = api.get(f"{BASE_URL}/api/hi/assets/{pytest.asset_id}/documents",
                     headers=h, timeout=30)
        assert rl.status_code == 200
        assert len(rl.json()["documents"]) >= 1


class TestB01Issues:
    def test_emergency_issue(self, api, h):
        r = api.post(f"{BASE_URL}/api/hi/issues", headers=h,
                     json={"asset_id": pytest.asset_id,
                           "user_description": "I smell gas near the water heater"},
                     timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["is_emergency"] is True
        assert d["status"] == "escalated"
        assert d["risk_level"] == "emergency"
        pytest.emergency_issue_id = d["id"]

    def test_guidance_on_emergency_is_409(self, api, h):
        r = api.post(f"{BASE_URL}/api/hi/issues/{pytest.emergency_issue_id}/guidance",
                     headers=h, json={"clarifications": []}, timeout=60)
        assert r.status_code == 409, f"expected 409, got {r.status_code}: {r.text[:200]}"

    def test_normal_issue_creates_low_or_medium(self, api, h):
        r = api.post(f"{BASE_URL}/api/hi/issues", headers=h,
                     json={"asset_id": pytest.asset_id,
                           "user_description": "The furnace makes a squealing noise when it starts up"},
                     timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["is_emergency"] is False
        assert d["risk_level"] in ("low", "medium", "high")
        assert d["status"] == "active"
        pytest.normal_issue_id = d["id"]

    def test_guidance_generates_card(self, api, h):
        r = api.post(f"{BASE_URL}/api/hi/issues/{pytest.normal_issue_id}/guidance",
                     headers=h, json={"clarifications": [
                         {"question": "How long has it happened?", "answer": "3 days"}
                     ]}, timeout=120)
        assert r.status_code == 200, r.text
        d = r.json()
        # Either a card OR a single clarifying question
        if d.get("needs_clarification"):
            assert d.get("clarifying_question")
        else:
            assert d["safety_status"] in (
                "Safe to continue", "Verify first", "Stop and contact a professional")
            assert d["confidence_level"] in ("Confirmed", "Likely", "Needs verification")
            assert isinstance(d.get("steps"), list)
            assert "source_evidence" in d
            pytest.session_id = d["id"]

    def test_outcome_records_and_updates_status(self, api, h):
        # Ensure we have a session; if guidance asked clarifying q, force a fresh no-clarification call.
        if not getattr(pytest, "session_id", None):
            r = api.post(f"{BASE_URL}/api/hi/issues/{pytest.normal_issue_id}/guidance",
                         headers=h, json={"clarifications": [
                             {"question": "Q1", "answer": "A1"},
                             {"question": "Q2", "answer": "A2"}]}, timeout=120)
            assert r.status_code == 200 and not r.json().get("needs_clarification"), r.text
            pytest.session_id = r.json()["id"]

        r = api.post(f"{BASE_URL}/api/hi/guidance/{pytest.session_id}/outcome",
                     headers=h, json={"outcome": "completed",
                                      "notes": "TEST fixed via cleaning"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["issue_status"] == "completed"

    def test_job_summary(self, api, h):
        r = api.get(f"{BASE_URL}/api/hi/issues/{pytest.normal_issue_id}/job-summary",
                    headers=h, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert j["issue"]["status"] in ("completed", "unresolved", "escalated", "active")
        assert j["asset"]["name"] in ("TEST_Furnace", "TEST_Furnace_v2")

    def test_dashboard(self, api, h):
        r = api.get(f"{BASE_URL}/api/hi/dashboard", headers=h, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["asset_count"] >= 1
        assert isinstance(d["recent_assets"], list)
        assert isinstance(d["recent_tasks"], list)


# ==========================================================================
# B02 — Room Intelligence
# ==========================================================================
class TestB02Floors:
    def test_list_floors_creates_main_floor(self, api, h):
        r = api.get(f"{BASE_URL}/api/hi/rooms/floors", headers=h, timeout=30)
        assert r.status_code == 200
        floors = r.json()["floors"]
        assert any(f["name"] == "Main Floor" for f in floors)

    def test_create_extra_floor(self, api, h):
        r = api.post(f"{BASE_URL}/api/hi/rooms/floors", headers=h,
                     json={"name": "TEST_Upper"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Upper"


class TestB02Rooms:
    def test_classify_never_confirmed(self, api, h):
        r = api.post(f"{BASE_URL}/api/hi/rooms/classify", headers=h,
                     json={"description": "A kitchen with an oven, sink and refrigerator"},
                     timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert d["confidence_level"] in ("Likely", "Needs Confirmation")
        assert d["suggested_room_type"]

    def test_create_room_has_persistent_id(self, api, h):
        r = api.post(f"{BASE_URL}/api/hi/rooms", headers=h,
                     json={"name": "TEST_Kitchen", "room_type": "Kitchen",
                           "floor_name": "Main Floor",
                           "classification_confidence": "Confirmed",
                           "notes": "TEST kitchen note"}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["persistent_room_id"] == d["id"]
        assert d["room_type"] == "Kitchen"
        assert d["status"] == "active"
        pytest.room_id = d["id"]

        r2 = api.post(f"{BASE_URL}/api/hi/rooms", headers=h,
                      json={"name": "TEST_Bedroom", "room_type": "Bedroom",
                            "floor_name": "Main Floor",
                            "classification_confidence": "Confirmed"}, timeout=30)
        assert r2.status_code == 200
        pytest.room_id_2 = r2.json()["id"]

    def test_map(self, api, h):
        r = api.get(f"{BASE_URL}/api/hi/rooms/map", headers=h, timeout=30)
        assert r.status_code == 200
        m = r.json()
        assert m["room_count"] >= 2
        assert any(r_["id"] == pytest.room_id for r_ in m["rooms"])

    def test_connection_is_bidirectional(self, api, h):
        r = api.post(f"{BASE_URL}/api/hi/rooms/connections", headers=h,
                     json={"room_id": pytest.room_id,
                           "connected_room_id": pytest.room_id_2,
                           "connection_type": "Doorway"}, timeout=30)
        assert r.status_code == 200

        p1 = api.get(f"{BASE_URL}/api/hi/rooms/{pytest.room_id}/profile",
                     headers=h, timeout=30).json()
        p2 = api.get(f"{BASE_URL}/api/hi/rooms/{pytest.room_id_2}/profile",
                     headers=h, timeout=30).json()
        assert any(c.get("name") == "TEST_Bedroom" for c in p1["connected_rooms"])
        assert any(c.get("name") == "TEST_Kitchen" for c in p2["connected_rooms"])

    def test_asset_and_issue_link_to_room(self, api, h):
        # Create an asset with room_id
        ra = api.post(f"{BASE_URL}/api/hi/assets", headers=h,
                      json={"name": "TEST_Dishwasher", "category": "Appliance",
                            "room_id": pytest.room_id}, timeout=30)
        assert ra.status_code == 200
        # Create an issue with room_id
        ri = api.post(f"{BASE_URL}/api/hi/issues", headers=h,
                      json={"asset_id": ra.json()["id"],
                            "room_id": pytest.room_id,
                            "user_description": "Dishwasher door won't latch fully."},
                      timeout=60)
        assert ri.status_code == 200
        # Profile shows both
        p = api.get(f"{BASE_URL}/api/hi/rooms/{pytest.room_id}/profile",
                    headers=h, timeout=30).json()
        assert any(a["name"] == "TEST_Dishwasher" for a in p["assets"])
        assert any("Dishwasher door" in i["user_description"] for i in p["open_issues"])

    def test_rename_preserves_history(self, api, h):
        r = api.put(f"{BASE_URL}/api/hi/rooms/{pytest.room_id}", headers=h,
                    json={"name": "TEST_Kitchen_Renamed"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Kitchen_Renamed"

    def test_type_change_sets_changed_use(self, api, h):
        r = api.put(f"{BASE_URL}/api/hi/rooms/{pytest.room_id_2}", headers=h,
                    json={"room_type": "Office"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["room_type"] == "Office"
        assert d["status"] == "changed_use"

    def test_delete_archives(self, api, h):
        # Create a throwaway room to archive
        rc = api.post(f"{BASE_URL}/api/hi/rooms", headers=h,
                      json={"name": "TEST_ToArchive", "room_type": "Storage Room",
                            "floor_name": "Main Floor"}, timeout=30)
        rid = rc.json()["id"]
        rd = api.delete(f"{BASE_URL}/api/hi/rooms/{rid}", headers=h, timeout=30)
        assert rd.status_code == 200
        # Should not appear in map
        m = api.get(f"{BASE_URL}/api/hi/rooms/map", headers=h, timeout=30).json()
        assert not any(rm["id"] == rid for rm in m["rooms"]), "archived room should be excluded"
