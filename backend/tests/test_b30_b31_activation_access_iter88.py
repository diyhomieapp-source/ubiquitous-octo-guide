"""
Build Doc 31 (Onboarding/Activation) + Build Doc 30 (Accessibility & Localization) — iter 88.

Covers:
- Public POST /api/hi/start/intent (normal, emergency, validation)
- Auth flow: /claim (create issue, idempotent, 404), /checklist, /activation
- New homeowner: /new-homeowner GET + /toggle POST (valid + bogus key)
- Accessibility: /meta, /settings GET/PUT (persistence + invalid-ignored + 401)
- Integration: Homie chat reply adapts to language=es + reading_level=simple.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001")).rstrip("/")
DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PWD = __import__("os").environ.get("TEST_USER_PASSWORD", "")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def token(api):
    r = api.post(f"{BASE_URL}/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PWD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token")
    assert tok, "no access_token"
    return tok


@pytest.fixture(scope="module")
def auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# -------------------- Doc 31 public intent --------------------

class TestPublicIntent:
    def test_intent_short_text_returns_400(self, api):
        r = api.post(f"{BASE_URL}/api/hi/start/intent", json={"text": "hi"}, timeout=30)
        assert r.status_code == 400, r.text[:200]

    def test_intent_normal_repair(self, api):
        r = api.post(f"{BASE_URL}/api/hi/start/intent",
                     json={"text": "my toilet keeps running after I flush"}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d.get("is_emergency") is False
        assert d.get("intent_id")
        assert d.get("guest_token")
        assert d.get("need_type")
        assert d.get("category")
        assert d.get("save_prompt")
        res = d.get("result") or {}
        for k in ("likely_diagnosis", "safe_immediate_action", "next_step", "outline"):
            assert k in res, f"missing {k} in result"
        assert isinstance(res["outline"], list) and len(res["outline"]) >= 3
        # store for later
        pytest._intent_id = d["intent_id"]

    def test_intent_emergency_gas(self, api):
        r = api.post(f"{BASE_URL}/api/hi/start/intent",
                     json={"text": "I smell gas near my stove"}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d.get("is_emergency") is True
        assert d.get("need_type") == "emergency"
        assert "safety" in d and d["safety"].get("message")
        assert "save_prompt" not in d, "emergency must NOT include save_prompt"
        assert d.get("result") in (None,), "emergency should not include classification"


# -------------------- Doc 31 claim --------------------

class TestClaim:
    def test_claim_creates_issue(self, api, auth):
        iid = getattr(pytest, "_intent_id", None)
        assert iid, "no intent_id from previous test"
        r = api.post(f"{BASE_URL}/api/hi/start/claim", json={"intent_id": iid}, headers=auth, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d.get("issue_id")
        issue = d.get("issue") or {}
        assert issue.get("source") == "onboarding_intent"
        pytest._issue_id = d["issue_id"]

    def test_claim_idempotent(self, api, auth):
        iid = pytest._intent_id
        r = api.post(f"{BASE_URL}/api/hi/start/claim", json={"intent_id": iid}, headers=auth, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d.get("already_claimed") is True
        assert d.get("issue_id") == pytest._issue_id

    def test_claim_bogus_intent_returns_404(self, api, auth):
        r = api.post(f"{BASE_URL}/api/hi/start/claim",
                     json={"intent_id": "bogus-not-real-intent-id"}, headers=auth, timeout=30)
        assert r.status_code == 404


# -------------------- Doc 31 checklist / activation --------------------

class TestChecklistActivation:
    def test_checklist(self, api, auth):
        r = api.get(f"{BASE_URL}/api/hi/start/checklist", headers=auth, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d.get("has_project") is True
        assert isinstance(d.get("steps"), list) and len(d["steps"]) == 7
        assert "progress" in d and isinstance(d["progress"], int)

    def test_activation(self, api, auth):
        r = api.get(f"{BASE_URL}/api/hi/start/activation", headers=auth, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "activated" in d and isinstance(d["activated"], bool)
        assert isinstance(d.get("signals"), dict)
        for k in ("first_project", "plan_generated", "asset_added", "evidence_uploaded",
                  "material_list", "maintenance_done"):
            assert k in d["signals"]


# -------------------- Doc 31 new homeowner --------------------

class TestNewHomeowner:
    def test_get_new_homeowner(self, api, auth):
        r = api.get(f"{BASE_URL}/api/hi/start/new-homeowner", headers=auth, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d.get("items"), list) and len(d["items"]) == 8
        keys = {i["key"] for i in d["items"]}
        assert "locate_water_shutoff" in keys
        for it in d["items"]:
            assert "done" in it and isinstance(it["done"], bool)

    def test_toggle_manual_persists(self, api, auth):
        r = api.post(f"{BASE_URL}/api/hi/start/new-homeowner/toggle",
                     json={"key": "locate_water_shutoff", "done": True}, headers=auth, timeout=30)
        assert r.status_code == 200
        r2 = api.get(f"{BASE_URL}/api/hi/start/new-homeowner", headers=auth, timeout=30)
        item = next(i for i in r2.json()["items"] if i["key"] == "locate_water_shutoff")
        assert item["done"] is True
        # cleanup: untoggle
        api.post(f"{BASE_URL}/api/hi/start/new-homeowner/toggle",
                 json={"key": "locate_water_shutoff", "done": False}, headers=auth, timeout=30)

    def test_toggle_bogus_key_400(self, api, auth):
        r = api.post(f"{BASE_URL}/api/hi/start/new-homeowner/toggle",
                     json={"key": "bogus_key_xyz", "done": True}, headers=auth, timeout=30)
        assert r.status_code == 400


# -------------------- Doc 30 accessibility --------------------

class TestAccessibility:
    def test_meta(self, api, auth):
        r = api.get(f"{BASE_URL}/api/hi/access/meta", headers=auth, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert any(x["code"] == "es" for x in d["languages"])
        assert "simple" in d["reading_levels"]
        assert "standard" in d["text_sizes"]

    def test_settings_defaults(self, api, auth):
        r = api.get(f"{BASE_URL}/api/hi/access/settings", headers=auth, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "language" in d
        assert "reading_level" in d

    def test_settings_put_valid_persists(self, api, auth):
        r = api.put(f"{BASE_URL}/api/hi/access/settings",
                    json={"language": "es", "reading_level": "simple", "simplified_mode": True},
                    headers=auth, timeout=30)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert d["language"] == "es"
        assert d["reading_level"] == "simple"
        assert d["simplified_mode"] is True
        # re-fetch to confirm persist
        r2 = api.get(f"{BASE_URL}/api/hi/access/settings", headers=auth, timeout=30)
        d2 = r2.json()
        assert d2["language"] == "es" and d2["reading_level"] == "simple"

    def test_settings_invalid_ignored(self, api, auth):
        r = api.put(f"{BASE_URL}/api/hi/access/settings",
                    json={"language": "xx"}, headers=auth, timeout=30)
        assert r.status_code == 200
        d = r.json()
        # language should NOT be xx; either stays 'es' from previous or default
        assert d["language"] != "xx"

    def test_settings_unauth_blocked(self, api):
        r = api.get(f"{BASE_URL}/api/hi/access/settings", timeout=30)
        assert r.status_code in (401, 403)


# -------------------- Doc 30 integration with Homie --------------------

class TestChatSpanishAdaptation:
    def test_chat_reply_uses_spanish_simple(self, api, auth):
        # 1) set settings to es/simple/simplified
        rs = api.put(f"{BASE_URL}/api/hi/access/settings",
                     json={"language": "es", "reading_level": "simple", "simplified_mode": True},
                     headers=auth, timeout=30)
        assert rs.status_code == 200
        assert rs.json().get("language") == "es"
        # 2) create conversation
        rc = api.post(f"{BASE_URL}/api/hi/chat/conversations",
                      json={"title": "Prueba"}, headers=auth, timeout=30)
        assert rc.status_code == 200, rc.text[:200]
        cid = rc.json().get("id") or rc.json().get("conversation", {}).get("id")
        assert cid
        # 3) send message
        rm = api.post(f"{BASE_URL}/api/hi/chat/conversations/{cid}/message",
                      json={"text": "How do I fix a running toilet?"}, headers=auth, timeout=120)
        assert rm.status_code == 200, rm.text[:300]
        j = rm.json()
        assistant = j.get("assistant") or j.get("assistant_message") or {}
        text = assistant.get("text") or assistant.get("content") or ""
        if not text:
            text = str(j)
        lo = text.lower()
        # Simple Spanish heuristic: presence of Spanish stopwords / accented chars
        spanish_markers = [" el ", " la ", " para ", " agua ", " con ", " puede", "inodoro",
                           " es ", " si ", "á", "é", "í", "ó", "ú", "ñ", "¿"]
        hits = sum(1 for m in spanish_markers if m in lo)
        assert hits >= 2, f"Reply does not look Spanish. hits={hits} sample={text[:300]}"


# -------------------- Cleanup: reset access settings --------------------

def test_zzz_reset_access_settings(api, auth):
    r = api.put(f"{BASE_URL}/api/hi/access/settings",
                json={"language": "en", "reading_level": "standard", "simplified_mode": False},
                headers=auth, timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert d["language"] == "en"
    assert d["reading_level"] == "standard"
    assert d["simplified_mode"] is False
