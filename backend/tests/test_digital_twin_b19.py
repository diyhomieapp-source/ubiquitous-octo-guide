"""
Blueprint 19 — Building Intelligence Capture Platform & Digital Twin Core tests.
Covers /api/hi/twin/* (user) and /api/hi/admin/twin/* (admin) endpoints.
"""
import os
import uuid
import pytest
import requests

def _load_backend_url():
    url = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
    if not url:
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                        url = line.split("=", 1)[1].strip().strip('"')
                        break
        except Exception:
            pass
    return (url or "").rstrip("/")

BASE_URL = _load_backend_url()
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not configured"

USER_EMAIL = "demo_home@diyhomie.com"
USER_PASS = "Test1234"
ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASS = "diyhomie1122"


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def user_token():
    return _login(USER_EMAIL, USER_PASS)


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PASS)


def H(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


# ---------------- Auth guard
def test_twin_overview_requires_auth():
    r = requests.get(f"{BASE_URL}/api/hi/twin/overview", timeout=15)
    assert r.status_code in (401, 403), r.status_code


def test_twin_admin_requires_admin(user_token):
    r = requests.get(f"{BASE_URL}/api/hi/admin/twin/settings", headers=H(user_token), timeout=15)
    assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"


# ---------------- Overview
def test_overview_returns_twin(user_token):
    r = requests.get(f"{BASE_URL}/api/hi/twin/overview", headers=H(user_token), timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "twin" in d and "counts" in d and "sources" in d
    t = d["twin"]
    assert "model_status" in t and "confidence_level" in t
    for k in ("rooms", "connections", "elements", "open_conflicts"):
        assert k in d["counts"]


# ---------------- Capture flow + conflict engine
@pytest.fixture(scope="module")
def capture_ctx(user_token):
    """Create session + room shared across tests."""
    sid_key = f"TEST_{uuid.uuid4()}"
    r = requests.post(f"{BASE_URL}/api/hi/twin/capture-sessions",
                      headers=H(user_token),
                      json={"capture_type": "walkthrough", "idempotency_key": sid_key},
                      timeout=30)
    assert r.status_code == 200, r.text
    sess = r.json()
    sid = sess["id"]
    # add a room
    r2 = requests.post(f"{BASE_URL}/api/hi/twin/capture-sessions/{sid}/rooms",
                       headers=H(user_token),
                       json={"room_type": "Kitchen", "display_name": f"TEST_Kitchen_{uuid.uuid4().hex[:6]}", "area_estimate": 120.0},
                       timeout=30)
    assert r2.status_code == 200, r2.text
    room = r2.json()
    return {"sid": sid, "room_id": room["id"], "label": f"TEST_NorthWall_{uuid.uuid4().hex[:6]}"}


def test_start_capture_session(capture_ctx):
    assert capture_ctx["sid"]


def test_add_room_created(capture_ctx):
    assert capture_ctx["room_id"]


def test_manual_measurement_creates_user_confirmed(user_token, capture_ctx):
    r = requests.post(f"{BASE_URL}/api/hi/twin/capture-sessions/{capture_ctx['sid']}/measurements",
                      headers=H(user_token),
                      json={"dt_room_id": capture_ctx["room_id"], "element_type": "wall",
                            "label": capture_ctx["label"], "value": 10.0, "unit": "feet",
                            "source_status": "manual"},
                      timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["element"]["verification_status"] == "user_confirmed"
    assert d["element"]["observed_value"] == 10.0
    assert d["conflict"] is None


def test_lower_reliability_raises_conflict_preserves_manual(user_token, capture_ctx):
    """Photo-detected value differing from manual value must NOT overwrite; must raise conflict."""
    r = requests.post(f"{BASE_URL}/api/hi/twin/capture-sessions/{capture_ctx['sid']}/measurements",
                      headers=H(user_token),
                      json={"dt_room_id": capture_ctx["room_id"], "element_type": "wall",
                            "label": capture_ctx["label"], "value": 13.0, "unit": "feet",
                            "source_status": "photo_detected"},
                      timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["conflict"] is not None, "expected conflict for lower-reliability differing measurement"
    # element must still hold manual value (10.0)
    assert d["element"]["observed_value"] == 10.0
    assert d["element"]["source_status"] == "manual"
    assert d["element"]["verification_status"] == "user_confirmed"


def test_conflict_listed(user_token, capture_ctx):
    r = requests.get(f"{BASE_URL}/api/hi/twin/conflicts", headers=H(user_token), timeout=30)
    assert r.status_code == 200, r.text
    cs = r.json()["conflicts"]
    # find our label
    ours = [c for c in cs if (c.get("detail") or {}).get("label") == capture_ctx["label"]]
    assert ours, f"conflict for label {capture_ctx['label']} not found"
    capture_ctx["cid"] = ours[0]["id"]
    capture_ctx["subject_id"] = ours[0]["subject_reference"]


def test_resolve_use_new(user_token, capture_ctx):
    cid = capture_ctx["cid"]
    r = requests.post(f"{BASE_URL}/api/hi/twin/conflicts/{cid}/resolve",
                      headers=H(user_token), json={"resolution": "use_new"}, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True


def test_room_context_returns_updated_element(user_token, capture_ctx):
    r = requests.get(f"{BASE_URL}/api/hi/twin/room-context/{capture_ctx['room_id']}",
                     headers=H(user_token), timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["room"]["id"] == capture_ctx["room_id"]
    elems = d["elements"]
    ours = [e for e in elems if e.get("label") == capture_ctx["label"]]
    assert ours
    # After use_new resolve, value should be 13.0
    assert ours[0]["observed_value"] == 13.0
    assert ours[0]["source_status"] == "photo_detected"


def test_additional_resolve_flows(user_token, capture_ctx):
    """Create two more conflicts, resolve one keep_existing/manual/unknown."""
    label = f"TEST_EastWall_{uuid.uuid4().hex[:6]}"
    sid, rid = capture_ctx["sid"], capture_ctx["room_id"]
    # manual 8ft
    r = requests.post(f"{BASE_URL}/api/hi/twin/capture-sessions/{sid}/measurements",
                     headers=H(user_token),
                     json={"dt_room_id": rid, "element_type": "wall", "label": label,
                           "value": 8.0, "unit": "feet", "source_status": "manual"}, timeout=30)
    assert r.status_code == 200
    # photo 11ft
    r = requests.post(f"{BASE_URL}/api/hi/twin/capture-sessions/{sid}/measurements",
                     headers=H(user_token),
                     json={"dt_room_id": rid, "element_type": "wall", "label": label,
                           "value": 11.0, "unit": "feet", "source_status": "photo_detected"}, timeout=30)
    d = r.json()
    assert d["conflict"] is not None
    cid = d["conflict"]["id"]

    # resolve with manual value
    rr = requests.post(f"{BASE_URL}/api/hi/twin/conflicts/{cid}/resolve",
                       headers=H(user_token), json={"resolution": "manual", "manual_value": 9.5}, timeout=30)
    assert rr.status_code == 200
    # verify via room-context
    ctx = requests.get(f"{BASE_URL}/api/hi/twin/room-context/{rid}", headers=H(user_token), timeout=30).json()
    e = [x for x in ctx["elements"] if x["label"] == label][0]
    assert e["observed_value"] == 9.5 and e["source_status"] == "manual"

    # Now create another and keep_existing
    label2 = f"TEST_SouthWall_{uuid.uuid4().hex[:6]}"
    requests.post(f"{BASE_URL}/api/hi/twin/capture-sessions/{sid}/measurements",
                  headers=H(user_token),
                  json={"dt_room_id": rid, "element_type": "wall", "label": label2,
                        "value": 12.0, "unit": "feet", "source_status": "manual"}, timeout=30)
    r2 = requests.post(f"{BASE_URL}/api/hi/twin/capture-sessions/{sid}/measurements",
                       headers=H(user_token),
                       json={"dt_room_id": rid, "element_type": "wall", "label": label2,
                             "value": 15.0, "unit": "feet", "source_status": "photo_detected"}, timeout=30).json()
    cid2 = r2["conflict"]["id"]
    resp = requests.post(f"{BASE_URL}/api/hi/twin/conflicts/{cid2}/resolve",
                         headers=H(user_token), json={"resolution": "keep_existing"}, timeout=30)
    assert resp.status_code == 200
    ctx2 = requests.get(f"{BASE_URL}/api/hi/twin/room-context/{rid}", headers=H(user_token), timeout=30).json()
    e2 = [x for x in ctx2["elements"] if x["label"] == label2][0]
    assert e2["observed_value"] == 12.0

    # Unknown resolution
    label3 = f"TEST_WestWall_{uuid.uuid4().hex[:6]}"
    requests.post(f"{BASE_URL}/api/hi/twin/capture-sessions/{sid}/measurements",
                  headers=H(user_token),
                  json={"dt_room_id": rid, "element_type": "wall", "label": label3,
                        "value": 7.0, "unit": "feet", "source_status": "manual"}, timeout=30)
    r3 = requests.post(f"{BASE_URL}/api/hi/twin/capture-sessions/{sid}/measurements",
                       headers=H(user_token),
                       json={"dt_room_id": rid, "element_type": "wall", "label": label3,
                             "value": 10.0, "unit": "feet", "source_status": "photo_detected"}, timeout=30).json()
    cid3 = r3["conflict"]["id"]
    resp = requests.post(f"{BASE_URL}/api/hi/twin/conflicts/{cid3}/resolve",
                         headers=H(user_token), json={"resolution": "unknown"}, timeout=30)
    assert resp.status_code == 200
    ctx3 = requests.get(f"{BASE_URL}/api/hi/twin/room-context/{rid}", headers=H(user_token), timeout=30).json()
    e3 = [x for x in ctx3["elements"] if x["label"] == label3][0]
    assert e3["verification_status"] == "unverified"


def test_complete_session_reflects_status(user_token, capture_ctx):
    # After above conflicts resolved, complete session should be either completed or ready_for_review
    r = requests.post(f"{BASE_URL}/api/hi/twin/capture-sessions/{capture_ctx['sid']}/complete",
                     headers=H(user_token), timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] in ("completed", "ready_for_review")


# ---------------- Admin endpoints
def test_admin_settings_get(admin_token):
    r = requests.get(f"{BASE_URL}/api/hi/admin/twin/settings", headers=H(admin_token), timeout=30)
    assert r.status_code == 200, r.text
    s = r.json()
    assert "capture_types_enabled" in s and "conflict_threshold" in s


def test_admin_settings_put_toggle_and_threshold(admin_token):
    # Toggle 'photo' capture type off then on, and change threshold
    r = requests.put(f"{BASE_URL}/api/hi/admin/twin/settings",
                     headers=H(admin_token),
                     json={"capture_types_enabled": {"photo": False}, "conflict_threshold": 0.15},
                     timeout=30)
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["capture_types_enabled"]["photo"] is False
    assert abs(s["conflict_threshold"] - 0.15) < 1e-6
    # Restore
    r2 = requests.put(f"{BASE_URL}/api/hi/admin/twin/settings",
                      headers=H(admin_token),
                      json={"capture_types_enabled": {"photo": True}, "conflict_threshold": 0.10},
                      timeout=30)
    assert r2.status_code == 200
    assert r2.json()["capture_types_enabled"]["photo"] is True


def test_admin_metrics(admin_token):
    r = requests.get(f"{BASE_URL}/api/hi/admin/twin/metrics", headers=H(admin_token), timeout=30)
    assert r.status_code == 200, r.text
    m = r.json()
    for k in ("twins", "capture_sessions", "completion_rate", "open_conflicts", "resolved_conflicts",
              "twin_confidence_distribution", "capture_source_distribution"):
        assert k in m


def test_admin_queue(admin_token):
    r = requests.get(f"{BASE_URL}/api/hi/admin/twin/queue", headers=H(admin_token), timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "processing" in d and "failed" in d
