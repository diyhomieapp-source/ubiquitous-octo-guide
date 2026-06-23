"""Backend tests for the built-in email autoresponder engine (email_engine.py).

Covers:
- Admin auth gating on /api/admin/email/*
- Overview endpoint shape & draft-mode (configured=false)
- Templates CRUD incl. transactional-delete guard
- Automations CRUD incl. enrolled/active_runs counts
- Segments + Campaigns (create/send queued/delete) with suppression skip
- Suppression CRUD
- Public webhook + tracking endpoints (no auth)
- Welcome-on-signup trigger wiring via /api/auth/register
"""
import os
import base64
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL",
                          "https://step-by-step-diy.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASSWORD = "diyhomie1122"
DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASSWORD = "Test1234"

TRANSACTIONAL_KEYS = {"welcome", "purchase", "renewal", "ticket_reply"}


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _login(s, email, password):
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_token(s):
    return _login(s, ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="session")
def demo_token(s):
    try:
        return _login(s, DEMO_EMAIL, DEMO_PASSWORD)
    except AssertionError:
        # Auto-create the demo user if it doesn't exist yet
        s.post(f"{BASE_URL}/api/auth/register",
               json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD, "name": "Demo"}, timeout=20)
        return _login(s, DEMO_EMAIL, DEMO_PASSWORD)


def _ah(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- auth gating ----------
class TestAuthGating:
    def test_overview_requires_auth(self, s):
        r = s.get(f"{BASE_URL}/api/admin/email/overview", timeout=20)
        assert r.status_code in (401, 403), f"got {r.status_code}: {r.text}"

    def test_overview_forbidden_for_non_admin(self, s, demo_token):
        r = s.get(f"{BASE_URL}/api/admin/email/overview", headers=_ah(demo_token), timeout=20)
        assert r.status_code == 403, f"got {r.status_code}: {r.text}"

    def test_templates_requires_auth(self, s):
        r = s.get(f"{BASE_URL}/api/admin/email/templates", timeout=20)
        assert r.status_code in (401, 403)


# ---------- overview ----------
class TestOverview:
    def test_overview_shape_and_draft_mode(self, s, admin_token):
        r = s.get(f"{BASE_URL}/api/admin/email/overview", headers=_ah(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("configured") is False, "AWS keys absent → configured must be false (draft mode)"
        assert "noreply@diyhomie.com" in d.get("sender", "")
        assert d.get("region")
        for k in ("total_sent", "sent_today", "queued", "open_rate",
                  "delivered", "bounces", "complaints", "suppressed", "active_automations"):
            assert k in d, f"missing field: {k}"


# ---------- templates ----------
class TestTemplates:
    def test_seeded_transactional_templates(self, s, admin_token):
        r = s.get(f"{BASE_URL}/api/admin/email/templates", headers=_ah(admin_token), timeout=20)
        assert r.status_code == 200
        tpls = r.json()
        keys = {t.get("key") for t in tpls if t.get("key")}
        missing = TRANSACTIONAL_KEYS - keys
        assert not missing, f"missing seeded transactional keys: {missing}"

    def test_create_update_delete_marketing_template(self, s, admin_token):
        h = _ah(admin_token)
        payload = {
            "name": f"TEST_marketing_{uuid.uuid4().hex[:6]}",
            "subject": "TEST {{name}}", "html": "<p>hi {{name}}</p>",
            "type": "marketing", "active": True,
        }
        r = s.post(f"{BASE_URL}/api/admin/email/templates", headers=h, json=payload, timeout=20)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]

        # update
        payload["subject"] = "TEST updated"
        r2 = s.put(f"{BASE_URL}/api/admin/email/templates/{tid}", headers=h, json=payload, timeout=20)
        assert r2.status_code == 200, r2.text
        assert r2.json()["subject"] == "TEST updated"

        # delete
        r3 = s.delete(f"{BASE_URL}/api/admin/email/templates/{tid}", headers=h, timeout=20)
        assert r3.status_code == 200
        assert r3.json().get("ok") is True

    def test_cannot_delete_transactional_template(self, s, admin_token):
        h = _ah(admin_token)
        r = s.get(f"{BASE_URL}/api/admin/email/templates", headers=h, timeout=20)
        welcome = next((t for t in r.json() if t.get("key") == "welcome"), None)
        assert welcome, "welcome template not seeded"
        r2 = s.delete(f"{BASE_URL}/api/admin/email/templates/{welcome['id']}", headers=h, timeout=20)
        assert r2.status_code == 400, f"expected 400 for built-in delete, got {r2.status_code}: {r2.text}"


# ---------- automations ----------
class TestAutomations:
    def test_automations_crud(self, s, admin_token):
        h = _ah(admin_token)
        payload = {
            "name": f"TEST_auto_{uuid.uuid4().hex[:6]}",
            "trigger": "welcome", "active": True,
            "steps": [{"delay_minutes": 0, "subject": "Hi {{name}}", "html": "<p>hello</p>"}],
        }
        r = s.post(f"{BASE_URL}/api/admin/email/automations", headers=h, json=payload, timeout=20)
        assert r.status_code == 200, r.text
        aid = r.json()["id"]

        # list (should include counts)
        rl = s.get(f"{BASE_URL}/api/admin/email/automations", headers=h, timeout=20)
        assert rl.status_code == 200
        match = next((a for a in rl.json() if a["id"] == aid), None)
        assert match, "created automation not in list"
        assert "enrolled" in match and "active_runs" in match

        # update
        payload["name"] += "_upd"
        ru = s.put(f"{BASE_URL}/api/admin/email/automations/{aid}", headers=h, json=payload, timeout=20)
        assert ru.status_code == 200
        assert ru.json()["name"].endswith("_upd")

        # delete
        rd = s.delete(f"{BASE_URL}/api/admin/email/automations/{aid}", headers=h, timeout=20)
        assert rd.status_code == 200


# ---------- segments + campaigns + suppression skip ----------
class TestSegmentsAndCampaigns:
    def test_segments_list_includes_all_users(self, s, admin_token):
        r = s.get(f"{BASE_URL}/api/admin/email/segments", headers=_ah(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "segments" in d and isinstance(d["segments"], list)
        names = [x.get("name") for x in d["segments"]]
        assert "All Users" in names
        all_users = next(x for x in d["segments"] if x["name"] == "All Users")
        assert isinstance(all_users.get("count"), int) and all_users["count"] >= 1

    def test_campaign_create_send_delete_and_suppression_skip(self, s, admin_token):
        h = _ah(admin_token)

        # 1) suppress a known email so it's excluded from the broadcast
        suppress_email = f"TEST_suppress_{uuid.uuid4().hex[:6]}@example.com".lower()
        r_add = s.post(f"{BASE_URL}/api/admin/email/suppression", headers=h,
                       json={"email": suppress_email, "reason": "test"}, timeout=20)
        assert r_add.status_code == 200

        # 2) register a real new user (will end up in 'All Users') — also triggers welcome enqueue
        new_email = f"TEST_camp_{uuid.uuid4().hex[:6]}@example.com".lower()
        rr = s.post(f"{BASE_URL}/api/auth/register",
                    json={"email": new_email, "password": "Test1234", "name": "T"}, timeout=30)
        assert rr.status_code == 200, rr.text

        # snapshot queued count before
        q0 = s.get(f"{BASE_URL}/api/admin/email/overview", headers=h, timeout=20).json().get("queued", 0)

        # 3) create campaign
        camp = {"name": f"TEST_camp_{uuid.uuid4().hex[:6]}",
                "segment": "All Users",
                "subject": "Hi {{name}}",
                "html": "<p>broadcast</p>"}
        rc = s.post(f"{BASE_URL}/api/admin/email/campaigns", headers=h, json=camp, timeout=20)
        assert rc.status_code == 200, rc.text
        cid = rc.json()["id"]
        assert rc.json()["status"] == "draft"

        # 4) send
        rs = s.post(f"{BASE_URL}/api/admin/email/campaigns/{cid}/send", headers=h, timeout=60)
        assert rs.status_code == 200, rs.text
        body = rs.json()
        assert "queued" in body and body["queued"] >= 1

        # queued counter should have grown
        q1 = s.get(f"{BASE_URL}/api/admin/email/overview", headers=h, timeout=20).json().get("queued", 0)
        assert q1 >= q0 + 1, f"queued did not grow: before={q0} after={q1}"

        # 5) verify suppressed email is NOT in the campaign's queue rows
        rq = s.get(f"{BASE_URL}/api/admin/email/queue", headers=h, timeout=30)
        assert rq.status_code == 200
        rows = rq.json()
        for row in rows:
            if row.get("campaign_id") == cid:
                assert row.get("to_email", "").lower() != suppress_email, "suppressed email was enqueued"

        # cleanup
        s.delete(f"{BASE_URL}/api/admin/email/campaigns/{cid}", headers=h, timeout=20)
        b64 = base64.urlsafe_b64encode(suppress_email.encode()).decode().rstrip("=")
        s.delete(f"{BASE_URL}/api/admin/email/suppression/{b64}", headers=h, timeout=20)


# ---------- suppression CRUD ----------
class TestSuppression:
    def test_add_list_delete_suppression(self, s, admin_token):
        h = _ah(admin_token)
        email = f"TEST_sup_{uuid.uuid4().hex[:6]}@example.com".lower()
        r = s.post(f"{BASE_URL}/api/admin/email/suppression", headers=h,
                   json={"email": email, "reason": "test"}, timeout=20)
        assert r.status_code == 200

        rl = s.get(f"{BASE_URL}/api/admin/email/suppression", headers=h, timeout=20)
        assert rl.status_code == 200
        assert any(x.get("email") == email for x in rl.json())

        b64 = base64.urlsafe_b64encode(email.encode()).decode().rstrip("=")
        rd = s.delete(f"{BASE_URL}/api/admin/email/suppression/{b64}", headers=h, timeout=20)
        assert rd.status_code == 200

        rl2 = s.get(f"{BASE_URL}/api/admin/email/suppression", headers=h, timeout=20)
        assert not any(x.get("email") == email for x in rl2.json())


# ---------- welcome on signup ----------
class TestWelcomeOnSignup:
    def test_register_enqueues_welcome(self, s, admin_token):
        h = _ah(admin_token)
        new_email = f"TEST_wel_{uuid.uuid4().hex[:6]}@example.com".lower()
        r = s.post(f"{BASE_URL}/api/auth/register",
                   json={"email": new_email, "password": "Test1234", "name": "Welly"}, timeout=30)
        assert r.status_code == 200, r.text

        # give the engine a moment
        time.sleep(1.0)
        rq = s.get(f"{BASE_URL}/api/admin/email/queue", headers=h, timeout=30)
        assert rq.status_code == 200
        rows = rq.json()
        match = [x for x in rows if x.get("to_email", "").lower() == new_email]
        assert match, f"no queue row enqueued for new signup {new_email}"
        # transactional welcome row should exist
        assert any(x.get("kind") == "transactional" for x in match), \
            f"welcome row not kind=transactional for {new_email}: {match}"


# ---------- public tracking + webhook ----------
class TestPublicTracking:
    def test_open_pixel_marks_opened(self, s, admin_token):
        h = _ah(admin_token)

        # register a fresh user to get a guaranteed welcome queue row
        new_email = f"TEST_open_{uuid.uuid4().hex[:6]}@example.com".lower()
        r = s.post(f"{BASE_URL}/api/auth/register",
                   json={"email": new_email, "password": "Test1234", "name": "Op"}, timeout=30)
        assert r.status_code == 200

        time.sleep(1.0)
        rq = s.get(f"{BASE_URL}/api/admin/email/queue", headers=h, timeout=30).json()
        row = next((x for x in rq if x.get("to_email", "").lower() == new_email), None)
        assert row, "queue row missing"
        qid = row["id"]

        # hit the open pixel (public, no auth)
        rp = requests.get(f"{BASE_URL}/api/e/o/{qid}.png", timeout=20)
        assert rp.status_code == 200
        assert rp.headers.get("content-type", "").startswith("image/png")

        time.sleep(0.5)
        rq2 = s.get(f"{BASE_URL}/api/admin/email/queue", headers=h, timeout=30).json()
        row2 = next((x for x in rq2 if x["id"] == qid), None)
        assert row2 and row2.get("opened") is True, "opened flag not set after pixel hit"

    def test_unsubscribe_suppresses(self, s, admin_token):
        h = _ah(admin_token)
        email = f"TEST_unsub_{uuid.uuid4().hex[:6]}@example.com".lower()
        b64 = base64.urlsafe_b64encode(email.encode()).decode().rstrip("=")
        ru = requests.get(f"{BASE_URL}/api/e/u/{b64}", timeout=20)
        assert ru.status_code == 200
        assert "unsubscrib" in ru.text.lower()

        rl = s.get(f"{BASE_URL}/api/admin/email/suppression", headers=h, timeout=20).json()
        assert any(x.get("email") == email for x in rl), "unsubscribe did not add to suppression list"

        # cleanup
        s.delete(f"{BASE_URL}/api/admin/email/suppression/{b64}", headers=h, timeout=20)

    def test_ses_bounce_webhook_adds_suppression(self, s, admin_token):
        h = _ah(admin_token)
        email = f"TEST_bounce_{uuid.uuid4().hex[:6]}@example.com".lower()
        # SNS Notification envelope; Message is a JSON string per SES spec
        import json as _json
        msg = _json.dumps({
            "notificationType": "Bounce",
            "eventType": "Bounce",
            "mail": {"messageId": "fake-mid", "destination": [email]},
            "bounce": {"bounceType": "Permanent"},
        })
        payload = {"Type": "Notification", "Message": msg}
        r = requests.post(f"{BASE_URL}/api/e/webhooks/ses", json=payload, timeout=20)
        assert r.status_code == 200, r.text

        rl = s.get(f"{BASE_URL}/api/admin/email/suppression", headers=h, timeout=20).json()
        assert any(x.get("email") == email for x in rl), "bounce did not add to suppression list"

        # cleanup
        b64 = base64.urlsafe_b64encode(email.encode()).decode().rstrip("=")
        s.delete(f"{BASE_URL}/api/admin/email/suppression/{b64}", headers=h, timeout=20)
