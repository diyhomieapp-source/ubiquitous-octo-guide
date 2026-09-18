"""Iteration 102: verify security remediation + new share-win outcome endpoint.

Covered:
- New passwords from backend/.env.test succeed for both demo + admin logins
- Legacy passwords ("Test1234", "diyhomie1122") are rejected
- GET /api/hi/projects/{pid}/outcome returns latest outcome for demo project
- GET /api/hi/projects/{pid}/outcome returns 404 for unknown project id
- Endpoint requires auth
"""
import os
import pytest
import requests

BASE = os.environ["TEST_BASE_URL"].rstrip("/")
USER_EMAIL = os.environ["TEST_USER_EMAIL"]
USER_PW = os.environ["TEST_USER_PASSWORD"]
ADMIN_EMAIL = os.environ["TEST_ADMIN_EMAIL"]
ADMIN_PW = os.environ["TEST_ADMIN_PASSWORD"]

DEMO_PROJECT_ID = "49186adc-f93a-4417-96f3-9b6178193c77"


def _login(email, password):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    return r


# --- SECURITY REMEDIATION ---
class TestSecurityRemediation:
    def test_new_demo_password_ok(self):
        r = _login(USER_EMAIL, USER_PW)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "access_token" in body and body.get("user", {}).get("email") == USER_EMAIL

    def test_new_admin_password_ok(self):
        r = _login(ADMIN_EMAIL, ADMIN_PW)
        assert r.status_code == 200, r.text
        assert "access_token" in r.json()

    @pytest.mark.parametrize("email,legacy", [
        (USER_EMAIL, "Test1234"),
        (ADMIN_EMAIL, "diyhomie1122"),
    ])
    def test_legacy_passwords_rejected(self, email, legacy):
        r = _login(email, legacy)
        assert r.status_code in (400, 401), f"legacy pw unexpectedly accepted: {r.status_code} {r.text}"


# --- NEW OUTCOME ENDPOINT (share-win) ---
@pytest.fixture(scope="module")
def user_token():
    r = _login(USER_EMAIL, USER_PW)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


class TestProjectOutcomeEndpoint:
    def test_requires_auth(self):
        r = requests.get(f"{BASE}/api/hi/projects/{DEMO_PROJECT_ID}/outcome", timeout=15)
        assert r.status_code in (401, 403), r.text

    def test_returns_outcome_for_completed_project(self, user_token):
        r = requests.get(
            f"{BASE}/api/hi/projects/{DEMO_PROJECT_ID}/outcome",
            headers={"Authorization": f"Bearer {user_token}"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "outcome" in body
        o = body["outcome"]
        assert o is not None, "expected an outcome for the seeded demo project"
        # required shape for the share card
        assert o.get("project_id") == DEMO_PROJECT_ID
        for key in ("id", "result", "created_at"):
            assert key in o, f"missing key {key} in outcome"

    def test_returns_404_for_unknown_project(self, user_token):
        bogus = "00000000-0000-0000-0000-000000000000"
        r = requests.get(
            f"{BASE}/api/hi/projects/{bogus}/outcome",
            headers={"Authorization": f"Bearer {user_token}"},
            timeout=15,
        )
        assert r.status_code == 404, r.text
