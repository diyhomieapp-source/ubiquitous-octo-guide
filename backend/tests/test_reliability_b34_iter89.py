"""
Backend tests for Build Doc 34 — Platform Reliability, Performance & Scalability MVP.
Covers: async jobs (list/get/cancel), async design concept+refine E2E with polling,
AI cost protection (rate-limit + kill switch), system status, admin reliability console.
"""
import os
import time
import pytest
import requests
from pymongo import MongoClient
from datetime import datetime, timezone

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001")).rstrip("/")
API = f"{BASE_URL}/api"

DEMO = {"email": "demo_home@diyhomie.com", "password": __import__("os").environ.get("TEST_USER_PASSWORD", "")}
ADMIN = {"email": "Diyhomieapp@gmail.com", "password": __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")}


@pytest.fixture(scope="module")
def demo_token():
    r = requests.post(f"{API}/auth/login", json=DEMO, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def demo_user_id():
    r = requests.post(f"{API}/auth/login", json=DEMO, timeout=30)
    return r.json()["user"]["id"]


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def h(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def mongo():
    mc = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    return mc[os.environ.get("DB_NAME", "diyhomie")]


# ================================================================ 1. jobs list + 404
def test_jobs_list_shape(demo_token):
    r = requests.get(f"{API}/hi/jobs", headers=h(demo_token), timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "jobs" in d and isinstance(d["jobs"], list)
    assert "active" in d and isinstance(d["active"], int)


def test_get_bogus_job_404(demo_token):
    r = requests.get(f"{API}/hi/jobs/does-not-exist-xyz", headers=h(demo_token), timeout=15)
    assert r.status_code == 404


# ================================================================ 2. Design async concept + refine E2E
@pytest.fixture(scope="module")
def created_project(demo_token):
    body = {"title": "TEST_reading_nook", "design_type": "room_refresh", "objective": "test nook"}
    r = requests.post(f"{API}/hi/design-studio/projects", headers=h(demo_token), json=body, timeout=30)
    assert r.status_code == 200, r.text
    pid = r.json()["project"]["id"]
    yield pid


def _poll_job(token, job_id, timeout_s=90):
    seen = set()
    start = time.time()
    last = None
    while time.time() - start < timeout_s:
        r = requests.get(f"{API}/hi/jobs/{job_id}", headers=h(token), timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        seen.add(j["status"])
        last = j
        if j["status"] in ("completed", "failed", "canceled"):
            return j, seen
        time.sleep(4)
    return last, seen


def test_design_concept_async_e2e(demo_token, created_project, mongo):
    pid = created_project
    r = requests.post(f"{API}/hi/design-studio/projects/{pid}/concept", headers=h(demo_token), timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "job_id" in d
    assert d["status"] == "queued"
    assert d.get("message")

    job, seen = _poll_job(demo_token, d["job_id"], timeout_s=120)
    assert job["status"] == "completed", f"final={job}"
    assert job["progress"] == 100
    # Should have passed through at least one running/waiting_provider state
    assert (seen & {"running", "waiting_provider"}), f"seen={seen}"

    # Verify version exists on project
    proj_r = requests.get(f"{API}/hi/design-studio/projects/{pid}", headers=h(demo_token), timeout=30)
    assert proj_r.status_code == 200
    versions = proj_r.json()["versions"]
    assert len(versions) >= 1
    assert versions[0]["version"] == 1
    assert versions[0].get("image_available") is True


def test_design_refine_async_e2e(demo_token, created_project):
    pid = created_project
    r = requests.post(f"{API}/hi/design-studio/projects/{pid}/refine",
                      headers=h(demo_token), json={"instruction": "warmer colors"}, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "queued"
    job, _ = _poll_job(demo_token, d["job_id"], timeout_s=120)
    assert job["status"] == "completed"

    proj_r = requests.get(f"{API}/hi/design-studio/projects/{pid}", headers=h(demo_token), timeout=30)
    versions = proj_r.json()["versions"]
    assert any(v["version"] == 2 for v in versions), [v["version"] for v in versions]


def test_cancel_completed_job_409(demo_token):
    # Find any completed job for demo user
    r = requests.get(f"{API}/hi/jobs", headers=h(demo_token), timeout=15)
    jobs = r.json()["jobs"]
    completed = [j for j in jobs if j["status"] == "completed"]
    assert completed, "No completed job to cancel"
    jid = completed[0]["id"]
    c = requests.post(f"{API}/hi/jobs/{jid}/cancel", headers=h(demo_token), timeout=15)
    assert c.status_code == 409


# ================================================================ 3. System status
def test_system_status_shape(demo_token):
    r = requests.get(f"{API}/hi/system/status", headers=h(demo_token), timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["overall"] in ("ok", "degraded")
    services = d["services"]
    assert len(services) == 6
    for svc in services:
        assert set(svc.keys()) >= {"key", "label", "tier", "status"}
        assert svc["tier"] in (1, 2, 3)
        assert svc["status"] in ("ok", "degraded")


# ================================================================ 4. Admin reliability console
def test_admin_jobs_overview(admin_token):
    r = requests.get(f"{API}/hi/admin/reliability/jobs", headers=h(admin_token), timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("queue_depth", "by_status", "by_type", "recent_failures"):
        assert k in d


def test_admin_costs(admin_token):
    r = requests.get(f"{API}/hi/admin/reliability/costs", headers=h(admin_token), timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("total", "by_feature", "by_provider"):
        assert k in d


def test_admin_limits_roundtrip(admin_token):
    g = requests.get(f"{API}/hi/admin/reliability/limits", headers=h(admin_token), timeout=15)
    assert g.status_code == 200
    original = g.json()
    p = requests.put(f"{API}/hi/admin/reliability/limits", headers=h(admin_token),
                     json={"ai_daily_per_user": 275}, timeout=15)
    assert p.status_code == 200
    assert p.json()["ai_daily_per_user"] == 275
    # restore
    requests.put(f"{API}/hi/admin/reliability/limits", headers=h(admin_token),
                 json={"ai_daily_per_user": original.get("ai_daily_per_user", 300)}, timeout=15)


def test_admin_endpoints_forbidden_for_demo(demo_token):
    for path in ("/hi/admin/reliability/jobs", "/hi/admin/reliability/costs", "/hi/admin/reliability/limits"):
        r = requests.get(f"{API}{path}", headers=h(demo_token), timeout=15)
        assert r.status_code == 403, f"{path} -> {r.status_code}"


# ================================================================ 5. AI cost protection: rate-limit + kill switch
def test_ai_cost_protection(admin_token, demo_token, demo_user_id, mongo, created_project):
    """Set daily cap to 1, trigger AI twice (second must 429), then set kill switch, trigger (503).
    Reset limits + delete rl_ai_calls for demo user for today at end."""
    # 1) Clear today's counter for demo user first
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    mongo.rl_ai_calls.delete_many({"user_id": demo_user_id, "day": day})

    # 2) Set cap = 1
    p = requests.put(f"{API}/hi/admin/reliability/limits", headers=h(admin_token),
                     json={"ai_daily_per_user": 1}, timeout=15)
    assert p.status_code == 200

    # 3) Create a conversation for demo user
    conv = requests.post(f"{API}/hi/chat/conversations", headers=h(demo_token),
                         json={"title": "TEST_b34_ratelimit"}, timeout=30)
    assert conv.status_code == 200, conv.text
    cid = conv.json()["id"]
    chat_body = {"text": "hi homie"}
    send_url = f"{API}/hi/chat/conversations/{cid}/message"

    # First call — may pass (200) or fail because cap==1 counts THIS call (>1 triggers). Cap=1 means count>1 raises, so 1st passes, 2nd blocked.
    r1 = requests.post(send_url, headers=h(demo_token), json=chat_body, timeout=90)
    first_status = r1.status_code

    # 4) Second call should be 429
    r2 = requests.post(send_url, headers=h(demo_token), json=chat_body, timeout=90)
    assert r2.status_code == 429, f"first={first_status} second={r2.status_code} body={r2.text[:300]}"
    msg = r2.json().get("detail", "")
    assert "limit" in msg.lower() or "reset" in msg.lower(), msg

    # 5) Turn on kill switch
    p = requests.put(f"{API}/hi/admin/reliability/limits", headers=h(admin_token),
                     json={"ai_kill_switch": True, "ai_daily_per_user": 300}, timeout=15)
    assert p.status_code == 200

    # Clear rate-limit counter so we don't get 429 first
    mongo.rl_ai_calls.delete_many({"user_id": demo_user_id, "day": day})

    r3 = requests.post(send_url, headers=h(demo_token), json=chat_body, timeout=90)
    assert r3.status_code == 503, f"expected 503 got {r3.status_code} body={r3.text[:300]}"
    assert "maintenance" in r3.json().get("detail", "").lower() or "paused" in r3.json().get("detail", "").lower()

    # 6) RESET at end
    r_reset = requests.put(f"{API}/hi/admin/reliability/limits", headers=h(admin_token),
                           json={"ai_daily_per_user": 300, "ai_kill_switch": False}, timeout=15)
    assert r_reset.status_code == 200
    assert r_reset.json()["ai_kill_switch"] is False
    assert r_reset.json()["ai_daily_per_user"] == 300
    # Clear demo user's counter for today
    mongo.rl_ai_calls.delete_many({"user_id": demo_user_id, "day": day})


# ================================================================ Cleanup fixture at module teardown
@pytest.fixture(scope="module", autouse=True)
def _final_cleanup(request, mongo, demo_user_id):
    yield
    # Delete any TEST_ ds_projects for demo user + their versions
    projs = list(mongo.ds_projects.find({"user_id": demo_user_id, "title": {"$regex": "^TEST_"}}, {"id": 1}))
    for p in projs:
        mongo.ds_versions.delete_many({"project_id": p["id"]})
        mongo.ds_inspirations.delete_many({"project_id": p["id"]})
        mongo.ds_projects.delete_one({"id": p["id"]})
    # Delete TEST_ conversations
    convs = list(mongo.hi_conversations.find({"user_id": demo_user_id, "title": {"$regex": "^TEST_"}}, {"id": 1}))
    for c in convs:
        mongo.hi_conversation_messages.delete_many({"conversation_id": c["id"]})
        mongo.hi_conversations.delete_one({"id": c["id"]})
    # Final safety: reset limits + clear ai counter
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    mongo.rl_ai_calls.delete_many({"user_id": demo_user_id, "day": day})
    mongo.rl_settings.update_one({"key": "limits"},
                                 {"$set": {"ai_daily_per_user": 300, "ai_kill_switch": False}}, upsert=True)
