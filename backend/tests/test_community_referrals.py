"""Backend tests for Project Communities v2 + Share & Earn referrals (iteration 11)."""
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or \
    os.environ.get("EXPO_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"

DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASS = __import__("os").environ.get("TEST_USER_PASSWORD", "")


# ------------------------------ fixtures
@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def demo_token(api):
    r = api.post(f"{BASE_URL}/api/auth/login",
                 json={"email": DEMO_EMAIL, "password": DEMO_PASS})
    assert r.status_code == 200, f"demo login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


# ------------------------------ public community GETs
class TestCommunityPublicGets:
    def test_projects_list_seeded_and_sorted(self, api):
        r = api.get(f"{BASE_URL}/api/community/projects")
        assert r.status_code == 200
        projects = r.json()
        assert isinstance(projects, list)
        assert len(projects) >= 12, f"expected >=12 seeded communities, got {len(projects)}"
        for p in projects:
            assert "slug" in p and "title" in p and "stats" in p
            assert "experience_count" in p
            assert "completed" in p["stats"]
        completed = [p["stats"]["completed"] for p in projects]
        assert completed == sorted(completed, reverse=True), "projects must be sorted by stats.completed desc"

    def test_feed_returns_with_project_titles(self, api):
        r = api.get(f"{BASE_URL}/api/community/feed?limit=15")
        assert r.status_code == 200
        feed = r.json()
        assert isinstance(feed, list)
        assert 1 <= len(feed) <= 15
        for item in feed:
            assert "id" in item and "title" in item
            assert "project_title" in item and "project_slug" in item
            assert item["project_title"], "feed item must have non-empty project_title"

    def test_project_detail_toilet_replacement(self, api):
        r = api.get(f"{BASE_URL}/api/community/projects/toilet-replacement")
        assert r.status_code == 200
        d = r.json()
        for k in ("stats", "top_questions", "common_mistakes", "helpful_tips",
                  "experiences", "threads", "experience_count"):
            assert k in d, f"missing key {k}"
        assert isinstance(d["experiences"], list)
        assert isinstance(d["threads"], list)
        assert isinstance(d["top_questions"], list)

    def test_project_detail_unknown_slug_404(self, api):
        r = api.get(f"{BASE_URL}/api/community/projects/does-not-exist-xyz")
        assert r.status_code == 404


# ------------------------------ auth-gated community POSTs
class TestCommunityWrites:
    SLUG = "toilet-replacement"

    def test_create_experience_increments_count_and_returns_badge(self, api, demo_token):
        before = api.get(f"{BASE_URL}/api/community/projects/{self.SLUG}").json()
        before_count = before["experience_count"]

        payload = {
            "title": f"TEST_exp_{uuid.uuid4().hex[:6]}",
            "body": "TEST experience body — automated regression.",
            "tools": ["wrench", "wax ring"],
            "cost_cents": 4200,
            "minutes": 90,
        }
        r = api.post(
            f"{BASE_URL}/api/community/projects/{self.SLUG}/experiences",
            json=payload, headers=_h(demo_token),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["id"]
        assert body["title"] == payload["title"]
        assert body["project_slug"] == self.SLUG
        assert body["badge"] in {"Verified Owner", "Verified Installer", "Experienced DIYer", "Master Builder"}
        assert body["seeded"] is False

        # verify persistence + count incremented
        after = api.get(f"{BASE_URL}/api/community/projects/{self.SLUG}").json()
        assert after["experience_count"] == before_count + 1

        # also verify list endpoint exp count for slug
        plist = api.get(f"{BASE_URL}/api/community/projects").json()
        match = [p for p in plist if p["slug"] == self.SLUG][0]
        assert match["experience_count"] >= after["experience_count"]

        pytest.shared_exp_id = body["id"]

    def test_cheer_increments(self, api, demo_token):
        exp_id = getattr(pytest, "shared_exp_id", None)
        assert exp_id, "needs prior experience"
        r1 = api.post(f"{BASE_URL}/api/community/experiences/{exp_id}/cheer",
                      headers=_h(demo_token))
        assert r1.status_code == 200, r1.text
        c1 = r1.json()["cheers"]
        r2 = api.post(f"{BASE_URL}/api/community/experiences/{exp_id}/cheer",
                      headers=_h(demo_token))
        c2 = r2.json()["cheers"]
        assert c2 == c1 + 1

    def test_cheer_unknown_404(self, api, demo_token):
        r = api.post(f"{BASE_URL}/api/community/experiences/does-not-exist-xyz/cheer",
                     headers=_h(demo_token))
        assert r.status_code == 404

    def test_create_thread_and_reply(self, api, demo_token):
        q = f"TEST_question_{uuid.uuid4().hex[:6]} — should I use wax or rubber?"
        r = api.post(f"{BASE_URL}/api/community/projects/{self.SLUG}/threads",
                     json={"question": q}, headers=_h(demo_token))
        assert r.status_code == 200, r.text
        th = r.json()
        assert th["id"] and th["question"] == q
        assert th["author"]
        assert th["badge"]

        rr = api.post(f"{BASE_URL}/api/community/threads/{th['id']}/replies",
                      json={"body": "TEST reply body — try wax."},
                      headers=_h(demo_token))
        assert rr.status_code == 200, rr.text
        reply = rr.json()
        assert reply["id"] and reply["author"] and reply["badge"]

        # verify reply appears in detail
        detail = api.get(f"{BASE_URL}/api/community/projects/{self.SLUG}").json()
        match_threads = [t for t in detail["threads"] if t["id"] == th["id"]]
        assert match_threads, "newly created thread not in detail"
        assert any(rp["id"] == reply["id"] for rp in match_threads[0]["replies"])

    def test_post_requires_auth(self, api):
        r = api.post(f"{BASE_URL}/api/community/projects/{self.SLUG}/experiences",
                     json={"title": "x", "body": "y"})
        assert r.status_code in (401, 403)

    def test_post_to_unknown_slug_404(self, api, demo_token):
        r = api.post(f"{BASE_URL}/api/community/projects/nope-xyz/experiences",
                     json={"title": "x", "body": "y"}, headers=_h(demo_token))
        assert r.status_code == 404


# ------------------------------ referrals
class TestReferrals:
    def test_referrals_me_shape(self, api, demo_token):
        r = api.get(f"{BASE_URL}/api/referrals/me", headers=_h(demo_token))
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("code", "invited", "converted", "earned_cents", "credit_cents", "reward_cents", "is_paid"):
            assert k in d, f"missing {k}"
        assert d["reward_cents"] == 500
        assert isinstance(d["code"], str) and len(d["code"]) >= 4
        assert isinstance(d["invited"], int)
        assert isinstance(d["converted"], int)
        assert isinstance(d["is_paid"], bool)
        pytest.shared_ref_code = d["code"]

    def test_register_with_ref_creates_referral_record(self, api, demo_token):
        ref_code = getattr(pytest, "shared_ref_code", None)
        assert ref_code, "referral code unavailable"

        email = f"test_ref_{uuid.uuid4().hex[:10]}@example.com"
        r = api.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": __import__("os").environ.get("TEST_USER_PASSWORD", "") + "!", "name": "TEST_Ref User",
            "ref": ref_code,
        })
        assert r.status_code == 200, r.text
        time.sleep(0.4)  # link_referral runs after insert

        # verify via demo user's /referrals/me invited counter increments
        after = api.get(f"{BASE_URL}/api/referrals/me", headers=_h(demo_token)).json()
        assert after["invited"] >= 1, "referrals.me invited count must include new ref"

    def test_register_with_bad_ref_still_succeeds(self, api):
        email = f"test_badref_{uuid.uuid4().hex[:10]}@example.com"
        r = api.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": __import__("os").environ.get("TEST_USER_PASSWORD", "") + "!", "name": "TEST_BadRef",
            "ref": "ZZZZZZ",
        })
        assert r.status_code == 200

    def test_referrals_me_requires_auth(self, api):
        r = api.get(f"{BASE_URL}/api/referrals/me")
        assert r.status_code in (401, 403)
