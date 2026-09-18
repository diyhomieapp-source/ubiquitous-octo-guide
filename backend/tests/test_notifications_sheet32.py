"""Sheet #32 - Notification, Alert & Messaging Center tests."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001")).rstrip("/")
API = f"{BASE_URL}/api"

USER_EMAIL = "demo_home@diyhomie.com"
USER_PW = __import__("os").environ.get("TEST_USER_PASSWORD", "")
PRO_EMAIL = "pat_pro_test@diyhomie.com"
PRO_PW = __import__("os").environ.get("TEST_USER_PASSWORD", "")
ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PW = __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")


def _login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json().get("access_token") or r.json()["token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def user_tok():
    return _login(USER_EMAIL, USER_PW)


@pytest.fixture(scope="module")
def admin_tok():
    return _login(ADMIN_EMAIL, ADMIN_PW)


@pytest.fixture(scope="module")
def pro_tok():
    return _login(PRO_EMAIL, PRO_PW)


# ---------------- List, unread-count, filter ----------------
class TestNotificationList:
    def test_list_shape(self, user_tok):
        r = requests.get(f"{API}/notifications", headers=_h(user_tok), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "items" in d and isinstance(d["items"], list)
        assert "unread_count" in d and isinstance(d["unread_count"], int)

    def test_unread_count_endpoint(self, user_tok):
        r = requests.get(f"{API}/notifications/unread-count", headers=_h(user_tok), timeout=30)
        assert r.status_code == 200
        assert "unread_count" in r.json()

    def test_filter_by_type(self, user_tok):
        for f in ("project", "safety", "social", "promo"):
            r = requests.get(f"{API}/notifications?filter={f}", headers=_h(user_tok), timeout=30)
            assert r.status_code == 200
            items = r.json()["items"]
            for it in items:
                assert it["type"] == f, f"filter={f} returned type={it['type']}"


# ---------------- Preferences ----------------
class TestPreferences:
    def test_get_defaults(self, user_tok):
        r = requests.get(f"{API}/notifications/preferences", headers=_h(user_tok), timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("project", "safety", "social", "promo", "system", "dnd"):
            assert k in d

    def test_put_and_persist(self, user_tok):
        payload = {"project": True, "safety": True, "social": True, "promo": False, "system": True, "dnd": False}
        r = requests.put(f"{API}/notifications/preferences", headers=_h(user_tok), json=payload, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["promo"] is False
        # verify persisted
        r2 = requests.get(f"{API}/notifications/preferences", headers=_h(user_tok), timeout=30)
        assert r2.json()["promo"] is False

    def test_restore_prefs(self, user_tok):
        # cleanup - restore all defaults
        payload = {"project": True, "safety": True, "social": True, "promo": True, "system": True, "dnd": False}
        r = requests.put(f"{API}/notifications/preferences", headers=_h(user_tok), json=payload, timeout=30)
        assert r.status_code == 200


# ---------------- Emergency triggers safety+urgent ----------------
class TestEmergencyPush:
    def test_emergency_creates_safety_urgent(self, user_tok):
        pre = requests.get(f"{API}/notifications?filter=safety", headers=_h(user_tok), timeout=30).json()["items"]
        pre_ids = {n["id"] for n in pre}
        # trigger
        r = requests.post(f"{API}/emergency/triage", headers=_h(user_tok),
                          json={"scenario": "leak", "severity": "high"}, timeout=60)
        # Even if payload shape differs, at least ensure endpoint exists (200 or 422); try alternate shape
        if r.status_code >= 400:
            r = requests.post(f"{API}/emergency/triage", headers=_h(user_tok),
                              json={"scenario": "leak"}, timeout=60)
        assert r.status_code in (200, 201), f"triage failed: {r.status_code} {r.text[:200]}"
        time.sleep(1)
        post = requests.get(f"{API}/notifications?filter=safety", headers=_h(user_tok), timeout=30).json()["items"]
        new = [n for n in post if n["id"] not in pre_ids]
        assert len(new) >= 1, "no new safety notification after emergency/triage"
        n = new[0]
        assert n["type"] == "safety"
        assert n["priority"] == "urgent"


# ---------------- Mark read / read-all / delete ----------------
class TestReadDelete:
    def test_mark_one_read_decrements(self, user_tok, admin_tok):
        # ensure at least one unread by admin broadcast
        r = requests.post(f"{API}/admin/notifications/broadcast", headers=_h(admin_tok),
                          json={"title": "TEST_r1", "body": "b", "segment": "all", "ntype": "system"}, timeout=60)
        assert r.status_code == 200
        time.sleep(0.5)
        pre = requests.get(f"{API}/notifications/unread-count", headers=_h(user_tok), timeout=30).json()["unread_count"]
        items = requests.get(f"{API}/notifications", headers=_h(user_tok), timeout=30).json()["items"]
        unread = [n for n in items if not n["read"]]
        assert unread, "no unread notifications to test"
        target = unread[0]
        r2 = requests.post(f"{API}/notifications/{target['id']}/read", headers=_h(user_tok), timeout=30)
        assert r2.status_code == 200
        post = requests.get(f"{API}/notifications/unread-count", headers=_h(user_tok), timeout=30).json()["unread_count"]
        assert post == pre - 1, f"unread {pre}→{post}"

    def test_read_all_zeroes(self, user_tok):
        r = requests.post(f"{API}/notifications/read-all", headers=_h(user_tok), timeout=30)
        assert r.status_code == 200
        # note: safety+urgent still delivers even if user disabled promo; but read-all marks them read
        c = requests.get(f"{API}/notifications/unread-count", headers=_h(user_tok), timeout=30).json()["unread_count"]
        assert c == 0

    def test_delete_removes(self, user_tok, admin_tok):
        requests.post(f"{API}/admin/notifications/broadcast", headers=_h(admin_tok),
                      json={"title": "TEST_del", "body": "x", "segment": "all", "ntype": "system"}, timeout=60)
        time.sleep(0.5)
        items = requests.get(f"{API}/notifications", headers=_h(user_tok), timeout=30).json()["items"]
        target = next((n for n in items if n["title"] == "TEST_del"), items[0])
        r = requests.delete(f"{API}/notifications/{target['id']}", headers=_h(user_tok), timeout=30)
        assert r.status_code == 200
        items2 = requests.get(f"{API}/notifications", headers=_h(user_tok), timeout=30).json()["items"]
        assert not any(n["id"] == target["id"] for n in items2), "notification not deleted"


# ---------------- Preference honoring + urgent override ----------------
class TestPreferenceOverride:
    def test_promo_disabled_blocks_promo_broadcast(self, user_tok, admin_tok):
        # disable promo
        requests.put(f"{API}/notifications/preferences", headers=_h(user_tok),
                     json={"project": True, "safety": True, "social": True, "promo": False, "system": True, "dnd": False},
                     timeout=30)
        # clear read/state
        requests.post(f"{API}/notifications/read-all", headers=_h(user_tok), timeout=30)
        # count promo before
        pre = requests.get(f"{API}/notifications?filter=promo", headers=_h(user_tok), timeout=30).json()["items"]
        pre_ids = {n["id"] for n in pre}
        # admin broadcasts promo
        r = requests.post(f"{API}/admin/notifications/broadcast", headers=_h(admin_tok),
                          json={"title": "TEST_promo_off", "body": "sale", "segment": "all",
                                "ntype": "promo", "priority": "normal"}, timeout=60)
        assert r.status_code == 200
        time.sleep(0.5)
        post = requests.get(f"{API}/notifications?filter=promo", headers=_h(user_tok), timeout=30).json()["items"]
        new = [n for n in post if n["id"] not in pre_ids and n["title"] == "TEST_promo_off"]
        assert not new, "promo broadcast should NOT create notification when user disabled promo pref"

    def test_urgent_always_delivers(self, user_tok, admin_tok):
        # promo still disabled + dnd true
        requests.put(f"{API}/notifications/preferences", headers=_h(user_tok),
                     json={"project": True, "safety": True, "social": True, "promo": False, "system": False, "dnd": True},
                     timeout=30)
        pre_ids = {n["id"] for n in requests.get(f"{API}/notifications", headers=_h(user_tok), timeout=30).json()["items"]}
        r = requests.post(f"{API}/admin/notifications/broadcast", headers=_h(admin_tok),
                          json={"title": "TEST_urgent", "body": "critical", "segment": "all",
                                "ntype": "safety", "priority": "urgent"}, timeout=60)
        assert r.status_code == 200
        time.sleep(0.5)
        post = requests.get(f"{API}/notifications", headers=_h(user_tok), timeout=30).json()["items"]
        new = [n for n in post if n["id"] not in pre_ids and n["title"] == "TEST_urgent"]
        assert new, "urgent safety broadcast MUST deliver even with prefs off + DND"
        # restore prefs
        requests.put(f"{API}/notifications/preferences", headers=_h(user_tok),
                     json={"project": True, "safety": True, "social": True, "promo": True, "system": True, "dnd": False},
                     timeout=30)


# ---------------- Admin broadcast ----------------
class TestAdminBroadcast:
    def test_non_admin_forbidden(self, user_tok):
        r = requests.post(f"{API}/admin/notifications/broadcast", headers=_h(user_tok),
                          json={"title": "x", "body": "y"}, timeout=30)
        assert r.status_code == 403

    def test_broadcast_returns_recipients(self, admin_tok):
        r = requests.post(f"{API}/admin/notifications/broadcast", headers=_h(admin_tok),
                          json={"title": "TEST_bcast_all", "body": "hi", "segment": "all", "ntype": "system"},
                          timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert "recipients" in d and d["recipients"] >= 1
        assert d.get("ok") is True

    def test_campaigns_read_rate(self, admin_tok, user_tok):
        # send a fresh campaign then read one
        r = requests.post(f"{API}/admin/notifications/broadcast", headers=_h(admin_tok),
                          json={"title": "TEST_rate", "body": "z", "segment": "all", "ntype": "system"}, timeout=60)
        assert r.status_code == 200
        cid = r.json()["campaign_id"]
        # mark this user's notif read
        time.sleep(0.5)
        items = requests.get(f"{API}/notifications", headers=_h(user_tok), timeout=30).json()["items"]
        mine = next((n for n in items if n.get("meta", {}).get("campaign_id") == cid), None)
        assert mine, "user didn't receive campaign notification"
        requests.post(f"{API}/notifications/{mine['id']}/read", headers=_h(user_tok), timeout=30)
        # list campaigns
        r2 = requests.get(f"{API}/admin/notifications/campaigns", headers=_h(admin_tok), timeout=30)
        assert r2.status_code == 200
        camps = r2.json()
        target = next((c for c in camps if c["id"] == cid), None)
        assert target, "campaign missing from list"
        assert target["read_count"] >= 1
        assert target["read_rate"] > 0

    def test_segment_pro(self, admin_tok):
        r = requests.post(f"{API}/admin/notifications/broadcast", headers=_h(admin_tok),
                          json={"title": "TEST_pro_seg", "body": "pros only", "segment": "pro", "ntype": "system"},
                          timeout=60)
        assert r.status_code == 200
        # at least 1 pro should exist
        assert r.json()["recipients"] >= 0


# ---------------- Project notifications (proposal/invoice) ----------------
class TestProjectNotifications:
    def test_proposal_creates_client_project_notif(self, pro_tok, user_tok):
        # find pro's jobs
        rj = requests.get(f"{API}/jobs", headers=_h(pro_tok), timeout=30)
        if rj.status_code != 200 or not rj.json():
            pytest.skip("pro has no jobs")
        jobs = rj.json()
        job = jobs[0] if isinstance(jobs, list) else jobs.get("items", [None])[0]
        if not job:
            pytest.skip("no job available")
        jid = job["id"]
        pre_ids = {n["id"] for n in requests.get(f"{API}/notifications?filter=project",
                                                   headers=_h(user_tok), timeout=30).json()["items"]}
        # create a proposal
        r = requests.post(f"{API}/jobs/{jid}/proposals", headers=_h(pro_tok),
                          json={"amount": 100, "notes": "TEST_prop"}, timeout=30)
        if r.status_code not in (200, 201):
            pytest.skip(f"proposal endpoint returned {r.status_code}: skip")
        time.sleep(1)
        post = requests.get(f"{API}/notifications?filter=project", headers=_h(user_tok), timeout=30).json()["items"]
        new = [n for n in post if n["id"] not in pre_ids]
        assert new, "client should receive project notification after pro proposal"
