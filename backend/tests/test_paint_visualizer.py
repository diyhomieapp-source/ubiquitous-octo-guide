"""Backend tests for Decor8 Paint/Finish Visualizer.

IMPORTANT: Each successful /api/visualize render hits the live Decor8 API
(~$0.20 per call). We deliberately make AT MOST 1 successful render and
verify everything else (auth, validation, 402, history) through free paths
(401/400/402 are checked BEFORE the Decor8 HTTP call in server.py).
"""
import os
import time
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', '').rstrip('/') or \
    os.environ.get('EXPO_BACKEND_URL', '').rstrip('/')
assert BASE_URL, "BACKEND URL must be set"
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME', 'diyhomie')

# Public room photo recommended by main agent
SAMPLE_IMAGE_URL = "https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=1024"


# ---------------------------------------------------------- fixtures
@pytest.fixture(scope="module")
def fresh_user():
    """Register a brand-new user so their first /visualize is free (cost=0)."""
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    ts = int(time.time())
    email = f"TEST_paint_{ts}@diyhomie.com"
    r = s.post(f"{API}/auth/register",
               json={"email": email, "password": "Test1234", "name": "PaintTester"},
               timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    token = data["access_token"]
    user = data["user"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    return {"session": s, "email": email, "user_id": user["id"], "starting_credits": user["credits"]}


@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


# ---------------------------------------------------------- auth
def test_visualize_requires_auth():
    """No token -> 401 (or 403 depending on auth middleware shape)."""
    r = requests.post(f"{API}/visualize",
                      json={"image_base64": SAMPLE_IMAGE_URL, "feature_type": "wall", "color_hex": "#3A5A78"},
                      timeout=15)
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text}"


def test_history_requires_auth():
    r = requests.get(f"{API}/visualize/history", timeout=15)
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"


# ---------------------------------------------------------- validation (free, returns before Decor8)
def test_visualize_wall_missing_color_400(fresh_user):
    s = fresh_user["session"]
    r = s.post(f"{API}/visualize",
               json={"image_base64": SAMPLE_IMAGE_URL, "feature_type": "wall", "room_type": "bedroom"},
               timeout=15)
    assert r.status_code == 400, r.text
    assert "color" in r.json().get("detail", "").lower()


def test_visualize_cabinet_missing_color_400(fresh_user):
    s = fresh_user["session"]
    r = s.post(f"{API}/visualize",
               json={"image_base64": SAMPLE_IMAGE_URL, "feature_type": "cabinet"},
               timeout=15)
    assert r.status_code == 400, r.text


def test_visualize_missing_image_400(fresh_user):
    s = fresh_user["session"]
    r = s.post(f"{API}/visualize",
               json={"image_base64": "", "feature_type": "wall", "color_hex": "#3A5A78"},
               timeout=15)
    assert r.status_code == 400, r.text


# ---------------------------------------------------------- LIVE Decor8 call (1 only)
def test_visualize_wall_first_call_is_free(fresh_user):
    """Single live Decor8 render to verify shape + free-first-render logic."""
    s = fresh_user["session"]
    payload = {
        "image_base64": SAMPLE_IMAGE_URL,
        "feature_type": "wall",
        "color_hex": "#3A5A78",
        "room_type": "bedroom",
    }
    r = s.post(f"{API}/visualize", json=payload, timeout=120)
    assert r.status_code == 200, f"render failed: {r.status_code} {r.text[:400]}"
    body = r.json()

    # response shape
    assert "result_url" in body and isinstance(body["result_url"], str)
    assert body["result_url"].startswith("http")
    assert body["cost"] == 0, f"first render must be free, got cost={body['cost']}"
    assert body["credits"] == fresh_user["starting_credits"], \
        f"credits should be unchanged on first free render; got {body['credits']} vs {fresh_user['starting_credits']}"
    assert body.get("feature_type") == "wall"
    assert body.get("color_hex") == "#3A5A78"
    assert body.get("room_type") == "bedroom"
    assert body.get("id")
    assert "_id" not in body  # mongo internal id must not leak


# ---------------------------------------------------------- history persistence
def test_history_returns_recent_render(fresh_user):
    s = fresh_user["session"]
    r = s.get(f"{API}/visualize/history", timeout=15)
    assert r.status_code == 200, r.text
    items = r.json()
    assert isinstance(items, list)
    assert len(items) >= 1, "should contain the render we just made"
    item = items[0]
    assert item["feature_type"] == "wall"
    assert item["color_hex"] == "#3A5A78"
    assert item["result_url"].startswith("http")
    assert "_id" not in item


# ---------------------------------------------------------- 402 path (free — happens before Decor8 call)
def test_visualize_insufficient_credits_402(fresh_user, mongo):
    """Drop user credits to 0 so the 2nd render trips the 402 check before
    Decor8 is called (no money spent)."""
    user_id = fresh_user["user_id"]
    mongo.users.update_one({"id": user_id}, {"$set": {"credits": 0}})

    s = fresh_user["session"]
    r = s.post(f"{API}/visualize",
               json={"image_base64": SAMPLE_IMAGE_URL, "feature_type": "wall",
                     "color_hex": "#3A5A78", "room_type": "bedroom"},
               timeout=15)
    assert r.status_code == 402, f"expected 402, got {r.status_code}: {r.text}"
    assert "credit" in r.json().get("detail", "").lower()


# ---------------------------------------------------------- teardown
def test_cleanup(fresh_user, mongo):
    """Remove the seeded test user + their visualizations."""
    user_id = fresh_user["user_id"]
    mongo.visualizations.delete_many({"user_id": user_id})
    mongo.users.delete_one({"id": user_id})
    assert mongo.users.find_one({"id": user_id}) is None
