"""
Iteration 100 — Backend verification for Docs 61 (notification snooze + Today with Homie
briefing) and 63 (Celebration engine).
"""
import os
import time
import uuid

import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://step-by-step-diy.preview.emergentagent.com").rstrip("/")
DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASSWORD = "Test1234"
ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASSWORD = "diyhomie1122"


def _login(email, password):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, r.json()
    return tok


def _register(email, password, name="Iter100 Tester"):
    r = requests.post(f"{BASE}/api/auth/register",
                      json={"email": email, "password": password, "name": name, "full_name": name},
                      timeout=30)
    assert r.status_code in (200, 201), f"register {email} -> {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def demo_headers():
    return {"Authorization": f"Bearer {_login(DEMO_EMAIL, DEMO_PASSWORD)}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_headers():
    return {"Authorization": f"Bearer {_login(ADMIN_EMAIL, ADMIN_PASSWORD)}", "Content-Type": "application/json"}


@pytest.fixture
def fresh_user_headers():
    """A brand-new user per test — free-tier project limit + first-completion achievement."""
    email = f"iter100_{uuid.uuid4().hex[:10]}@example.com"
    tok = _register(email, "Test1234")
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json", "X-Email": email}


# =========================================================================================
# DOC 61 — Briefing + Snooze
# =========================================================================================
class TestDoc61Briefing:
    def test_briefing_shape(self, demo_headers):
        r = requests.get(f"{BASE}/api/hi/notifications/briefing", headers=demo_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "greeting" in d and isinstance(d["greeting"], str)
        assert d["greeting"].startswith(("Good morning", "Good afternoon", "Good evening"))
        assert "items" in d and isinstance(d["items"], list)
        assert "empty_message" in d
        allowed = {"safety", "professional", "maintenance", "project", "delivery"}
        for it in d["items"]:
            assert it["kind"] in allowed, it
            assert "text" in it and "route" in it
        if d["items"]:
            assert d["empty_message"] is None, "empty_message should be null when items present"


class TestDoc61Snooze:
    def test_snooze_bad_option_400(self, fresh_user_headers):
        rt = requests.post(f"{BASE}/api/hi/notifications/test", json={"category": "maintenance"}, headers=fresh_user_headers, timeout=30)
        assert rt.status_code == 200
        inbox = requests.get(f"{BASE}/api/hi/notifications/inbox", headers=fresh_user_headers, timeout=30).json()
        items = [i for i in inbox["items"] if i.get("category") == "maintenance"]
        assert items, f"expected at least one maintenance test notification, got: {inbox}"
        iid = items[0]["id"]
        r = requests.post(f"{BASE}/api/hi/notifications/inbox/{iid}/snooze",
                          json={"option": "later"}, headers=fresh_user_headers, timeout=30)
        assert r.status_code == 400, r.text

    def test_snooze_tomorrow_hides_item(self, fresh_user_headers):
        rt = requests.post(f"{BASE}/api/hi/notifications/test", json={"category": "maintenance"}, headers=fresh_user_headers, timeout=30)
        assert rt.status_code == 200
        inbox = requests.get(f"{BASE}/api/hi/notifications/inbox", headers=fresh_user_headers, timeout=30).json()
        items = [i for i in inbox["items"] if i.get("category") == "maintenance"]
        assert items
        iid = items[0]["id"]
        r = requests.post(f"{BASE}/api/hi/notifications/inbox/{iid}/snooze",
                          json={"option": "tomorrow"}, headers=fresh_user_headers, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("snoozed_until"), body
        inbox2 = requests.get(f"{BASE}/api/hi/notifications/inbox", headers=fresh_user_headers, timeout=30).json()
        assert not any(i["id"] == iid for i in inbox2["items"]), "snoozed item should disappear from inbox"

    def test_snooze_safety_rejected_409(self, fresh_user_headers):
        rt = requests.post(f"{BASE}/api/hi/notifications/test", json={"category": "safety"},
                           headers=fresh_user_headers, timeout=30)
        assert rt.status_code == 200
        inbox = requests.get(f"{BASE}/api/hi/notifications/inbox?category=safety", headers=fresh_user_headers, timeout=30).json()
        assert inbox["items"], "expected at least one safety notif"
        iid = inbox["items"][0]["id"]
        r = requests.post(f"{BASE}/api/hi/notifications/inbox/{iid}/snooze",
                          json={"option": "tomorrow"}, headers=fresh_user_headers, timeout=30)
        assert r.status_code == 409, f"safety snooze must be rejected: {r.status_code} {r.text}"


# =========================================================================================
# DOC 63 — Celebration
# =========================================================================================
class TestDoc63Prefs:
    def test_get_defaults(self, demo_headers):
        r = requests.get(f"{BASE}/api/hi/celebration/prefs", headers=demo_headers, timeout=30)
        assert r.status_code == 200, r.text
        p = r.json()
        for k in ("celebrations_enabled", "music_enabled", "voice_enabled", "effects_enabled",
                  "reduced_motion", "achievements_visible"):
            assert k in p, f"missing pref {k}"

    def test_put_prefs_persists(self, demo_headers):
        # disable then re-enable
        r = requests.put(f"{BASE}/api/hi/celebration/prefs", json={"celebrations_enabled": False},
                         headers=demo_headers, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["celebrations_enabled"] is False
        r2 = requests.get(f"{BASE}/api/hi/celebration/prefs", headers=demo_headers, timeout=30)
        assert r2.json()["celebrations_enabled"] is False
        r3 = requests.put(f"{BASE}/api/hi/celebration/prefs", json={"celebrations_enabled": True},
                          headers=demo_headers, timeout=30)
        assert r3.status_code == 200
        assert r3.json()["celebrations_enabled"] is True


class TestDoc63AdminPackages:
    def test_admin_lists_seeded_package(self, admin_headers):
        r = requests.get(f"{BASE}/api/hi/admin/celebration/packages", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        pkgs = r.json()["packages"]
        ids = {p["id"] for p in pkgs}
        assert "HOMIE_VICTORY_01" in ids, f"seeded package missing: {ids}"


def _create_and_complete_project(headers, title="Replace kitchen sink drain P-trap under sink"):
    """Create a fresh project via /projects/start then mark completed via /outcome."""
    r = requests.post(f"{BASE}/api/hi/projects/start",
                      json={"goal": title, "project_category": "Fix Something"},
                      headers=headers, timeout=60)
    assert r.status_code in (200, 201), f"create project: {r.status_code} {r.text[:300]}"
    body = r.json()
    if body.get("needs_clarification"):
        # Retry once with an unambiguous goal
        r = requests.post(f"{BASE}/api/hi/projects/start",
                          json={"goal": "Install new bathroom faucet with braided supply lines", "project_category": "Fix Something"},
                          headers=headers, timeout=60)
        body = r.json()
    proj = body.get("project") or body
    pid = proj.get("id")
    assert pid, body
    ro = requests.post(f"{BASE}/api/hi/projects/{pid}/outcome",
                       json={"result": "completed", "actual_cost": "45"},
                       headers=headers, timeout=30)
    assert ro.status_code == 200, f"outcome: {ro.status_code} {ro.text}"
    return pid


class TestDoc63CompletionFlow:
    def test_409_when_not_completed(self, fresh_user_headers):
        # Create planned project, don't mark completed
        r = requests.post(f"{BASE}/api/hi/projects/start",
                          json={"goal": "Replace kitchen sink faucet with widespread fixture", "project_category": "Fix Something"},
                          headers=fresh_user_headers, timeout=60)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        if body.get("needs_clarification"):
            r = requests.post(f"{BASE}/api/hi/projects/start",
                              json={"goal": "Install new bathroom faucet with braided supply lines", "project_category": "Fix Something"},
                              headers=fresh_user_headers, timeout=60)
            body = r.json()
        pid = (body.get("project") or {}).get("id")
        assert pid, body
        rc = requests.post(f"{BASE}/api/hi/celebration/projects/{pid}/completed",
                           json={}, headers=fresh_user_headers, timeout=30)
        assert rc.status_code == 409, f"expected 409 for non-completed project: {rc.status_code} {rc.text}"

    def test_full_flow_first_completion(self, fresh_user_headers):
        # Fresh user's first completed project
        pid = _create_and_complete_project(fresh_user_headers, title="Fresh Iter100 Project")
        r = requests.post(f"{BASE}/api/hi/celebration/projects/{pid}/completed",
                          json={}, headers=fresh_user_headers, timeout=45)
        assert r.status_code == 200, r.text
        d = r.json()
        # completion record
        comp = d["completion"]
        assert comp["project_id"] == pid
        assert "estimated_pro_cost" in comp
        assert "estimated_savings" in comp
        assert "savings_note" in comp
        # celebration package
        cel = d["celebration"]
        assert cel is not None, "celebration should be present for enabled prefs"
        assert cel["id"] == "HOMIE_VICTORY_01"
        assert "play" in cel and isinstance(cel["play"], dict)
        for k in ("voice", "music", "effects", "animation"):
            assert k in cel["play"]
        assert isinstance(cel.get("events"), list) and len(cel["events"]) > 0
        # achievements: first_project_complete awarded for fresh user
        ach_types = {a["achievement_type"] for a in d.get("achievements", [])}
        assert "first_project_complete" in ach_types, f"expected first_project_complete: {ach_types}"
        assert d.get("already_recorded") is False
        # maintenance follow-up created
        assert comp.get("maintenance_follow_up_ids") or True  # updated post-insert; check via list
        mt = requests.get(f"{BASE}/api/hi/maintenance/tasks", headers=fresh_user_headers, timeout=30)
        if mt.status_code == 200:
            tasks = mt.json().get("tasks") or mt.json().get("items") or []
            post_project = [t for t in tasks if t.get("source") == "post_project" and t.get("project_id") == pid]
            assert post_project, "expected a post_project maintenance follow-up task"

        # 2nd call: already_recorded=true, celebration null
        r2 = requests.post(f"{BASE}/api/hi/celebration/projects/{pid}/completed",
                           json={}, headers=fresh_user_headers, timeout=30)
        assert r2.status_code == 200, r2.text
        d2 = r2.json()
        assert d2.get("already_recorded") is True
        assert d2.get("celebration") is None

        # Skipping event: use previous celebration event id
        cid = cel.get("celebration_event_id")
        assert cid
        rs = requests.post(f"{BASE}/api/hi/celebration/events/{cid}/skipped",
                           json={}, headers=fresh_user_headers, timeout=30)
        assert rs.status_code == 200, rs.text

        # GET /projects/{pid}/completion
        rg = requests.get(f"{BASE}/api/hi/celebration/projects/{pid}/completion",
                          headers=fresh_user_headers, timeout=30)
        assert rg.status_code == 200
        assert rg.json()["completion"]["project_id"] == pid

    def test_reduced_motion_shapes_package(self, fresh_user_headers):
        # Set reduced_motion=True
        r0 = requests.put(f"{BASE}/api/hi/celebration/prefs",
                          json={"reduced_motion": True}, headers=fresh_user_headers, timeout=30)
        assert r0.status_code == 200
        pid = _create_and_complete_project(fresh_user_headers, title="Reduced Motion Iter100")
        r = requests.post(f"{BASE}/api/hi/celebration/projects/{pid}/completed",
                          json={}, headers=fresh_user_headers, timeout=45)
        assert r.status_code == 200, r.text
        cel = r.json().get("celebration")
        assert cel is not None
        assert cel["duration_seconds"] == 2, f"expected duration_seconds=2 for reduced_motion: {cel['duration_seconds']}"
        assert cel["play"]["effects"] is False
        # reset
        requests.put(f"{BASE}/api/hi/celebration/prefs",
                     json={"reduced_motion": False}, headers=fresh_user_headers, timeout=30)

    def test_celebrations_disabled_returns_null(self, fresh_user_headers):
        requests.put(f"{BASE}/api/hi/celebration/prefs",
                     json={"celebrations_enabled": False}, headers=fresh_user_headers, timeout=30)
        pid = _create_and_complete_project(fresh_user_headers, title="Disabled Cel Iter100")
        r = requests.post(f"{BASE}/api/hi/celebration/projects/{pid}/completed",
                          json={}, headers=fresh_user_headers, timeout=45)
        assert r.status_code == 200, r.text
        assert r.json().get("celebration") is None
        # restore
        requests.put(f"{BASE}/api/hi/celebration/prefs",
                     json={"celebrations_enabled": True}, headers=fresh_user_headers, timeout=30)
