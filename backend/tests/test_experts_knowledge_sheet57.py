"""
Sheet #57 — Expert Agent, Community Mentor & Knowledge Partner Platform
Backend tests for the /expert, /knowledge, and /admin/experts + /admin/knowledge endpoints.

Flow covered:
1. GET /expert/me  (existing approved expert `demo_home` sees badge + at least 1 guide)
2. Apply flow — fresh throwaway user posts /expert/apply -> becomes pending
3. Admin lists apps (?status=pending) and approves; user profile now approved
4. Approved user creates a guide, edits it, submits it (draft->pending)
5. Admin publishes guide via /admin/knowledge/{id}/review, credit bump verified
6. Public /knowledge feed contains the guide; /knowledge/{id} returns full body + increments views
7. Rate + flag endpoints
8. /knowledge/mentors — approved mentors listed
9. Admin analytics + admin flags + admin knowledge listing
10. Non-admin 403 on admin routes
11. Admin delete cleans up seeded test guide/application
"""
import os
import uuid
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")).rstrip("/")

ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASSWORD = "diyhomie1122"
DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASSWORD = "Test1234"


def _tok(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text}"
    return r.json().get("access_token") or r.json().get("token")


def _register(email, password, name="TEST_expert"):
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": email, "password": password, "name": name}, timeout=30)
    assert r.status_code == 200, f"register {email} -> {r.status_code} {r.text}"
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def admin_h():
    return {"Authorization": f"Bearer {_tok(ADMIN_EMAIL, ADMIN_PASSWORD)}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def demo_h():
    return {"Authorization": f"Bearer {_tok(DEMO_EMAIL, DEMO_PASSWORD)}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def fresh_user():
    email = f"test_expert_{uuid.uuid4().hex[:10]}@diyhomie.com"
    tok = _register(email, "Test1234", name="TEST_ExpertUser")
    return {"email": email, "token": tok,
            "headers": {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}}


# ============================================================ /expert/me (demo already approved)
class TestExpertMe:
    def test_demo_me_shows_approved_expert(self, demo_h):
        r = requests.get(f"{BASE_URL}/api/expert/me", headers=demo_h, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body.get("types"), list) and "Certified Pro" in body["types"]
        assert isinstance(body.get("categories"), list)
        assert isinstance(body.get("guides"), list)
        exp = body.get("expert") or {}
        assert exp.get("status") == "approved", f"expected demo_home approved, got {exp}"

    def test_fresh_user_me_empty_expert(self, fresh_user):
        r = requests.get(f"{BASE_URL}/api/expert/me", headers=fresh_user["headers"], timeout=30)
        assert r.status_code == 200
        assert r.json().get("expert") in (None, {}, {"status": None})


# ============================================================ apply -> pending
class TestExpertApply:
    def test_invalid_type_400(self, fresh_user):
        r = requests.post(f"{BASE_URL}/api/expert/apply", headers=fresh_user["headers"],
                          json={"type": "NotAThing", "specialty": "Plumbing", "bio": "x"}, timeout=30)
        assert r.status_code == 400

    def test_apply_pending(self, fresh_user):
        r = requests.post(f"{BASE_URL}/api/expert/apply", headers=fresh_user["headers"],
                          json={"type": "Community Mentor", "specialty": "Painting",
                                "license": "TESTLIC-123", "bio": "TEST_apply bio"}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "pending"

        # /expert/me now shows pending
        me = requests.get(f"{BASE_URL}/api/expert/me", headers=fresh_user["headers"], timeout=30).json()
        assert (me.get("expert") or {}).get("status") == "pending"

    def test_non_approved_cannot_create_guide(self, fresh_user):
        r = requests.post(f"{BASE_URL}/api/expert/guides", headers=fresh_user["headers"],
                          json={"title": "TEST_should_fail", "category": "General"}, timeout=30)
        assert r.status_code == 403


# ============================================================ Admin: approve applicant
class TestAdminReviewExpert:
    def test_list_apps_pending(self, admin_h, fresh_user):
        r = requests.get(f"{BASE_URL}/api/admin/experts?status=pending", headers=admin_h, timeout=30)
        assert r.status_code == 200
        apps = r.json().get("applications", [])
        assert any(a.get("email") == fresh_user["email"] for a in apps), "fresh applicant should be in pending list"
        # capture app_id for approval
        fresh_user["app_id"] = next(a["id"] for a in apps if a.get("email") == fresh_user["email"])

    def test_non_admin_forbidden(self, fresh_user):
        r = requests.get(f"{BASE_URL}/api/admin/experts", headers=fresh_user["headers"], timeout=30)
        assert r.status_code in (401, 403)

    def test_approve_applicant(self, admin_h, fresh_user):
        assert fresh_user.get("app_id"), "app_id must have been captured above"
        r = requests.post(f"{BASE_URL}/api/admin/experts/{fresh_user['app_id']}/review",
                          headers=admin_h, json={"decision": "approve", "note": "TEST_ok"}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "approved"

        me = requests.get(f"{BASE_URL}/api/expert/me", headers=fresh_user["headers"], timeout=30).json()
        exp = me.get("expert") or {}
        assert exp.get("status") == "approved"
        assert exp.get("badge") is not None
        assert (exp.get("credits") or 0) >= 50


# ============================================================ Guide lifecycle
class TestGuideLifecycle:
    def test_create_edit_submit(self, fresh_user):
        # create
        r = requests.post(f"{BASE_URL}/api/expert/guides", headers=fresh_user["headers"],
                          json={"title": "TEST_Guide_Sheet57", "category": "Painting",
                                "summary": "test summary", "body": "body v1",
                                "steps": ["prep", "paint"], "safety": ["ppe"]}, timeout=30)
        assert r.status_code == 200, r.text
        gid = r.json()["id"]
        fresh_user["guide_id"] = gid

        # edit -> stays draft
        r = requests.put(f"{BASE_URL}/api/expert/guides/{gid}", headers=fresh_user["headers"],
                         json={"title": "TEST_Guide_Sheet57", "category": "Painting",
                               "summary": "updated", "body": "body v2",
                               "steps": ["prep", "prime", "paint"], "safety": ["ppe"]}, timeout=30)
        assert r.status_code == 200

        # submit -> pending
        r = requests.post(f"{BASE_URL}/api/expert/guides/{gid}/submit",
                          headers=fresh_user["headers"], timeout=30)
        assert r.status_code == 200
        assert r.json().get("status") == "pending"

    def test_public_feed_hides_unpublished(self, demo_h, fresh_user):
        r = requests.get(f"{BASE_URL}/api/knowledge", headers=demo_h, timeout=30)
        assert r.status_code == 200
        ids = [g["id"] for g in r.json().get("guides", [])]
        assert fresh_user["guide_id"] not in ids

    def test_detail_404_when_not_published(self, demo_h, fresh_user):
        r = requests.get(f"{BASE_URL}/api/knowledge/{fresh_user['guide_id']}", headers=demo_h, timeout=30)
        assert r.status_code == 404


# ============================================================ Admin publish + credits
class TestAdminPublish:
    def test_admin_lists_pending_guide(self, admin_h, fresh_user):
        r = requests.get(f"{BASE_URL}/api/admin/knowledge?status=pending", headers=admin_h, timeout=30)
        assert r.status_code == 200
        ids = [g["id"] for g in r.json().get("guides", [])]
        assert fresh_user["guide_id"] in ids

    def test_publish(self, admin_h, fresh_user):
        # credits before
        before = requests.get(f"{BASE_URL}/api/expert/me", headers=fresh_user["headers"], timeout=30).json()
        credits_before = (before.get("expert") or {}).get("credits", 0)

        r = requests.post(f"{BASE_URL}/api/admin/knowledge/{fresh_user['guide_id']}/review",
                          headers=admin_h, json={"decision": "publish"}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "published"

        after = requests.get(f"{BASE_URL}/api/expert/me", headers=fresh_user["headers"], timeout=30).json()
        credits_after = (after.get("expert") or {}).get("credits", 0)
        assert credits_after >= credits_before + 25, f"expected +25 credits, was {credits_before}->{credits_after}"

    def test_invalid_decision(self, admin_h, fresh_user):
        r = requests.post(f"{BASE_URL}/api/admin/knowledge/{fresh_user['guide_id']}/review",
                          headers=admin_h, json={"decision": "bogus"}, timeout=30)
        assert r.status_code == 400


# ============================================================ Public knowledge feed + rate/flag
class TestKnowledgePublic:
    def test_feed_lists_published(self, demo_h, fresh_user):
        r = requests.get(f"{BASE_URL}/api/knowledge", headers=demo_h, timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body.get("categories"), list)
        ids = [g["id"] for g in body.get("guides", [])]
        assert fresh_user["guide_id"] in ids

    def test_category_filter(self, demo_h, fresh_user):
        r = requests.get(f"{BASE_URL}/api/knowledge?category=Painting", headers=demo_h, timeout=30)
        assert r.status_code == 200
        for g in r.json().get("guides", []):
            assert g["category"] == "Painting"

    def test_detail_increments_views_and_returns_full(self, demo_h, fresh_user):
        r1 = requests.get(f"{BASE_URL}/api/knowledge/{fresh_user['guide_id']}", headers=demo_h, timeout=30)
        assert r1.status_code == 200, r1.text
        j1 = r1.json()
        assert j1.get("body") is not None
        assert isinstance(j1.get("steps"), list) and len(j1["steps"]) >= 2
        v1 = j1.get("views", 0)

        r2 = requests.get(f"{BASE_URL}/api/knowledge/{fresh_user['guide_id']}", headers=demo_h, timeout=30)
        v2 = r2.json().get("views", 0)
        assert v2 > v1, f"views should increment ({v1} -> {v2})"

    def test_rate(self, demo_h, fresh_user):
        r = requests.post(f"{BASE_URL}/api/knowledge/{fresh_user['guide_id']}/rate",
                          headers=demo_h, json={"rating": 5}, timeout=30)
        assert r.status_code == 200
        # invalid range
        r_bad = requests.post(f"{BASE_URL}/api/knowledge/{fresh_user['guide_id']}/rate",
                              headers=demo_h, json={"rating": 9}, timeout=30)
        assert r_bad.status_code == 400
        # rating surfaced
        detail = requests.get(f"{BASE_URL}/api/knowledge/{fresh_user['guide_id']}", headers=demo_h, timeout=30).json()
        assert detail.get("rating_count", 0) >= 1

    def test_flag(self, demo_h, fresh_user):
        r = requests.post(f"{BASE_URL}/api/knowledge/{fresh_user['guide_id']}/flag",
                          headers=demo_h, json={"reason": "TEST_flag reason"}, timeout=30)
        assert r.status_code == 200

    def test_mentors_list(self, demo_h):
        r = requests.get(f"{BASE_URL}/api/knowledge/mentors", headers=demo_h, timeout=30)
        assert r.status_code == 200
        mentors = r.json().get("mentors", [])
        assert isinstance(mentors, list)
        # at least one mentor should exist (demo or fresh)
        assert len(mentors) >= 1


# ============================================================ Admin analytics + flags
class TestAdminAnalyticsFlags:
    def test_analytics(self, admin_h):
        r = requests.get(f"{BASE_URL}/api/admin/experts/analytics", headers=admin_h, timeout=30)
        assert r.status_code == 200
        j = r.json()
        totals = j.get("totals") or {}
        for k in ["applications", "pending", "approved", "guides", "published", "flags"]:
            assert k in totals, f"missing key {k}"
        assert isinstance(j.get("top_guides"), list)

    def test_flags_listing(self, admin_h, fresh_user):
        r = requests.get(f"{BASE_URL}/api/admin/knowledge/flags", headers=admin_h, timeout=30)
        assert r.status_code == 200
        flagged_ids = [g["id"] for g in r.json().get("flagged", [])]
        assert fresh_user["guide_id"] in flagged_ids

    def test_non_admin_analytics_forbidden(self, fresh_user):
        r = requests.get(f"{BASE_URL}/api/admin/experts/analytics",
                         headers=fresh_user["headers"], timeout=30)
        assert r.status_code in (401, 403)


# ============================================================ Cleanup
class TestCleanup:
    def test_admin_delete_guide(self, admin_h, fresh_user):
        r = requests.delete(f"{BASE_URL}/api/admin/knowledge/{fresh_user['guide_id']}",
                            headers=admin_h, timeout=30)
        assert r.status_code == 200

        # confirm gone
        r2 = requests.get(f"{BASE_URL}/api/knowledge/{fresh_user['guide_id']}",
                          headers=admin_h, timeout=30)
        assert r2.status_code == 404
