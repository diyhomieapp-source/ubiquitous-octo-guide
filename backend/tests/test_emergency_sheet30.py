"""Backend tests for Sheet #30 — Disaster Response & Emergency Support."""
import os
import time
import pytest
import requests

def _load_base_url():
    url = os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    if not url:
        # Fallback: read from /app/frontend/.env
        try:
            with open("/app/frontend/.env", "r") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("EXPO_PUBLIC_BACKEND_URL=") or line.startswith("EXPO_BACKEND_URL="):
                        url = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
        except Exception:
            pass
    if not url:
        raise RuntimeError("EXPO_BACKEND_URL not set")
    return url.rstrip("/")


BASE_URL = _load_base_url()

DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASS = __import__("os").environ.get("TEST_USER_PASSWORD", "")


# ---- shared fixtures ----
@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def token(api_client):
    r = api_client.post(f"{BASE_URL}/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASS})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"no token in login response: {r.text}"
    return tok


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---- scenarios list + auth gate ----
class TestScenarios:
    def test_scenarios_requires_auth(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/emergency/scenarios")
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_scenarios_returns_eight(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/emergency/scenarios", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert "scenarios" in data
        scens = data["scenarios"]
        assert isinstance(scens, list) and len(scens) == 8, f"expected 8 scenarios, got {len(scens)}"
        keys = {s["key"] for s in scens}
        expected = {"flood_water", "burst_pipe", "fire_smoke", "storm_roof", "electrical", "gas_leak", "structural", "other"}
        assert keys == expected, f"scenario keys mismatch: {keys} vs {expected}"
        for s in scens:
            assert "key" in s and "label" in s and "icon" in s
            # ensure server does NOT leak internal fields like trade
            assert "trade" not in s


# ---- triage core ----
class TestTriage:
    def _validate_guide(self, data):
        assert "id" in data and "scenario" in data and "scenario_label" in data
        assert "suggested_trade" in data
        g = data.get("guide")
        assert isinstance(g, dict), f"guide missing: {data}"
        for key in ("severity", "headline", "immediate_steps", "do_not", "document", "when_to_call_pro"):
            assert key in g, f"guide missing key {key}"
        assert isinstance(g["immediate_steps"], list) and len(g["immediate_steps"]) >= 1
        assert isinstance(g["do_not"], list)
        assert isinstance(g["document"], list)
        assert g["severity"] in ("call_911", "urgent", "caution")

    def test_triage_burst_pipe_plumbing(self, auth_headers):
        payload = {"scenario": "burst_pipe", "description": "water under sink"}
        r = requests.post(f"{BASE_URL}/api/emergency/triage", headers=auth_headers, json=payload, timeout=60)
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        data = r.json()
        self._validate_guide(data)
        assert data["suggested_trade"] == "Plumbing", data

    def test_triage_fire_smoke_general(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/emergency/triage", headers=auth_headers,
                          json={"scenario": "fire_smoke", "description": "small kitchen smoke"}, timeout=60)
        assert r.status_code == 200
        data = r.json()
        self._validate_guide(data)
        assert data["suggested_trade"] == "General Contractor"

    def test_triage_electrical(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/emergency/triage", headers=auth_headers,
                          json={"scenario": "electrical", "description": "outlet sparked"}, timeout=60)
        assert r.status_code == 200
        data = r.json()
        self._validate_guide(data)
        assert data["suggested_trade"] == "Electrical"

    def test_triage_other_fallback(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/emergency/triage", headers=auth_headers,
                          json={"scenario": "other", "description": "weird noise in wall"}, timeout=60)
        assert r.status_code == 200
        data = r.json()
        self._validate_guide(data)
        assert data["suggested_trade"] == "General Contractor"

    def test_triage_guide_has_no_commercial_push(self, auth_headers):
        """Ensure guide text does not include buy/purchase/affiliate CTA."""
        r = requests.post(f"{BASE_URL}/api/emergency/triage", headers=auth_headers,
                          json={"scenario": "burst_pipe", "description": "leak"}, timeout=60)
        assert r.status_code == 200
        g = r.json()["guide"]
        blob = " ".join([g.get("headline",""), g.get("when_to_call_pro","")] +
                        list(g.get("immediate_steps",[])) + list(g.get("do_not",[])) +
                        list(g.get("temp_fix",[])) + list(g.get("document",[]))).lower()
        forbidden = ["buy now", "purchase", "affiliate", "amazon", "shop now", "add to cart"]
        hits = [w for w in forbidden if w in blob]
        assert not hits, f"guide contains commercial CTA: {hits}\n{blob[:400]}"


# ---- events log + timeline + no photo leak ----
class TestEventsAndTimeline:
    def test_events_grow_and_no_photo_leak(self, auth_headers):
        before = requests.get(f"{BASE_URL}/api/emergency/events", headers=auth_headers)
        assert before.status_code == 200
        n0 = len(before.json())

        # trigger a triage w/ a dummy photo string
        r = requests.post(f"{BASE_URL}/api/emergency/triage", headers=auth_headers,
                          json={"scenario": "storm_roof", "description": "TEST_shingle missing",
                                "photo_base64": "TEST_FAKE_B64"}, timeout=60)
        assert r.status_code == 200
        new_id = r.json()["id"]

        # small buffer for eventual consistency
        time.sleep(0.5)
        after = requests.get(f"{BASE_URL}/api/emergency/events", headers=auth_headers)
        assert after.status_code == 200
        rows = after.json()
        assert len(rows) >= n0 + 1, f"events did not grow: before={n0} after={len(rows)}"
        found = next((e for e in rows if e.get("id") == new_id), None)
        assert found, "new event not returned in /emergency/events"
        # photo must NOT leak
        assert "photo_base64" not in found, f"photo_base64 leaked in events response: {found}"
        # scenario fields present
        assert found.get("scenario") == "storm_roof"
        assert found.get("suggested_trade") == "Roofing"

    def test_events_requires_auth(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/emergency/events")
        assert r.status_code in (401, 403)

    def test_timeline_contains_emergency_entry(self, auth_headers):
        """Verify triage logs a timeline entry visible via /home and /portfolio.

        Note: /portfolio projection strips the `type` field, so we identify
        emergency entries by the story_title marker '⚠️ Emergency logged:'.
        """
        # First trigger a fresh triage so we have a known marker
        r = requests.post(f"{BASE_URL}/api/emergency/triage", headers=auth_headers,
                          json={"scenario": "gas_leak", "description": "TEST_gas smell in kitchen"}, timeout=60)
        assert r.status_code == 200
        label = r.json().get("scenario_label", "")
        time.sleep(0.4)

        found = None
        for path in ("/api/portfolio", "/api/home"):
            resp = requests.get(f"{BASE_URL}{path}", headers=auth_headers)
            if resp.status_code != 200:
                continue
            data = resp.json()
            # collect candidate lists
            lists = []
            if isinstance(data, dict):
                for key in ("projects", "timeline", "log", "items"):
                    v = data.get(key)
                    if isinstance(v, list):
                        lists.append(v)
            for items in lists:
                for it in items:
                    if not isinstance(it, dict):
                        continue
                    title = (it.get("story_title") or it.get("title") or "")
                    if "Emergency logged" in title and label in title:
                        found = it
                        break
                if found:
                    break
            if found:
                break
        assert found, "no timeline entry with 'Emergency logged' found in /api/portfolio or /api/home"
