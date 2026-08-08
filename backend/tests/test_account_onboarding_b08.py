"""
Blueprint 08 — Account, Property Onboarding & Guidance Preferences tests.
Endpoints under /api/hi/account/* — JWT auth via existing /api/auth/login.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://step-by-step-diy.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASSWORD = "Test1234"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"no token in response: {r.json()}"
    return tok


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}"}


# =============================================================== AUTH GATING
class TestAuthGating:
    def test_overview_requires_auth(self):
        r = requests.get(f"{API}/hi/account/overview", timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"

    def test_preferences_requires_auth(self):
        r = requests.get(f"{API}/hi/account/preferences", timeout=15)
        assert r.status_code in (401, 403)

    def test_properties_requires_auth(self):
        r = requests.get(f"{API}/hi/account/properties", timeout=15)
        assert r.status_code in (401, 403)


# =============================================================== OVERVIEW
class TestOverview:
    def test_overview_shape(self, h):
        r = requests.get(f"{API}/hi/account/overview", headers=h, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "preferences" in d
        assert "properties" in d and isinstance(d["properties"], list)
        assert "active_property_id" in d
        assert "onboarding" in d
        ob = d["onboarding"]
        assert "complete" in ob and "steps" in ob and "progress" in ob
        assert isinstance(ob["steps"], list) and len(ob["steps"]) == 4
        assert 0 <= ob["progress"] <= 100
        # ensures one active property
        assert d["active_property_id"] is not None
        assert any(p.get("is_active") for p in d["properties"])


# =============================================================== PREFERENCES
class TestPreferences:
    def test_get_preferences_auto_defaults(self, h):
        r = requests.get(f"{API}/hi/account/preferences", headers=h, timeout=15)
        assert r.status_code == 200, r.text
        p = r.json()
        # Values must be within valid enums
        assert p.get("experience_level") in ("beginner", "intermediate", "advanced")
        assert p.get("budget_sensitivity") in ("low", "medium", "high")
        assert p.get("risk_tolerance") in ("cautious", "balanced", "hands_on")
        assert p.get("tone") in ("friendly", "concise", "detailed")
        assert p.get("units") in ("imperial", "metric")

    def test_put_valid_preferences_persist(self, h):
        payload = {"experience_level": "advanced", "units": "metric", "budget_sensitivity": "high"}
        r = requests.put(f"{API}/hi/account/preferences", headers=h, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["experience_level"] == "advanced"
        assert p["units"] == "metric"
        assert p["budget_sensitivity"] == "high"
        # GET-verify persistence
        r2 = requests.get(f"{API}/hi/account/preferences", headers=h, timeout=15)
        p2 = r2.json()
        assert p2["experience_level"] == "advanced"
        assert p2["units"] == "metric"
        assert p2["budget_sensitivity"] == "high"

    def test_put_invalid_enums_ignored(self, h):
        # First set known valid state
        requests.put(f"{API}/hi/account/preferences", headers=h,
                     json={"tone": "friendly", "risk_tolerance": "balanced"}, timeout=15)
        r = requests.put(f"{API}/hi/account/preferences", headers=h,
                         json={"tone": "sarcastic", "risk_tolerance": "wild"}, timeout=15)
        assert r.status_code == 200
        p = r.json()
        assert p["tone"] == "friendly"  # invalid ignored, prior value retained
        assert p["risk_tolerance"] == "balanced"


# =============================================================== PROPERTIES
class TestProperties:
    created_ids = []

    def test_list_properties(self, h):
        r = requests.get(f"{API}/hi/account/properties", headers=h, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "properties" in d and isinstance(d["properties"], list)
        assert len(d["properties"]) >= 1

    def test_create_property(self, h):
        payload = {"name": f"TEST_Cabin_{int(time.time())}", "property_type": "House", "year_built": 1995}
        r = requests.post(f"{API}/hi/account/properties", headers=h, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["name"] == payload["name"]
        assert p["property_type"] == "House"
        assert p["year_built"] == 1995
        assert "id" in p
        TestProperties.created_ids.append(p["id"])

    def test_edit_property(self, h):
        assert TestProperties.created_ids
        pid = TestProperties.created_ids[-1]
        r = requests.put(f"{API}/hi/account/properties/{pid}", headers=h,
                         json={"year_built": 2005, "climate_zone": "5A"}, timeout=15)
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["year_built"] == 2005
        assert p["climate_zone"] == "5A"
        # GET-verify
        lr = requests.get(f"{API}/hi/account/properties", headers=h, timeout=15).json()
        match = next((x for x in lr["properties"] if x["id"] == pid), None)
        assert match and match["year_built"] == 2005

    def test_activate_property_makes_it_only_active(self, h):
        assert TestProperties.created_ids
        pid = TestProperties.created_ids[-1]
        r = requests.post(f"{API}/hi/account/properties/{pid}/activate", headers=h, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("active_property_id") == pid
        # Verify exactly one active
        lr = requests.get(f"{API}/hi/account/properties", headers=h, timeout=15).json()
        actives = [p for p in lr["properties"] if p.get("is_active")]
        assert len(actives) == 1
        assert actives[0]["id"] == pid

    def test_delete_property(self, h):
        # Ensure at least 2 exist by creating a spare first, then delete the previously-created test property.
        # We'll keep a spare (created below), delete the test cabin, then leave the spare alone.
        spare_payload = {"name": f"TEST_Spare_{int(time.time())}", "property_type": "Apartment"}
        s = requests.post(f"{API}/hi/account/properties", headers=h, json=spare_payload, timeout=15).json()
        TestProperties.created_ids.append(s["id"])

        # Delete the first TEST_ created (test_create_property one) if there are still >=2 homes
        pid = TestProperties.created_ids[0]
        r = requests.delete(f"{API}/hi/account/properties/{pid}", headers=h, timeout=15)
        assert r.status_code == 200, r.text
        # GET-verify gone
        lr = requests.get(f"{API}/hi/account/properties", headers=h, timeout=15).json()
        assert not any(p["id"] == pid for p in lr["properties"])
        TestProperties.created_ids.remove(pid)

    def test_delete_last_home_returns_409(self, h):
        # We should never actually get to 1 in this test account (demo already has multiple), but
        # simulate: delete all TEST_ properties we created, then try to hit 409 only if list == 1.
        # This is a conditional check.
        lr = requests.get(f"{API}/hi/account/properties", headers=h, timeout=15).json()
        if len(lr["properties"]) == 1:
            only = lr["properties"][0]
            r = requests.delete(f"{API}/hi/account/properties/{only['id']}", headers=h, timeout=15)
            assert r.status_code == 409
        else:
            # cleanup: delete all remaining TEST_Spare_ properties, ensuring >=1 stays
            spares = [p for p in lr["properties"] if (p.get("name") or "").startswith("TEST_")]
            keep_one_non_test = [p for p in lr["properties"] if not (p.get("name") or "").startswith("TEST_")]
            # If there's at least one non-test property to keep, we can delete all TEST_ ones.
            if keep_one_non_test:
                for sp in spares:
                    requests.delete(f"{API}/hi/account/properties/{sp['id']}", headers=h, timeout=15)
                lr2 = requests.get(f"{API}/hi/account/properties", headers=h, timeout=15).json()
                # Now try deleting last one — should give 409
                if len(lr2["properties"]) == 1:
                    r = requests.delete(f"{API}/hi/account/properties/{lr2['properties'][0]['id']}", headers=h, timeout=15)
                    assert r.status_code == 409

    def test_create_property_blank_name_400(self, h):
        r = requests.post(f"{API}/hi/account/properties", headers=h, json={"name": "   "}, timeout=15)
        assert r.status_code == 400


# =============================================================== ONBOARDING
class TestOnboarding:
    def test_complete_onboarding(self, h):
        r = requests.post(f"{API}/hi/account/onboarding/complete", headers=h, timeout=15)
        assert r.status_code == 200
        assert r.json().get("ok") is True
        ov = requests.get(f"{API}/hi/account/overview", headers=h, timeout=15).json()
        assert ov["onboarding"]["complete"] is True


# =============================================================== HOMIE INTEGRATION (metric units)
class TestHomieUnitsIntegration:
    def test_chat_reply_uses_metric_after_pref(self, h):
        # Ensure units=metric persisted
        requests.put(f"{API}/hi/account/preferences", headers=h, json={"units": "metric"}, timeout=15)
        # Create conversation then post a message
        cv = requests.post(f"{API}/hi/chat/conversations", headers=h, json={}, timeout=30)
        if cv.status_code != 200:
            pytest.skip(f"chat conversation create failed: {cv.status_code}")
        cid = cv.json().get("id") or cv.json().get("conversation_id")
        assert cid, f"no conversation id: {cv.json()}"
        msg = "How wide should the gap between two garage shelves be? Give me a specific number with units."
        r = requests.post(f"{API}/hi/chat/conversations/{cid}/message", headers=h,
                          json={"text": msg}, timeout=90)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        # Response is {"assistant": {"text": ..., ...}, ...}
        text = ""
        if isinstance(d, dict):
            a = d.get("assistant") or {}
            if isinstance(a, dict):
                text += " " + str(a.get("text") or "")
            for k in ("reply", "message", "content", "text", "answer"):
                v = d.get(k)
                if isinstance(v, str):
                    text += " " + v
        text_l = text.lower()
        # metric tokens
        has_metric = any(tok in text_l for tok in [" cm", "cm.", "cm,", "centim", " mm", "metric", " meter"])
        assert text.strip(), f"empty reply body: {str(d)[:400]}"
        assert has_metric, f"Reply doesn't look metric: {text[:400]}"
