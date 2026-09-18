"""B35 Community Knowledge, Project Sharing & Moderation Engine backend tests.

Namespace: /api/hi/community/* (user) and /api/hi/admin/community/* (admin).
"""
import os
import uuid
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001")).rstrip("/")
API = f"{BASE_URL}/api"

USER_EMAIL = "demo_home@diyhomie.com"
USER_PASS = __import__("os").environ.get("TEST_USER_PASSWORD", "")
ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASS = __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")


def _login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def user_token():
    return _login(USER_EMAIL, USER_PASS)


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PASS)


def _uh(tok):
    return {"Authorization": f"Bearer {tok}"}


# --------------------------------------------------------------- categories
def test_categories_ok(user_token):
    r = requests.get(f"{API}/hi/community/categories", headers=_uh(user_token), timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert "Electrical Safety" in j["categories"]
    assert "CommunityTip" in j["content_types"]
    assert "Electrical Safety" in j["high_risk_categories"]


# --------------------------------------------------------------- pre-checks: clean
def test_create_clean_draft_no_flags(user_token):
    body = {
        "content_type": "CommunityTip",
        "title": f"TEST_clean {uuid.uuid4().hex[:6]}",
        "body": "Replaced my kitchen faucet successfully; used two wrenches and shut the water valves first.",
        "category": "Repairs",
        "visibility": "draft",
    }
    r = requests.post(f"{API}/hi/community/content", headers=_uh(user_token), json=body, timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["content"]["moderation_status"] == "draft"
    assert j["pre_checks"]["safety_classification"] == "safe"
    assert j["pre_checks"]["requires_enhanced_review"] is False
    assert j["pre_checks"]["flags"] == []
    return j["content"]["id"]


# --------------------------------------------------------------- pre-checks: PII + unsafe + high_risk cat
@pytest.fixture(scope="module")
def high_risk_content_id(user_token):
    body = {
        "content_type": "CommunityTip",
        "title": f"TEST_risky {uuid.uuid4().hex[:6]}",
        "body": "Call me at 555-123-4567 and I'll show you how to bypass the breaker in your panel to power your shed.",
        "category": "Electrical Safety",
        "visibility": "draft",
    }
    r = requests.post(f"{API}/hi/community/content", headers=_uh(user_token), json=body, timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert "personal_information" in j["pre_checks"]["flags"]
    assert "unsafe_high_risk" in j["pre_checks"]["flags"]
    assert j["pre_checks"]["safety_classification"] == "high_risk"
    assert j["pre_checks"]["requires_enhanced_review"] is True
    return j["content"]["id"]


# --------------------------------------------------------------- submit: safety_sensitive -> reviewing
def test_submit_high_risk_goes_to_reviewing(user_token, high_risk_content_id):
    r = requests.post(f"{API}/hi/community/content/{high_risk_content_id}/submit",
                      headers=_uh(user_token), json={"visibility": "anonymous_community"}, timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["moderation_status"] == "reviewing"
    assert j["requires_enhanced_review"] is True


# --------------------------------------------------------------- submit: clean -> submitted
@pytest.fixture(scope="module")
def clean_submitted_id(user_token):
    body = {
        "content_type": "CommunityTip",
        "title": f"TEST_lesson {uuid.uuid4().hex[:6]}",
        "body": "Painted a bedroom this weekend. Rolling in a W pattern and cutting in with a 2 inch brush worked great.",
        "category": "Painting",
        "visibility": "draft",
    }
    r = requests.post(f"{API}/hi/community/content", headers=_uh(user_token), json=body, timeout=30)
    cid = r.json()["content"]["id"]
    s = requests.post(f"{API}/hi/community/content/{cid}/submit",
                     headers=_uh(user_token), json={"visibility": "anonymous_community"}, timeout=30)
    assert s.status_code == 200, s.text
    assert s.json()["moderation_status"] == "submitted"
    return cid


def test_submit_requires_public_visibility(user_token):
    body = {"content_type": "CommunityTip", "title": f"TEST_v {uuid.uuid4().hex[:6]}",
            "body": "Some helpful details about weather sealing my windows last fall.",
            "category": "Maintenance", "visibility": "draft"}
    r = requests.post(f"{API}/hi/community/content", headers=_uh(user_token), json=body, timeout=30)
    cid = r.json()["content"]["id"]
    bad = requests.post(f"{API}/hi/community/content/{cid}/submit",
                       headers=_uh(user_token), json={"visibility": "private"}, timeout=30)
    assert bad.status_code == 400


# --------------------------------------------------------------- mine / update / delete
def test_mine_lists_own_content(user_token, clean_submitted_id):
    r = requests.get(f"{API}/hi/community/content/mine", headers=_uh(user_token), timeout=30)
    assert r.status_code == 200
    ids = [c["id"] for c in r.json()["content"]]
    assert clean_submitted_id in ids


def test_update_and_delete(user_token):
    body = {"content_type": "CommunityTip", "title": f"TEST_u {uuid.uuid4().hex[:6]}",
            "body": "Some content for updating and deleting testing purposes.",
            "category": "Tools", "visibility": "draft"}
    cid = requests.post(f"{API}/hi/community/content", headers=_uh(user_token), json=body, timeout=30).json()["content"]["id"]
    u = requests.put(f"{API}/hi/community/content/{cid}", headers=_uh(user_token),
                     json={"title": "TEST_updated title"}, timeout=30)
    assert u.status_code == 200
    d = requests.delete(f"{API}/hi/community/content/{cid}", headers=_uh(user_token), timeout=30)
    assert d.status_code == 200


# --------------------------------------------------------------- admin flow
def test_admin_dashboard_and_queue(admin_token, clean_submitted_id, high_risk_content_id):
    r = requests.get(f"{API}/hi/admin/community/dashboard", headers=_uh(admin_token), timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert "by_status" in j and j["queue_size"] >= 1
    q = requests.get(f"{API}/hi/admin/community/queue", headers=_uh(admin_token), timeout=30)
    assert q.status_code == 200
    ids = [c["id"] for c in q.json()["queue"]]
    assert clean_submitted_id in ids
    assert high_risk_content_id in ids


@pytest.fixture(scope="module")
def approved_id(admin_token, clean_submitted_id):
    r = requests.post(f"{API}/hi/admin/community/content/{clean_submitted_id}/decision",
                      headers=_uh(admin_token), json={"decision": "approve"}, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["moderation_status"] == "approved"
    return clean_submitted_id


def test_approved_appears_in_feed(user_token, approved_id):
    r = requests.get(f"{API}/hi/community/feed", headers=_uh(user_token), timeout=30)
    assert r.status_code == 200
    ids = [c["id"] for c in r.json()["content"]]
    assert approved_id in ids


def test_request_changes_moves_to_draft(user_token, admin_token):
    body = {"content_type": "CommunityTip", "title": f"TEST_rc {uuid.uuid4().hex[:6]}",
            "body": "Change-request test body content long enough to pass length check.",
            "category": "Maintenance", "visibility": "draft"}
    cid = requests.post(f"{API}/hi/community/content", headers=_uh(user_token), json=body, timeout=30).json()["content"]["id"]
    requests.post(f"{API}/hi/community/content/{cid}/submit", headers=_uh(user_token),
                  json={"visibility": "anonymous_community"}, timeout=30)
    d = requests.post(f"{API}/hi/admin/community/content/{cid}/decision", headers=_uh(admin_token),
                      json={"decision": "request_changes"}, timeout=30)
    assert d.status_code == 200
    assert d.json()["moderation_status"] == "draft"


# --------------------------------------------------------------- vote / save
def test_vote_helpful(user_token, approved_id):
    r = requests.post(f"{API}/hi/community/content/{approved_id}/vote",
                      headers=_uh(user_token), json={"vote_type": "helpful"}, timeout=30)
    assert r.status_code == 200
    assert r.json()["helpful_count"] >= 1
    # second identical vote no-ops
    r2 = requests.post(f"{API}/hi/community/content/{approved_id}/vote",
                       headers=_uh(user_token), json={"vote_type": "helpful"}, timeout=30)
    assert r2.status_code == 200
    assert r2.json()["helpful_count"] == r.json()["helpful_count"]


def test_save_unsave_list(user_token, approved_id):
    s = requests.post(f"{API}/hi/community/content/{approved_id}/save", headers=_uh(user_token), timeout=30)
    assert s.status_code == 200
    lst = requests.get(f"{API}/hi/community/saved", headers=_uh(user_token), timeout=30)
    assert lst.status_code == 200
    assert approved_id in [c["id"] for c in lst.json()["content"]]
    u = requests.delete(f"{API}/hi/community/content/{approved_id}/save", headers=_uh(user_token), timeout=30)
    assert u.status_code == 200


# --------------------------------------------------------------- report
def test_report_content(user_token, approved_id):
    r = requests.post(f"{API}/hi/community/content/{approved_id}/report",
                      headers=_uh(user_token), json={"report_reason": "inaccurate", "description": "TEST_report"}, timeout=30)
    assert r.status_code == 200
    assert r.json()["ok"] is True


# --------------------------------------------------------------- comments (blocked in high-risk categories)
def test_comment_on_approved_normal(user_token, approved_id):
    r = requests.post(f"{API}/hi/community/content/{approved_id}/comments",
                      headers=_uh(user_token), json={"body": "Thanks — very helpful!"}, timeout=30)
    assert r.status_code == 200
    # clean comments should auto-approve
    assert r.json()["comment"]["moderation_status"] in ("approved", "submitted")


def test_comments_blocked_in_high_risk(user_token, admin_token, high_risk_content_id):
    # approve high-risk item to allow attempted comment
    requests.post(f"{API}/hi/admin/community/content/{high_risk_content_id}/decision",
                  headers=_uh(admin_token), json={"decision": "approve"}, timeout=30)
    r = requests.post(f"{API}/hi/community/content/{high_risk_content_id}/comments",
                      headers=_uh(user_token), json={"body": "Cool tip"}, timeout=30)
    assert r.status_code == 409


# --------------------------------------------------------------- draft-assist
def test_draft_assist_returns_sensitive_info(user_token):
    r = requests.post(f"{API}/hi/community/draft-assist", headers=_uh(user_token),
                      json={"raw_notes": "Fixed a leaky trap under the kitchen sink. Call me at 555-333-9999 for questions."},
                      timeout=60)
    assert r.status_code == 200
    d = r.json()["draft"]
    assert "sensitive_info_found" in d
    assert isinstance(d["sensitive_info_found"], list)
    # our deterministic PII check should have added a note
    assert any("personal info" in s.lower() for s in d["sensitive_info_found"])


# --------------------------------------------------------------- admin: reports / settings / audit
def test_admin_reports_endpoint(admin_token):
    r = requests.get(f"{API}/hi/admin/community/reports?status=open", headers=_uh(admin_token), timeout=30)
    assert r.status_code == 200
    assert "reports" in r.json()


def test_admin_settings_get_and_toggle(admin_token):
    g = requests.get(f"{API}/hi/admin/community/settings", headers=_uh(admin_token), timeout=30)
    assert g.status_code == 200
    p = requests.put(f"{API}/hi/admin/community/settings", headers=_uh(admin_token),
                     json={"comments_in_high_risk_enabled": True}, timeout=30)
    assert p.status_code == 200
    assert p.json()["comments_in_high_risk_enabled"] is True
    # restore
    requests.put(f"{API}/hi/admin/community/settings", headers=_uh(admin_token),
                 json={"comments_in_high_risk_enabled": False}, timeout=30)


def test_admin_audit_logs_decision(admin_token, approved_id):
    r = requests.get(f"{API}/hi/admin/community/audit", headers=_uh(admin_token), timeout=30)
    assert r.status_code == 200
    ids = [d["community_content_id"] for d in r.json()["decisions"]]
    assert approved_id in ids


# --------------------------------------------------------------- regression: voice admin dashboard still works
def test_voice_admin_dashboard_regression(admin_token):
    r = requests.get(f"{API}/hi/admin/voice/dashboard", headers=_uh(admin_token), timeout=30)
    assert r.status_code == 200
    j = r.json()
    assert "settings" in j
