"""Sheet #39 — Beta Features / Feature Flags backend tests.

Coverage:
- User GET /api/features (auth) — 3 seeded flags visible (ar_personalization, bulk_buying, real_estate_mode) with can_optin
- User POST /api/features/{key}/optin — toggles opt-in, enabled_for_me flips true; 400 for non-optin/disabled; 404 unknown
- User POST /api/beta-feedback — auto-tagging (bug/friction/suggestion). Returns tag.
- Admin GET /api/admin/features — optin_count + feedback_count
- Admin POST /api/admin/features — create; 409 duplicate; 400 invalid rollout_type
- Admin PATCH /api/admin/features/{key} — update enabled/rollout_type/rollout_value; 404 unknown
- Admin DELETE /api/admin/features/{key} — deletes flag and pulls from beta_optins
- Admin GET /api/admin/features/{key}/analytics — shape
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001")
DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASS = __import__("os").environ.get("TEST_USER_PASSWORD", "")
ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASS = __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")

SEEDED_KEYS = {"ar_personalization", "bulk_buying", "real_estate_mode"}


def _auth(email, pw):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def uheaders():
    return {"Authorization": f"Bearer {_auth(DEMO_EMAIL, DEMO_PASS)}"}


@pytest.fixture(scope="module")
def aheaders():
    return {"Authorization": f"Bearer {_auth(ADMIN_EMAIL, ADMIN_PASS)}"}


# --------------- USER endpoints ---------------
class TestUserFeatures:
    def test_list_features_returns_seeded(self, uheaders):
        r = requests.get(f"{BASE_URL}/api/features", headers=uheaders, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "features" in d
        keys = {f["key"] for f in d["features"]}
        assert SEEDED_KEYS.issubset(keys), f"expected {SEEDED_KEYS} in {keys}"
        for f in d["features"]:
            for k in ["key", "label", "description", "icon", "can_optin", "opted_in", "enabled_for_me"]:
                assert k in f, f"missing {k}"
            # seeded flags are enabled + optin type => can_optin=True
            if f["key"] in SEEDED_KEYS:
                assert f["can_optin"] is True, f["key"]

    def test_optin_flow_flips_enabled_for_me(self, uheaders):
        key = "ar_personalization"
        # opt out first (idempotent)
        requests.post(f"{BASE_URL}/api/features/{key}/optin", headers=uheaders,
                      json={"optin": False}, timeout=20)
        # opt in
        r = requests.post(f"{BASE_URL}/api/features/{key}/optin", headers=uheaders,
                         json={"optin": True}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["opted_in"] is True
        # verify enabled_for_me=true via list
        r2 = requests.get(f"{BASE_URL}/api/features", headers=uheaders, timeout=20)
        f = next(x for x in r2.json()["features"] if x["key"] == key)
        assert f["opted_in"] is True
        assert f["enabled_for_me"] is True

    def test_optin_unknown_key_returns_404(self, uheaders):
        r = requests.post(f"{BASE_URL}/api/features/does_not_exist_zzz/optin",
                         headers=uheaders, json={"optin": True}, timeout=20)
        assert r.status_code == 404, r.text


# --------------- Beta Feedback tagging ---------------
class TestBetaFeedback:
    def test_bug_tag_for_crash_words(self, uheaders):
        r = requests.post(f"{BASE_URL}/api/beta-feedback", headers=uheaders,
                         json={"flag_key": "ar_personalization", "rating": 3,
                               "useful": False, "comment": "TEST_ this crashed on tap"}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["tag"] == "bug"

    def test_friction_tag_for_low_rating(self, uheaders):
        r = requests.post(f"{BASE_URL}/api/beta-feedback", headers=uheaders,
                         json={"flag_key": "ar_personalization", "rating": 2,
                               "useful": False, "comment": "TEST_ hard to use"}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["tag"] == "friction"

    def test_suggestion_tag_default(self, uheaders):
        r = requests.post(f"{BASE_URL}/api/beta-feedback", headers=uheaders,
                         json={"flag_key": "ar_personalization", "rating": 5,
                               "useful": True, "comment": "TEST_ love it, add more"}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["tag"] == "suggestion"


# --------------- ADMIN endpoints ---------------
class TestAdminFeatures:
    NEW_KEY = "test_qa_flag_sheet39"

    def test_admin_list_has_counts(self, aheaders):
        r = requests.get(f"{BASE_URL}/api/admin/features", headers=aheaders, timeout=20)
        assert r.status_code == 200, r.text
        arr = r.json()
        assert isinstance(arr, list)
        assert any(f["key"] == "ar_personalization" for f in arr)
        for f in arr:
            assert "optin_count" in f
            assert "feedback_count" in f
        # ar_personalization has demo_home opted in from earlier test => optin_count >= 1
        ar = next(f for f in arr if f["key"] == "ar_personalization")
        assert ar["optin_count"] >= 1
        assert ar["feedback_count"] >= 3  # from TestBetaFeedback

    def test_admin_create_flag(self, aheaders):
        # cleanup if leftover
        requests.delete(f"{BASE_URL}/api/admin/features/{self.NEW_KEY}", headers=aheaders, timeout=20)
        r = requests.post(f"{BASE_URL}/api/admin/features", headers=aheaders,
                         json={"key": self.NEW_KEY, "label": "TEST_ QA Flag",
                               "description": "QA-created flag",
                               "rollout_type": "optin", "enabled": True}, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["key"] == self.NEW_KEY
        assert d["enabled"] is True
        # verify in list
        r2 = requests.get(f"{BASE_URL}/api/admin/features", headers=aheaders, timeout=20)
        assert any(f["key"] == self.NEW_KEY for f in r2.json())

    def test_admin_create_duplicate_returns_409(self, aheaders):
        r = requests.post(f"{BASE_URL}/api/admin/features", headers=aheaders,
                         json={"key": self.NEW_KEY, "label": "dup",
                               "rollout_type": "optin", "enabled": True}, timeout=20)
        assert r.status_code == 409, r.text

    def test_admin_create_invalid_rollout_returns_400(self, aheaders):
        r = requests.post(f"{BASE_URL}/api/admin/features", headers=aheaders,
                         json={"key": "test_qa_bad_rt", "label": "bad",
                               "rollout_type": "bogus", "enabled": True}, timeout=20)
        assert r.status_code == 400, r.text

    def test_admin_patch_flag(self, aheaders):
        r = requests.patch(f"{BASE_URL}/api/admin/features/{self.NEW_KEY}", headers=aheaders,
                          json={"rollout_type": "user_type", "rollout_value": "pro", "enabled": False},
                          timeout=20)
        assert r.status_code == 200, r.text
        r2 = requests.get(f"{BASE_URL}/api/admin/features", headers=aheaders, timeout=20)
        f = next(x for x in r2.json() if x["key"] == self.NEW_KEY)
        assert f["rollout_type"] == "user_type"
        assert f["rollout_value"] == "pro"
        assert f["enabled"] is False

    def test_admin_patch_unknown_returns_404(self, aheaders):
        r = requests.patch(f"{BASE_URL}/api/admin/features/does_not_exist_yyy",
                          headers=aheaders, json={"enabled": True}, timeout=20)
        assert r.status_code == 404, r.text

    def test_admin_patch_invalid_rollout_returns_400(self, aheaders):
        r = requests.patch(f"{BASE_URL}/api/admin/features/{self.NEW_KEY}",
                          headers=aheaders, json={"rollout_type": "bogus"}, timeout=20)
        assert r.status_code == 400, r.text

    def test_optin_on_non_optin_flag_returns_400(self, aheaders, uheaders):
        # Our created flag is currently user_type + disabled — optin should 400
        r = requests.post(f"{BASE_URL}/api/features/{self.NEW_KEY}/optin", headers=uheaders,
                         json={"optin": True}, timeout=20)
        assert r.status_code == 400, r.text

    def test_admin_analytics_shape(self, aheaders):
        r = requests.get(f"{BASE_URL}/api/admin/features/ar_personalization/analytics",
                        headers=aheaders, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ["flag", "optin_count", "feedback_count", "avg_rating", "useful_pct", "tag_breakdown", "recent"]:
            assert k in d, f"missing {k}"
        assert d["feedback_count"] >= 3
        # tag breakdown should include bug/friction/suggestion from earlier tests
        assert isinstance(d["tag_breakdown"], dict)
        assert isinstance(d["recent"], list)
        # avg_rating should be a number
        assert isinstance(d["avg_rating"], (int, float))

    def test_admin_analytics_unknown_returns_404(self, aheaders):
        r = requests.get(f"{BASE_URL}/api/admin/features/does_not_exist_xxx/analytics",
                        headers=aheaders, timeout=20)
        assert r.status_code == 404, r.text

    def test_admin_delete_flag_and_pulls_optins(self, aheaders, uheaders):
        # First opt-in demo_home to the test flag: need enabled+optin first
        requests.patch(f"{BASE_URL}/api/admin/features/{self.NEW_KEY}", headers=aheaders,
                      json={"rollout_type": "optin", "enabled": True}, timeout=20)
        r = requests.post(f"{BASE_URL}/api/features/{self.NEW_KEY}/optin", headers=uheaders,
                         json={"optin": True}, timeout=20)
        assert r.status_code == 200, r.text
        # confirm optin in list
        alist = requests.get(f"{BASE_URL}/api/admin/features", headers=aheaders, timeout=20).json()
        f = next(x for x in alist if x["key"] == self.NEW_KEY)
        assert f["optin_count"] >= 1

        # delete flag
        r2 = requests.delete(f"{BASE_URL}/api/admin/features/{self.NEW_KEY}",
                            headers=aheaders, timeout=20)
        assert r2.status_code == 200, r2.text

        # verify gone
        alist2 = requests.get(f"{BASE_URL}/api/admin/features", headers=aheaders, timeout=20).json()
        assert not any(x["key"] == self.NEW_KEY for x in alist2)

        # verify pulled from demo_home's beta_optins (user's /features shouldn't include it now)
        ufeat = requests.get(f"{BASE_URL}/api/features", headers=uheaders, timeout=20).json()
        assert not any(x["key"] == self.NEW_KEY for x in ufeat["features"])


# --------------- Non-admin gate ---------------
class TestAdminGate:
    def test_non_admin_cannot_list(self, uheaders):
        r = requests.get(f"{BASE_URL}/api/admin/features", headers=uheaders, timeout=20)
        assert r.status_code in (401, 403), r.text
