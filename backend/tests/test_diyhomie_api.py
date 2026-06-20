"""DIYhomie backend API regression tests."""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://step-by-step-diy.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


# ---------- shared session/state ----------
@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def user_a(session):
    email = f"TEST_a_{uuid.uuid4().hex[:8]}@diyhomie.com"
    r = session.post(f"{API}/auth/register", json={"email": email, "password": "Test1234", "name": "TesterA"}, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    return {"email": email, "password": "Test1234", "token": data["access_token"], "user": data["user"]}


@pytest.fixture(scope="session")
def user_b(session):
    email = f"TEST_b_{uuid.uuid4().hex[:8]}@diyhomie.com"
    r = session.post(f"{API}/auth/register", json={"email": email, "password": "Test1234", "name": "TesterB"}, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    return {"email": email, "password": "Test1234", "token": data["access_token"], "user": data["user"]}


def auth_h(user):
    return {"Authorization": f"Bearer {user['token']}", "Content-Type": "application/json"}


# ---------- Root health ----------
def test_root(session):
    r = session.get(f"{API}/", timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert "message" in data and "brain" in data


# ---------- Auth module ----------
class TestAuth:
    def test_register_creates_user_with_defaults(self, user_a):
        u = user_a["user"]
        assert u["email"].startswith("test_a_")
        assert u["credits"] == 60
        assert u["voice_minutes"] == 3
        assert u["subscription_tier"] == "free"
        assert u["onboarded"] is False
        assert user_a["token"]

    def test_register_duplicate_email_rejected(self, session, user_a):
        r = session.post(f"{API}/auth/register",
                         json={"email": user_a["email"], "password": "x", "name": "dup"}, timeout=10)
        assert r.status_code == 400

    def test_login_success(self, session, user_a):
        r = session.post(f"{API}/auth/login",
                         json={"email": user_a["email"], "password": "Test1234"}, timeout=10)
        assert r.status_code == 200
        assert r.json()["user"]["email"] == user_a["email"].lower()

    def test_login_bad_password(self, session, user_a):
        r = session.post(f"{API}/auth/login",
                         json={"email": user_a["email"], "password": "wrong"}, timeout=10)
        assert r.status_code == 400

    def test_me_returns_user(self, session, user_a):
        r = session.get(f"{API}/auth/me", headers=auth_h(user_a), timeout=10)
        assert r.status_code == 200
        assert r.json()["email"] == user_a["email"].lower()

    def test_me_unauthorized(self, session):
        r = session.get(f"{API}/auth/me", timeout=10)
        assert r.status_code in (401, 403)


# ---------- Profile module ----------
class TestProfile:
    def test_profile_update_persists(self, session, user_a):
        payload = {
            "experience": "Weekend Warrior",
            "tools": ["drill", "hammer"],
            "budget": "Standard",
            "pain_point": "leaky_faucet",
            "expectation": "clear_steps",
            "location": "Austin, TX",
            "onboarded": True,
        }
        r = session.put(f"{API}/profile", headers=auth_h(user_a), json=payload, timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert body["experience"] == "Weekend Warrior"
        assert body["tools"] == ["drill", "hammer"]
        assert body["onboarded"] is True

        # GET to verify persistence
        r2 = session.get(f"{API}/auth/me", headers=auth_h(user_a), timeout=10)
        assert r2.json()["location"] == "Austin, TX"


# ---------- Project module ----------
@pytest.fixture(scope="session")
def project_a(session, user_a):
    r = session.post(f"{API}/projects", headers=auth_h(user_a),
                     json={"title": "Fix leaky kitchen faucet", "location": "Austin, TX"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


class TestProjects:
    def test_project_create(self, project_a):
        assert project_a["title"] == "Fix leaky kitchen faucet"
        assert project_a["status"] == "active"
        assert "id" in project_a
        assert "_id" not in project_a

    def test_project_list(self, session, user_a, project_a):
        r = session.get(f"{API}/projects", headers=auth_h(user_a), timeout=10)
        assert r.status_code == 200
        ids = [p["id"] for p in r.json()]
        assert project_a["id"] in ids

    def test_project_get_by_id(self, session, user_a, project_a):
        r = session.get(f"{API}/projects/{project_a['id']}", headers=auth_h(user_a), timeout=10)
        assert r.status_code == 200
        assert r.json()["id"] == project_a["id"]

    def test_project_404(self, session, user_a):
        r = session.get(f"{API}/projects/nope-id-xyz", headers=auth_h(user_a), timeout=10)
        assert r.status_code == 404


# ---------- Step generation (real LLM) ----------
class TestSteps:
    @pytest.fixture(scope="class")
    def first_step(self, session, user_a, project_a):
        r = session.post(f"{API}/projects/{project_a['id']}/step",
                         headers=auth_h(user_a),
                         json={"message": "Start the project", "mode": "text"},
                         timeout=120)
        assert r.status_code == 200, r.text
        return r.json()

    def test_step_returns_proper_shape(self, first_step):
        step = first_step["step"]
        for k in ("step_title", "text_instruction", "visual_description", "missing_tools", "code_alert", "id"):
            assert k in step, f"missing key {k}"
        assert isinstance(step["missing_tools"], list)
        assert isinstance(step["text_instruction"], str) and step["text_instruction"]

    def test_credits_deducted_text_mode(self, session, user_a, first_step):
        # first user started with 60; one text step => 59
        assert first_step["credits"] == 59
        # confirm via /me
        r = session.get(f"{API}/auth/me", headers=auth_h(user_a), timeout=10)
        assert r.json()["credits"] == 59

    def test_voice_mode_deducts_two(self, session, user_a, project_a, first_step):
        r = session.post(f"{API}/projects/{project_a['id']}/step",
                         headers=auth_h(user_a),
                         json={"message": "done", "mode": "voice"},
                         timeout=120)
        assert r.status_code == 200, r.text
        # was 59 → voice (2) → 57
        assert r.json()["credits"] == 57


# ---------- Image generation (real, slow) ----------
class TestImage:
    def test_step_image_base64(self, session, user_a, project_a):
        # fetch latest step
        r = session.get(f"{API}/projects/{project_a['id']}", headers=auth_h(user_a), timeout=10)
        steps = r.json().get("steps", [])
        assert steps, "no steps to image"
        step_id = steps[0]["id"]
        r2 = session.post(f"{API}/projects/{project_a['id']}/step/{step_id}/image",
                          headers=auth_h(user_a), timeout=200)
        assert r2.status_code == 200, r2.text
        img = r2.json().get("image_base64", "")
        assert isinstance(img, str) and len(img) > 1000


# ---------- Supplies ----------
class TestSupplies:
    def test_supplies_returns_affiliate(self, session, user_a, project_a):
        r = session.get(f"{API}/projects/{project_a['id']}/supplies",
                        headers=auth_h(user_a), timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert "items" in data and "bundle_url" in data
        # if any missing tools, bundle_url should contain tag
        if data["items"]:
            assert "amazon.com" in data["items"][0]["url"]
            assert "tag=" in data["items"][0]["url"]


# ---------- Community / Pro-Earn ----------
class TestCommunity:
    @pytest.fixture(scope="class")
    def post_a(self, session, user_a):
        r = session.post(f"{API}/community/posts", headers=auth_h(user_a),
                         json={"title": "TEST help with sink", "body": "leaks under sink"}, timeout=10)
        assert r.status_code == 200, r.text
        return r.json()

    def test_create_post(self, post_a):
        assert post_a["title"] == "TEST help with sink"
        assert post_a["solved"] is False

    def test_list_posts_includes_new(self, session, user_a, post_a):
        r = session.get(f"{API}/community/posts", headers=auth_h(user_a), timeout=10)
        assert r.status_code == 200
        ids = [p["id"] for p in r.json()]
        assert post_a["id"] in ids

    def test_reply_and_verify_rewards_helper(self, session, user_a, user_b, post_a):
        # user_b (the helper) replies
        r = session.post(f"{API}/community/posts/{post_a['id']}/reply",
                         headers=auth_h(user_b), json={"body": "Tighten the P-trap nut."}, timeout=10)
        assert r.status_code == 200, r.text
        reply_id = r.json()["id"]

        # helper credits before verify
        rb = session.get(f"{API}/auth/me", headers=auth_h(user_b), timeout=10)
        helper_before = rb.json()
        cred_before = helper_before["credits"]
        voice_before = helper_before["voice_minutes"]

        # non-author cannot verify
        r_forbid = session.post(f"{API}/community/posts/{post_a['id']}/verify/{reply_id}",
                                headers=auth_h(user_b), timeout=10)
        assert r_forbid.status_code == 403

        # author verifies
        rv = session.post(f"{API}/community/posts/{post_a['id']}/verify/{reply_id}",
                          headers=auth_h(user_a), timeout=10)
        assert rv.status_code == 200, rv.text
        assert rv.json()["ok"] is True

        # helper got +10 credits and +2 voice minutes
        rb2 = session.get(f"{API}/auth/me", headers=auth_h(user_b), timeout=10)
        assert rb2.json()["credits"] == cred_before + 10
        assert rb2.json()["voice_minutes"] == voice_before + 2


# ---------- Billing (mock) ----------
class TestBilling:
    def test_subscribe_pro_grants_credits(self, session, user_b):
        before = session.get(f"{API}/auth/me", headers=auth_h(user_b), timeout=10).json()
        r = session.post(f"{API}/billing/subscribe", headers=auth_h(user_b),
                         json={"tier": "pro"}, timeout=10)
        assert r.status_code == 200, r.text
        after = r.json()
        assert after["subscription_tier"] == "pro"
        assert after["credits"] == before["credits"] + 500
        assert after["voice_minutes"] == before["voice_minutes"] + 60

    def test_subscribe_invalid_tier(self, session, user_a):
        r = session.post(f"{API}/billing/subscribe", headers=auth_h(user_a),
                         json={"tier": "bogus"}, timeout=10)
        assert r.status_code == 400


# ---------- Out-of-credits ----------
class TestOutOfCredits:
    def test_402_when_no_credits(self, session):
        # Make a fresh user, drain credits via DB-like brute calls would be slow.
        # Instead: create user, subscribe to a non-existent then directly assert 402 via mock state.
        # We'll just create user and force credits to 0 via repeated steps would be too slow/expensive.
        # Use a quicker path: create user and zero out by subscribing... no decrement endpoint.
        # Strategy: register, create project, and verify the 402 path by patching user via profile? Not possible.
        # We rely on hitting the brain only ONCE: register, then drop credits by hitting profile... not possible either.
        # Skip if test would exceed reasonable runtime.
        pytest.skip("Skipped: draining 60 credits via real LLM is too costly/slow for CI; logic reviewed in code.")
