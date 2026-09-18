"""
Backend tests for Blueprint 26 — Asset Exit, Resale & Responsible Disposition Engine.
Covers user + admin flows, valuation (AI), routing, listing, completion, lifecycle, RBAC.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001")

ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASSWORD = __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")
USER_EMAIL = "demo_home@diyhomie.com"
USER_PASSWORD = __import__("os").environ.get("TEST_USER_PASSWORD", "")


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_h():
    return {"Authorization": f"Bearer {_login(ADMIN_EMAIL, ADMIN_PASSWORD)}"}


@pytest.fixture(scope="module")
def user_h():
    return {"Authorization": f"Bearer {_login(USER_EMAIL, USER_PASSWORD)}"}


# ------------------------------------------------------------------ config
class TestExitConfig:
    def test_config_shape(self, user_h):
        r = requests.get(f"{BASE_URL}/api/hi/exit/config", headers=user_h, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "categories" in d and len(d["categories"]) > 0
        assert "condition_labels" in d and "Good" in d["condition_labels"]
        assert "working_status" in d and "working" in d["working_status"]
        assert "exit_types" in d and "private_sale" in d["exit_types"]


# ------------------------------------------------------------------ USER flow — valuable Good/working item
@pytest.fixture(scope="module")
def valuable_case_id(user_h):
    r = requests.post(f"{BASE_URL}/api/hi/exit/cases", headers=user_h,
                      json={"title": "TEST_iPhone 12 128GB Unlocked", "category": "Phones & Electronics"}, timeout=20)
    assert r.status_code == 200, r.text[:300]
    return r.json()["case"]["id"]


class TestUserFlowValuable:
    def test_case_created(self, user_h, valuable_case_id):
        assert isinstance(valuable_case_id, str) and len(valuable_case_id) > 10

    def test_list_includes_case(self, user_h, valuable_case_id):
        r = requests.get(f"{BASE_URL}/api/hi/exit/cases", headers=user_h, timeout=15)
        assert r.status_code == 200
        ids = [c["id"] for c in r.json()["cases"]]
        assert valuable_case_id in ids

    def test_assess(self, user_h, valuable_case_id):
        r = requests.post(f"{BASE_URL}/api/hi/exit/cases/{valuable_case_id}/assess", headers=user_h,
                          json={"user_reported_condition": "Good", "working_status": "working",
                                "visible_damage_notes": "Minor scratches on back"}, timeout=20)
        assert r.status_code == 200, r.text[:300]
        assess = r.json()["assessment"]
        assert assess["user_reported_condition"] == "Good"
        assert assess["working_status"] == "working"

    def test_options_generation(self, user_h, valuable_case_id):
        r = requests.post(f"{BASE_URL}/api/hi/exit/cases/{valuable_case_id}/options", headers=user_h, timeout=90)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert "valuation" in d and "options" in d
        val = d["valuation"]
        # AI could return zero; check keys present
        assert "low" in val and "high" in val and "confidence" in val
        assert len(d["options"]) == 9
        types = {o["exit_type"] for o in d["options"]}
        assert {"private_sale", "managed_marketplace", "donation", "recycle"}.issubset(types)

    def test_compare_and_disclaimer(self, user_h, valuable_case_id):
        r = requests.get(f"{BASE_URL}/api/hi/exit/cases/{valuable_case_id}/compare", headers=user_h, timeout=20)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert "comparison" in d and len(d["comparison"]) == 9
        assert "highlights" in d
        h = d["highlights"]
        assert h["best_overall"]["exit_type"] in [
            "private_sale", "managed_marketplace", "instant_buyback", "trade_in", "keep", "repair"
        ]
        # Good/working valuable item best_overall should be a sale path, not donation/dispose/recycle
        assert h["best_overall"]["exit_type"] not in ("donation", "recycle", "dispose")
        assert "disclaimer" in d
        assert "estimate" in d["disclaimer"].lower()
        assert "not" in d["disclaimer"].lower() and "offer" in d["disclaimer"].lower()

    def test_get_case_detail_with_partner_matches(self, user_h, valuable_case_id):
        r = requests.get(f"{BASE_URL}/api/hi/exit/cases/{valuable_case_id}", headers=user_h, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["case"]["id"] == valuable_case_id
        # Phones & Electronics has seeded partners; verify partner matches exist for some option
        has_match = any(len(o.get("partner_matches") or []) > 0 for o in d["options"])
        assert has_match, "Expected at least one partner match for Phones & Electronics"

    def test_select_private_sale_returns_safety(self, user_h, valuable_case_id):
        r = requests.get(f"{BASE_URL}/api/hi/exit/cases/{valuable_case_id}", headers=user_h, timeout=15)
        opts = r.json()["options"]
        ps = next((o for o in opts if o["exit_type"] == "private_sale"), None)
        assert ps
        r2 = requests.post(f"{BASE_URL}/api/hi/exit/cases/{valuable_case_id}/select", headers=user_h,
                           json={"exit_option_id": ps["id"]}, timeout=15)
        assert r2.status_code == 200, r2.text[:300]
        d2 = r2.json()
        assert d2["selected_exit_type"] == "private_sale"
        assert d2["safety_guidance"] and len(d2["safety_guidance"]) >= 3

    def test_listing_draft_and_review(self, user_h, valuable_case_id):
        r = requests.post(f"{BASE_URL}/api/hi/exit/cases/{valuable_case_id}/listing", headers=user_h, timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["listing"]["title"]
        r2 = requests.put(f"{BASE_URL}/api/hi/exit/cases/{valuable_case_id}/listing", headers=user_h,
                          json={"mark_reviewed": True}, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["status"] == "user_reviewed"

    def test_safety(self, user_h, valuable_case_id):
        r = requests.get(f"{BASE_URL}/api/hi/exit/cases/{valuable_case_id}/safety", headers=user_h, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert len(d["safety_guidance"]) >= 3
        assert "DIYhomie" in d["note"]

    def test_complete_and_report_valuation(self, user_h, valuable_case_id):
        r = requests.post(f"{BASE_URL}/api/hi/exit/cases/{valuable_case_id}/complete", headers=user_h,
                          json={"selected_exit_type": "private_sale", "realized_value": 250.0,
                                "completion_status": "completed"}, timeout=20)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["asset_status"] == "sold"
        assert d["outcome"]["realized_value"] == 250.0
        # verify persistence via GET
        r2 = requests.get(f"{BASE_URL}/api/hi/exit/cases/{valuable_case_id}", headers=user_h, timeout=15)
        assert r2.json()["case"]["status"] == "completed"
        assert r2.json()["outcome"] is not None
        # flag a valuation
        r3 = requests.post(f"{BASE_URL}/api/hi/exit/cases/{valuable_case_id}/report-valuation", headers=user_h,
                           json={"reason": "TEST_seems too low"}, timeout=15)
        assert r3.status_code == 200


# ------------------------------------------------------------------ USER flow — nonworking item
class TestUserFlowNonworking:
    def test_nonworking_ranks_recycle_dispose(self, user_h):
        r = requests.post(f"{BASE_URL}/api/hi/exit/cases", headers=user_h,
                          json={"title": "TEST_Broken microwave", "category": "Appliances"}, timeout=20)
        assert r.status_code == 200
        cid = r.json()["case"]["id"]
        r = requests.post(f"{BASE_URL}/api/hi/exit/cases/{cid}/assess", headers=user_h,
                          json={"user_reported_condition": "Nonworking", "working_status": "not_working",
                                "visible_damage_notes": "Dead — will not power on"}, timeout=20)
        assert r.status_code == 200
        r = requests.post(f"{BASE_URL}/api/hi/exit/cases/{cid}/options", headers=user_h, timeout=90)
        assert r.status_code == 200
        opts = r.json()["options"]
        # recycle suitability should outrank private_sale
        by_type = {o["exit_type"]: o for o in opts}
        assert by_type["recycle"]["suitability_score"] > by_type["private_sale"]["suitability_score"]
        assert by_type["dispose"]["suitability_score"] > by_type["private_sale"]["suitability_score"]
        r = requests.get(f"{BASE_URL}/api/hi/exit/cases/{cid}/compare", headers=user_h, timeout=15)
        assert r.status_code == 200


# ------------------------------------------------------------------ ADMIN flow
class TestAdmin:
    def test_dashboard(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/hi/admin/exit/dashboard", headers=admin_h, timeout=20)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert "categories" in d and "cases_by_status" in d
        assert "completed_by_exit" in d and "realized_value_total" in d
        assert "partners" in d and len(d["partners"]) >= 7
        assert "open_valuation_flags" in d
        assert d["realized_value_total"] >= 0

    def test_partners_list(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/hi/admin/exit/partners", headers=admin_h, timeout=15)
        assert r.status_code == 200
        assert len(r.json()["partners"]) >= 7

    def test_partner_compensated_without_disclosure_rejected(self, admin_h):
        r = requests.post(f"{BASE_URL}/api/hi/admin/exit/partners", headers=admin_h,
                          json={"name": "TEST_BadPartner", "partner_type": "instant_buyback",
                                "eligible_categories": ["Phones & Electronics"], "compensated": True}, timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"

    def test_partner_add_patch_delete(self, admin_h):
        # add
        r = requests.post(f"{BASE_URL}/api/hi/admin/exit/partners", headers=admin_h,
                          json={"name": "TEST_GoodPartner", "partner_type": "managed_marketplace",
                                "eligible_categories": ["Tools"], "compensated": True,
                                "disclosure_text": "DIYhomie may earn a commission."}, timeout=15)
        assert r.status_code == 200, r.text[:300]
        pid = r.json()["partner"]["id"]
        # pause
        r2 = requests.patch(f"{BASE_URL}/api/hi/admin/exit/partners/{pid}", headers=admin_h,
                            json={"status": "paused"}, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["status"] == "paused"
        # reactivate
        r3 = requests.patch(f"{BASE_URL}/api/hi/admin/exit/partners/{pid}", headers=admin_h,
                            json={"status": "active"}, timeout=15)
        assert r3.status_code == 200
        # delete
        r4 = requests.delete(f"{BASE_URL}/api/hi/admin/exit/partners/{pid}", headers=admin_h, timeout=15)
        assert r4.status_code == 200

    def test_category_toggle_blocks_user(self, admin_h, user_h):
        # disable Furniture
        r = requests.put(f"{BASE_URL}/api/hi/admin/exit/categories", headers=admin_h,
                         json={"category": "Furniture", "enabled": False}, timeout=15)
        assert r.status_code == 200
        try:
            r2 = requests.post(f"{BASE_URL}/api/hi/exit/cases", headers=user_h,
                               json={"title": "TEST_Old couch", "category": "Furniture"}, timeout=15)
            assert r2.status_code == 400
        finally:
            # re-enable
            requests.put(f"{BASE_URL}/api/hi/admin/exit/categories", headers=admin_h,
                         json={"category": "Furniture", "enabled": True}, timeout=15)

    def test_flags_endpoint(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/hi/admin/exit/flags", headers=admin_h, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d.get("flags"), list)
        # if any flags exist, resolve the first
        if d["flags"]:
            fid = d["flags"][0]["id"]
            r2 = requests.post(f"{BASE_URL}/api/hi/admin/exit/flags/{fid}/resolve", headers=admin_h, timeout=15)
            assert r2.status_code == 200


class TestRBAC:
    @pytest.mark.parametrize("path,method", [
        ("/api/hi/admin/exit/dashboard", "GET"),
        ("/api/hi/admin/exit/partners", "GET"),
        ("/api/hi/admin/exit/flags", "GET"),
    ])
    def test_non_admin_blocked(self, user_h, path, method):
        r = requests.request(method, f"{BASE_URL}{path}", headers=user_h, timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"
