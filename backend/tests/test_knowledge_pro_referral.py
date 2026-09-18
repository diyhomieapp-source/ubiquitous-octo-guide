"""Backend tests for Info Sheet #12: Knowledge Search + Pro-Referral hand-off (iteration 20)."""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or \
    os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"

DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASS = __import__("os").environ.get("TEST_USER_PASSWORD", "")
ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASS = __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")


# ------------------------------ fixtures
@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def user_token(api):
    r = api.post(f"{BASE_URL}/api/auth/login",
                 json={"email": DEMO_EMAIL, "password": DEMO_PASS})
    if r.status_code != 200:
        # register fresh
        email = f"TEST_kbsearch_{uuid.uuid4().hex[:8]}@diyhomie.com"
        r = api.post(f"{BASE_URL}/api/auth/register",
                     json={"email": email, "password": __import__("os").environ.get("TEST_USER_PASSWORD", ""), "name": "TEST KB"})
        assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_token(api):
    r = api.post(f"{BASE_URL}/api/auth/login",
                 json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


# ------------------------------ Knowledge Search
class TestKnowledgeSearch:
    def test_search_leaky_faucet_returns_grouped_results(self, api, user_token):
        r = api.get(f"{BASE_URL}/api/knowledge/search",
                    params={"q": "leaky faucet"},
                    headers=_h(user_token), timeout=45)
        assert r.status_code == 200, r.text
        data = r.json()
        # response shape
        for k in ("query", "results", "related", "did_you_mean", "counts"):
            assert k in data, f"missing key {k}"
        assert data["query"] == "leaky faucet"
        assert isinstance(data["results"], list)
        assert isinstance(data["related"], list)
        assert isinstance(data["counts"], dict)

        # every result should have canonical fields
        for r_item in data["results"]:
            assert r_item["type"] in ("guide", "community", "tip", "question")
            assert "title" in r_item and "snippet" in r_item and "route" in r_item

    def test_search_returns_ai_related_terms(self, api, user_token):
        r = api.get(f"{BASE_URL}/api/knowledge/search",
                    params={"q": "leaky faucet"},
                    headers=_h(user_token), timeout=45)
        assert r.status_code == 200
        data = r.json()
        # AI expansion may occasionally fail — assert list type and (best-effort) content
        assert isinstance(data["related"], list)
        # Not strictly required by contract but usually populated by gpt-4o-mini
        if len(data["related"]) > 0:
            assert all(isinstance(t, str) and len(t) > 0 for t in data["related"])

    def test_search_short_query_returns_empty(self, api, user_token):
        r = api.get(f"{BASE_URL}/api/knowledge/search",
                    params={"q": "a"}, headers=_h(user_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["results"] == []
        assert data["counts"] == {}

    def test_search_nonsense_returns_zero_results(self, api, user_token):
        r = api.get(f"{BASE_URL}/api/knowledge/search",
                    params={"q": "zxzxzxqqppqqzzzz"},
                    headers=_h(user_token), timeout=45)
        assert r.status_code == 200
        data = r.json()
        assert len(data["results"]) == 0
        assert data["counts"] == {} or all(v == 0 for v in data["counts"].values())

    def test_search_expand_false_skips_llm(self, api, user_token):
        r = api.get(f"{BASE_URL}/api/knowledge/search",
                    params={"q": "paint room", "expand": "false"},
                    headers=_h(user_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["related"] == []
        assert data["did_you_mean"] is None

    def test_search_requires_auth(self, api):
        r = api.get(f"{BASE_URL}/api/knowledge/search",
                    params={"q": "leaky faucet"}, timeout=15)
        assert r.status_code in (401, 403)


# ------------------------------ Pro Referrals
class TestProReferralTrades:
    def test_trades_list_public(self, api):
        r = api.get(f"{BASE_URL}/api/pro-referrals/trades", timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert "trades" in data
        trades = data["trades"]
        assert isinstance(trades, list) and len(trades) >= 5
        # Sanity: known trades present
        for expected in ("Plumbing", "Electrical", "HVAC"):
            assert expected in trades, f"missing trade: {expected}"


class TestProReferralCreate:
    _created_lead_id = None

    def test_create_lead_persists(self, api, user_token):
        payload = {
            "trade": "Electrical",
            "issue": "TEST outlet flickering when microwave runs — need help diagnosing.",
            "location": "Austin, TX",
            "urgency": "standard",
        }
        r = api.post(f"{BASE_URL}/api/pro-referrals",
                     json=payload, headers=_h(user_token), timeout=15)
        assert r.status_code == 200, r.text
        lead = r.json()
        assert lead["trade"] == "Electrical"
        assert lead["issue"].startswith("TEST outlet flickering")
        assert lead["location"] == "Austin, TX"
        assert lead["urgency"] == "standard"
        assert lead["status"] == "new"
        assert "id" in lead and "email" in lead
        TestProReferralCreate._created_lead_id = lead["id"]

    def test_create_lead_verify_via_me(self, api, user_token):
        r = api.get(f"{BASE_URL}/api/pro-referrals/me",
                    headers=_h(user_token), timeout=15)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        # Should contain the lead we just created
        ids = [i["id"] for i in items]
        assert TestProReferralCreate._created_lead_id in ids

    def test_create_lead_urgency_defaults(self, api, user_token):
        # Bad urgency should be coerced to 'standard'
        r = api.post(f"{BASE_URL}/api/pro-referrals",
                     json={"trade": "Plumbing", "issue": "TEST invalid urgency coercion.",
                           "urgency": "asap"},
                     headers=_h(user_token), timeout=15)
        assert r.status_code == 200
        assert r.json()["urgency"] == "standard"

    def test_create_lead_requires_auth(self, api):
        r = api.post(f"{BASE_URL}/api/pro-referrals",
                     json={"trade": "Plumbing", "issue": "no auth"}, timeout=10)
        assert r.status_code in (401, 403)


# ------------------------------ Admin Pro Leads
class TestAdminProLeads:
    def test_admin_list_leads(self, api, admin_token):
        r = api.get(f"{BASE_URL}/api/admin/pro-leads",
                    headers=_h(admin_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "items" in data
        assert isinstance(data["items"], list)
        # At least our created lead should exist
        assert len(data["items"]) >= 1
        for lead in data["items"][:3]:
            for k in ("id", "trade", "issue", "urgency", "status", "email"):
                assert k in lead, f"missing {k} in lead"

    def test_admin_gating(self, api, user_token):
        r = api.get(f"{BASE_URL}/api/admin/pro-leads",
                    headers=_h(user_token), timeout=10)
        assert r.status_code == 403

    def test_admin_patch_lead_status(self, api, admin_token):
        # find our lead
        r = api.get(f"{BASE_URL}/api/admin/pro-leads",
                    headers=_h(admin_token), timeout=15)
        assert r.status_code == 200
        items = r.json()["items"]
        target = None
        for l in items:
            if TestProReferralCreate._created_lead_id and l["id"] == TestProReferralCreate._created_lead_id:
                target = l
                break
        if not target:
            target = items[0]  # fallback

        # update to contacted
        r2 = api.patch(f"{BASE_URL}/api/admin/pro-leads/{target['id']}",
                       json={"status": "contacted"},
                       headers=_h(admin_token), timeout=10)
        assert r2.status_code == 200
        assert r2.json()["ok"] is True

        # verify persisted
        r3 = api.get(f"{BASE_URL}/api/admin/pro-leads",
                     headers=_h(admin_token), timeout=15)
        updated = [l for l in r3.json()["items"] if l["id"] == target["id"]][0]
        assert updated["status"] == "contacted"

    def test_admin_patch_invalid_status(self, api, admin_token):
        r = api.get(f"{BASE_URL}/api/admin/pro-leads",
                    headers=_h(admin_token), timeout=15)
        items = r.json()["items"]
        if not items:
            pytest.skip("no lead available for patch invalid test")
        r2 = api.patch(f"{BASE_URL}/api/admin/pro-leads/{items[0]['id']}",
                       json={"status": "banana"},
                       headers=_h(admin_token), timeout=10)
        assert r2.status_code == 400
