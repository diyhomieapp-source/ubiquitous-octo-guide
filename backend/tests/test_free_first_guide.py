"""Free-first-guide check: register fresh user, create project, POST /projects/{id}/guide -> credits stay 60."""
import os
import time
import requests
import pytest

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001")).rstrip("/")


@pytest.fixture(scope="module")
def auth_headers():
    ts = int(time.time())
    email = f"TEST_funnel_{ts}@diyhomie.com"
    r = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": __import__("os").environ.get("TEST_USER_PASSWORD", ""), "name": "Funnel Tester"},
        timeout=30,
    )
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("access_token") or data.get("token")
    assert token, f"no token in response: {data}"
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}, email


def test_first_guide_is_free(auth_headers):
    headers, email = auth_headers

    me = requests.get(f"{BASE_URL}/api/auth/me", headers=headers, timeout=15)
    assert me.status_code == 200, me.text
    start_credits = me.json().get("credits")
    assert start_credits == 60, f"expected 60 starting credits, got {start_credits}"

    proj = requests.post(
        f"{BASE_URL}/api/projects",
        headers=headers,
        json={"title": "Fix a leaky faucet"},
        timeout=30,
    )
    assert proj.status_code in (200, 201), proj.text
    pid = proj.json()["id"]

    # Generate first guide - should be free
    guide = requests.post(f"{BASE_URL}/api/projects/{pid}/guide", headers=headers, timeout=120)
    assert guide.status_code == 200, f"guide gen failed: {guide.status_code} {guide.text[:500]}"
    body = guide.json()
    assert body.get("guide"), "no guide in response"
    assert isinstance(body.get("steps"), list) and len(body["steps"]) > 0

    me2 = requests.get(f"{BASE_URL}/api/auth/me", headers=headers, timeout=15)
    assert me2.status_code == 200
    end_credits = me2.json().get("credits")
    assert end_credits == 60, f"first guide should be FREE; credits changed {start_credits} -> {end_credits}"
