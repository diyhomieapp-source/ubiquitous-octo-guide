"""
Backend tests for Admin CRM + Vendor/Subscription DB (iteration 12).
Covers:
  - /api/admin/crm/stats
  - /api/admin/crm/contacts
  - /api/admin/crm/contacts/{id}
  - PUT /api/admin/crm/contacts/{id}
  - POST/DELETE /api/admin/crm/contacts/{id}/notes
  - POST /api/admin/crm/contacts/{id}/tags
  - /api/admin/vendors (GET/POST/PUT/DELETE) + /api/admin/vendors/stats
  - admin-auth enforcement (403 without admin)
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://step-by-step-diy.preview.emergentagent.com").rstrip("/")

ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASSWORD = "diyhomie1122"
USER_EMAIL = "demo_home@diyhomie.com"
USER_PASSWORD = "Test1234"


# ----- session / token helpers -----
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=20)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"no token in response: {r.json()}"
    return tok


@pytest.fixture(scope="session")
def user_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": USER_EMAIL, "password": USER_PASSWORD}, timeout=20)
    assert r.status_code == 200, f"user login failed: {r.status_code} {r.text}"
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def user_headers(user_token):
    return {"Authorization": f"Bearer {user_token}", "Content-Type": "application/json"}


# ===================== AUTH GATING =====================
class TestAdminAuthGating:
    """Every admin endpoint must 401/403 without admin auth."""

    @pytest.mark.parametrize("method,path", [
        ("GET", "/api/admin/crm/stats"),
        ("GET", "/api/admin/crm/contacts"),
        ("GET", "/api/admin/vendors"),
        ("GET", "/api/admin/vendors/stats"),
        ("POST", "/api/admin/vendors"),
    ])
    def test_no_token_rejected(self, method, path):
        r = requests.request(method, f"{BASE_URL}{path}", json={}, timeout=15)
        assert r.status_code in (401, 403), f"{method} {path} expected 401/403, got {r.status_code}"

    @pytest.mark.parametrize("method,path", [
        ("GET", "/api/admin/crm/stats"),
        ("GET", "/api/admin/crm/contacts"),
        ("GET", "/api/admin/vendors"),
        ("GET", "/api/admin/vendors/stats"),
    ])
    def test_non_admin_user_rejected(self, method, path, user_headers):
        r = requests.request(method, f"{BASE_URL}{path}", headers=user_headers, timeout=15)
        assert r.status_code == 403, f"{method} {path} expected 403 for non-admin, got {r.status_code}"


# ===================== CRM STATS / SEGMENTS =====================
class TestCrmStats:
    def test_crm_stats_shape(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/crm/stats", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ["total_users", "new_today", "active_7d", "trial_users", "paying_users",
                  "revenue_cents", "projects_created", "community_contributors", "segments"]:
            assert k in d, f"missing key {k}"
        assert isinstance(d["segments"], list) and len(d["segments"]) > 0
        # each segment dict has name + count
        for s in d["segments"]:
            assert "name" in s and "count" in s
            assert isinstance(s["count"], int)
        assert d["total_users"] >= 1
        # demo user + admin should exist -> at least 2 contacts
        assert d["total_users"] >= 2


# ===================== CRM CONTACTS LIST =====================
class TestCrmContacts:
    def test_list_contacts_default(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/crm/contacts?limit=50", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "contacts" in d and "total" in d
        assert isinstance(d["contacts"], list)
        # at least admin + demo present
        assert d["total"] >= 2
        c0 = d["contacts"][0]
        for k in ["id", "email", "plan", "membership_status", "ltv_cents", "segments"]:
            assert k in c0, f"missing field {k} in contact"
        assert isinstance(c0["segments"], list)
        # _id must NOT leak
        assert "_id" not in c0

    def test_search_filter(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/crm/contacts?search=diyhomie", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["total"] >= 1
        assert any("diyhomie" in (c.get("email") or "").lower() for c in d["contacts"])

    def test_sort_name(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/crm/contacts?sort=name&limit=100", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        names = [(c.get("name") or c["email"]).lower() for c in r.json()["contacts"]]
        assert names == sorted(names)


# ===================== CRM CONTACT DETAIL / UPDATE / TAGS / NOTES =====================
class TestCrmContactDetail:
    @pytest.fixture(scope="class")
    def demo_user_id(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/crm/contacts?search={USER_EMAIL}", headers=admin_headers, timeout=20)
        assert r.status_code == 200
        contacts = r.json()["contacts"]
        match = [c for c in contacts if c["email"].lower() == USER_EMAIL.lower()]
        assert match, "demo user not present in CRM"
        return match[0]["id"]

    def test_detail_returns_timeline_and_notes(self, admin_headers, demo_user_id):
        r = requests.get(f"{BASE_URL}/api/admin/crm/contacts/{demo_user_id}", headers=admin_headers, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d["id"] == demo_user_id
        assert "timeline" in d and isinstance(d["timeline"], list)
        assert "notes" in d and isinstance(d["notes"], list)
        assert "_id" not in d

    def test_404_on_unknown_contact(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/crm/contacts/__does_not_exist__", headers=admin_headers, timeout=10)
        assert r.status_code == 404

    def test_update_phone_country_state_persists(self, admin_headers, demo_user_id):
        payload = {"phone": "+15551112233", "country": "US", "state": "CA"}
        r = requests.put(f"{BASE_URL}/api/admin/crm/contacts/{demo_user_id}", headers=admin_headers, json=payload, timeout=15)
        assert r.status_code == 200
        # GET to verify
        r2 = requests.get(f"{BASE_URL}/api/admin/crm/contacts/{demo_user_id}", headers=admin_headers, timeout=15)
        assert r2.status_code == 200
        d = r2.json()
        assert d["phone"] == "+15551112233"
        assert d["country"] == "US"
        assert d["state"] == "CA"

    def test_set_tags(self, admin_headers, demo_user_id):
        payload = {"tags": ["TEST_tag_a", "TEST_tag_b", "  TEST_tag_a  "]}  # dedup + strip
        r = requests.post(f"{BASE_URL}/api/admin/crm/contacts/{demo_user_id}/tags", headers=admin_headers, json=payload, timeout=15)
        assert r.status_code == 200
        tags = r.json()["tags"]
        assert "TEST_tag_a" in tags and "TEST_tag_b" in tags
        assert tags == sorted(set(tags))
        # cleanup -> clear tags
        requests.post(f"{BASE_URL}/api/admin/crm/contacts/{demo_user_id}/tags", headers=admin_headers, json={"tags": []}, timeout=10)

    def test_add_and_delete_note(self, admin_headers, demo_user_id):
        body = "TEST_crm_note from automated test"
        r = requests.post(
            f"{BASE_URL}/api/admin/crm/contacts/{demo_user_id}/notes",
            headers=admin_headers, json={"body": body}, timeout=15,
        )
        assert r.status_code == 200
        note = r.json()
        assert note["body"] == body
        assert "id" in note and "created_at" in note
        note_id = note["id"]
        # Verify appears in detail
        d = requests.get(f"{BASE_URL}/api/admin/crm/contacts/{demo_user_id}", headers=admin_headers, timeout=10).json()
        assert any(n["id"] == note_id for n in d["notes"])
        # Delete
        rd = requests.delete(f"{BASE_URL}/api/admin/crm/notes/{note_id}", headers=admin_headers, timeout=10)
        assert rd.status_code == 200
        d2 = requests.get(f"{BASE_URL}/api/admin/crm/contacts/{demo_user_id}", headers=admin_headers, timeout=10).json()
        assert not any(n["id"] == note_id for n in d2["notes"])


# ===================== VENDORS =====================
EXPECTED_SEEDED = {"Perplexity AI", "OpenAI", "Anthropic", "Stripe", "MongoDB", "WeatherAPI.com", "Emergent"}


class TestVendors:
    def test_list_vendors_seeded(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/vendors", headers=admin_headers, timeout=20)
        assert r.status_code == 200
        vendors = r.json()
        assert isinstance(vendors, list) and len(vendors) >= 7
        names = {v["company"] for v in vendors}
        missing = EXPECTED_SEEDED - names
        assert not missing, f"missing seeded vendors: {missing}"
        # _id must not leak
        for v in vendors:
            assert "_id" not in v
            for k in ["id", "company", "category", "importance"]:
                assert k in v

    def test_vendor_stats(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/vendors/stats", headers=admin_headers, timeout=20)
        assert r.status_code == 200
        d = r.json()
        for k in ["total", "monthly_spend_cents", "annual_spend_cents", "critical", "categories", "upcoming_renewals"]:
            assert k in d
        assert d["total"] >= 7
        assert d["critical"] >= 5  # 5 critical in seed (perplexity, openai, stripe, mongodb, emergent)
        assert isinstance(d["categories"], list)

    def test_category_filter(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/vendors?category=AI Platforms", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        vendors = r.json()
        assert len(vendors) >= 3  # perplexity, openai, anthropic
        for v in vendors:
            assert v["category"] == "AI Platforms"

    def test_vendor_crud_flow(self, admin_headers):
        # CREATE
        payload = {
            "company": "TEST_VendorCo",
            "category": "Other",
            "importance": "low",
            "monthly_cost_cents": 999,
            "website": "https://example.com",
            "feature_description": "TEST vendor",
        }
        rc = requests.post(f"{BASE_URL}/api/admin/vendors", headers=admin_headers, json=payload, timeout=15)
        assert rc.status_code == 200, rc.text
        v = rc.json()
        vid = v["id"]
        assert v["company"] == "TEST_VendorCo"
        assert v["monthly_cost_cents"] == 999

        # READ back via list
        rl = requests.get(f"{BASE_URL}/api/admin/vendors?search=TEST_VendorCo", headers=admin_headers, timeout=10)
        assert rl.status_code == 200
        assert any(x["id"] == vid for x in rl.json())

        # UPDATE
        payload["monthly_cost_cents"] = 1500
        payload["importance"] = "medium"
        ru = requests.put(f"{BASE_URL}/api/admin/vendors/{vid}", headers=admin_headers, json=payload, timeout=10)
        assert ru.status_code == 200
        upd = ru.json()
        assert upd["monthly_cost_cents"] == 1500
        assert upd["importance"] == "medium"

        # UPDATE on unknown -> 404
        r404 = requests.put(f"{BASE_URL}/api/admin/vendors/__none__", headers=admin_headers, json=payload, timeout=10)
        assert r404.status_code == 404

        # DELETE
        rd = requests.delete(f"{BASE_URL}/api/admin/vendors/{vid}", headers=admin_headers, timeout=10)
        assert rd.status_code == 200
        # verify gone
        rl2 = requests.get(f"{BASE_URL}/api/admin/vendors?search=TEST_VendorCo", headers=admin_headers, timeout=10)
        assert not any(x["id"] == vid for x in rl2.json())


# ===================== LAST-LOGIN TRACKING =====================
class TestLastLoginTracking:
    def test_login_updates_last_login(self, admin_headers):
        # login again
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": USER_EMAIL, "password": USER_PASSWORD}, timeout=15)
        assert r.status_code == 200
        # find demo user via CRM and verify last_login present
        rs = requests.get(f"{BASE_URL}/api/admin/crm/contacts?search={USER_EMAIL}", headers=admin_headers, timeout=15)
        assert rs.status_code == 200
        match = [c for c in rs.json()["contacts"] if c["email"].lower() == USER_EMAIL.lower()]
        assert match and match[0].get("last_login"), "last_login not tracked"
