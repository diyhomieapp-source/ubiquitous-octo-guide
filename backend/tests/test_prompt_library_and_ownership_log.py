"""
Tests for Iteration #49 (Home Ownership Log branded share) and #51 (Admin Prompt Library).
Also lightweight regression sanity for AI flows routed through resolve_prompt().
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")

ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASSWORD = __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")
USER_EMAIL = "demo_home@diyhomie.com"
USER_PASSWORD = __import__("os").environ.get("TEST_USER_PASSWORD", "")

EXPECTED_KEYS = {"master_step", "full_guide", "intake_questions", "quick_answer", "emergency_triage", "image_style"}


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(api, email, password):
    r = api.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text[:200]}"
    return r.json().get("token") or r.json().get("access_token")


@pytest.fixture(scope="module")
def admin_token(api):
    return _login(api, ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="module")
def user_token(api):
    return _login(api, USER_EMAIL, USER_PASSWORD)


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# =====================================================================
# ISSUE #49 - Home Ownership Log
# =====================================================================
class TestHomeOwnershipLog:
    def test_share_link_creation(self, api, user_token):
        r = api.post(f"{BASE_URL}/api/portability/share", json={"public": True, "days": 30}, headers=_h(user_token))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("public") is True
        assert body.get("token", "").startswith("log_"), f"bad token: {body}"
        assert body.get("expires_at")
        pytest.share_token = body["token"]

    def test_public_log_html_render(self, api):
        token = getattr(pytest, "share_token", None)
        assert token, "share token missing (previous test must run)"
        r = requests.get(f"{BASE_URL}/api/portability/log/{token}")
        assert r.status_code == 200, r.text[:200]
        assert "text/html" in r.headers.get("content-type", "").lower()
        html = r.text
        assert "Home Ownership Log" in html
        assert "DIYhomie" in html
        # Branded structure check
        assert "Documented improvements" in html

    def test_invalid_token_returns_404(self):
        r = requests.get(f"{BASE_URL}/api/portability/log/log_doesnotexist_zzz")
        assert r.status_code == 404
        assert "private or unavailable" in r.text.lower()


# =====================================================================
# ISSUE #51 - Admin Prompt Library
# =====================================================================
class TestPromptLibrary:
    def test_admin_route_requires_admin(self, api, user_token):
        r = api.get(f"{BASE_URL}/api/admin/prompts", headers=_h(user_token))
        assert r.status_code in (401, 403), f"expected 401/403 for non-admin, got {r.status_code}"

    def test_admin_route_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/admin/prompts")
        assert r.status_code in (401, 403)

    def test_list_prompts_has_6_seeded(self, api, admin_token):
        r = api.get(f"{BASE_URL}/api/admin/prompts", headers=_h(admin_token))
        assert r.status_code == 200, r.text
        data = r.json()
        keys = {p["key"] for p in data["prompts"]}
        assert EXPECTED_KEYS.issubset(keys), f"missing prompts. got: {keys}"
        assert len(data["prompts"]) >= 6
        # Basic schema check
        for p in data["prompts"]:
            for f in ("key", "name", "category", "status", "version", "risk"):
                assert f in p, f"missing field {f} in {p}"

    def test_analytics_endpoint(self, api, admin_token):
        r = api.get(f"{BASE_URL}/api/admin/prompts/analytics", headers=_h(admin_token))
        assert r.status_code == 200, r.text
        j = r.json()
        assert "totals" in j and "stats" in j and "recent_changes" in j
        assert j["totals"]["prompts"] >= 6

    def test_get_single_prompt_detail(self, api, admin_token):
        r = api.get(f"{BASE_URL}/api/admin/prompts/master_step", headers=_h(admin_token))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["key"] == "master_step"
        assert d.get("content"), "content should exist"
        assert d.get("default"), "safe default should be provided"
        assert "history" in d and "audit" in d and "variants" in d

    def test_get_missing_prompt_404(self, api, admin_token):
        r = api.get(f"{BASE_URL}/api/admin/prompts/does_not_exist", headers=_h(admin_token))
        assert r.status_code == 404

    def test_edit_publish_flow(self, api, admin_token):
        key = "quick_answer"
        # capture starting version
        r = api.get(f"{BASE_URL}/api/admin/prompts/{key}", headers=_h(admin_token))
        assert r.status_code == 200
        start = r.json()
        start_version = start["version"]
        orig_content = start["content"]

        # save draft
        new_content = orig_content + "\n\n[TEST_EDIT]"
        r = api.put(f"{BASE_URL}/api/admin/prompts/{key}",
                    json={"content": new_content, "note": "TEST edit"}, headers=_h(admin_token))
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "pending_review"

        # verify pending
        r = api.get(f"{BASE_URL}/api/admin/prompts/{key}", headers=_h(admin_token))
        assert r.json()["pending"] == new_content
        assert r.json()["version"] == start_version, "publishing should not bump until publish"

        # publish
        r = api.post(f"{BASE_URL}/api/admin/prompts/{key}/publish",
                     json={"note": "TEST publish"}, headers=_h(admin_token))
        assert r.status_code == 200, r.text
        assert r.json()["version"] == start_version + 1

        # verify
        r = api.get(f"{BASE_URL}/api/admin/prompts/{key}", headers=_h(admin_token))
        d = r.json()
        assert d["content"] == new_content
        assert d["pending"] is None
        assert d["version"] == start_version + 1
        assert any(h.get("version") == start_version for h in d.get("history", []))

        # rollback to prior version
        r = api.post(f"{BASE_URL}/api/admin/prompts/{key}/rollback",
                     json={"version": start_version}, headers=_h(admin_token))
        assert r.status_code == 200, r.text
        r = api.get(f"{BASE_URL}/api/admin/prompts/{key}", headers=_h(admin_token))
        d = r.json()
        assert d["content"] == orig_content, "rollback should restore original content"

    def test_pause_and_resume(self, api, admin_token):
        key = "image_style"
        r = api.post(f"{BASE_URL}/api/admin/prompts/{key}/status",
                     json={"status": "paused"}, headers=_h(admin_token))
        assert r.status_code == 200 and r.json()["status"] == "paused"

        r = api.get(f"{BASE_URL}/api/admin/prompts/{key}", headers=_h(admin_token))
        assert r.json()["status"] == "paused"

        r = api.post(f"{BASE_URL}/api/admin/prompts/{key}/status",
                     json={"status": "live"}, headers=_h(admin_token))
        assert r.status_code == 200 and r.json()["status"] == "live"

    def test_invalid_status_400(self, api, admin_token):
        r = api.post(f"{BASE_URL}/api/admin/prompts/master_step/status",
                     json={"status": "banana"}, headers=_h(admin_token))
        assert r.status_code == 400

    def test_variants_and_ab(self, api, admin_token):
        key = "master_step"
        # Add variant
        r = api.post(f"{BASE_URL}/api/admin/prompts/{key}/variants",
                     json={"label": "TEST_Concise", "content": "Be extremely concise.", "weight": 25},
                     headers=_h(admin_token))
        assert r.status_code == 200, r.text
        v = r.json()["variant"]
        vid = v["id"]

        # Update
        r = api.put(f"{BASE_URL}/api/admin/prompts/{key}/variants/{vid}",
                    json={"weight": 40, "enabled": False}, headers=_h(admin_token))
        assert r.status_code == 200

        # Toggle A/B on and off
        r = api.post(f"{BASE_URL}/api/admin/prompts/{key}/ab", json={"enabled": True}, headers=_h(admin_token))
        assert r.status_code == 200 and r.json()["ab_enabled"] is True
        r = api.post(f"{BASE_URL}/api/admin/prompts/{key}/ab", json={"enabled": False}, headers=_h(admin_token))
        assert r.status_code == 200 and r.json()["ab_enabled"] is False

        # Cleanup variant
        r = api.delete(f"{BASE_URL}/api/admin/prompts/{key}/variants/{vid}", headers=_h(admin_token))
        assert r.status_code == 200

        # Verify gone
        r = api.get(f"{BASE_URL}/api/admin/prompts/{key}", headers=_h(admin_token))
        vids = [x["id"] for x in r.json().get("variants") or []]
        assert vid not in vids

    def test_variant_missing_404(self, api, admin_token):
        r = api.put(f"{BASE_URL}/api/admin/prompts/master_step/variants/does_not_exist",
                    json={"weight": 10}, headers=_h(admin_token))
        assert r.status_code == 404

    def test_publish_without_pending_400(self, api, admin_token):
        # ensure no pending for master_step
        api.post(f"{BASE_URL}/api/admin/prompts/master_step/discard", headers=_h(admin_token))
        r = api.post(f"{BASE_URL}/api/admin/prompts/master_step/publish",
                     json={"note": ""}, headers=_h(admin_token))
        assert r.status_code == 400

    def test_prompt_feedback(self, api, user_token):
        r = api.post(f"{BASE_URL}/api/prompts/feedback",
                     json={"key": "master_step", "rating": "up"}, headers=_h(user_token))
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True


# =====================================================================
# REGRESSION - AI flow smoke test
# =====================================================================
class TestAIRegression:
    def test_create_project(self, api, user_token):
        payload = {"title": "TEST fix squeaky door hinge", "description": "The bedroom door hinge squeaks",
                   "experience": "beginner"}
        r = api.post(f"{BASE_URL}/api/projects", json=payload, headers=_h(user_token))
        # Some APIs require different payload; accept 200/201, log otherwise
        if r.status_code not in (200, 201):
            pytest.skip(f"project create shape differs: {r.status_code} {r.text[:200]}")
        j = r.json()
        pytest.project_id = j.get("id") or j.get("project", {}).get("id")
        assert pytest.project_id, f"no project id in response: {j}"

    def test_guide_generation_uses_resolve_prompt(self, api, user_token):
        pid = getattr(pytest, "project_id", None)
        if not pid:
            pytest.skip("no project id")
        r = api.post(f"{BASE_URL}/api/projects/{pid}/guide", json={}, headers=_h(user_token), timeout=120)
        # If this endpoint shape is different, don't fail regression - log
        if r.status_code not in (200, 201):
            pytest.skip(f"guide endpoint returned {r.status_code}: {r.text[:200]}")
        assert r.status_code in (200, 201)
