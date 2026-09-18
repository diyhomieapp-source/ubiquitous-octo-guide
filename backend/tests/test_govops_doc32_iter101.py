"""
Doc 32 completion delta tests — /app/backend/governance_ops_engine.py.
Scope: admin Backup/Restore, Deletion Execution, Retention Enforcement.
Also spot-checks existing privacy endpoints still work post-integration.

Safety: deletion execute is called ONLY with an explicit throwaway user_id.
The demo_home user is never touched; we assert it can still log in at the end.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001")).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PW = __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")
DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PW = __import__("os").environ.get("TEST_USER_PASSWORD", "")


def _login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text[:200]}"
    j = r.json()
    return j.get("access_token") or j.get("token")


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


# ------------------------------------------------------------------ fixtures
@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PW)


@pytest.fixture(scope="module")
def demo_token():
    return _login(DEMO_EMAIL, DEMO_PW)


@pytest.fixture(scope="module")
def throwaway():
    """Register a throwaway user for deletion-execute test."""
    email = f"TEST_deluser_{uuid.uuid4().hex[:8]}@diyhomie.com"
    pw = __import__("os").environ.get("TEST_USER_PASSWORD", "") + "!"
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": pw, "name": "Throwaway"}, timeout=30)
    assert r.status_code in (200, 201), f"register: {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token") or r.json().get("token") or _login(email, pw)
    me = requests.get(f"{API}/auth/me", headers=_h(tok), timeout=15).json()
    uid = me.get("id") or me.get("user", {}).get("id")
    assert uid, f"no user id in /auth/me: {me}"
    return {"email": email, "password": pw, "token": tok, "user_id": uid}


# -------------------------------------------------------- AUTH gating
class TestAuthGating:
    """All govops endpoints must reject unauthenticated + non-admin callers."""

    ENDPOINTS = [
        ("POST", "/hi/admin/govops/backups"),
        ("GET", "/hi/admin/govops/backups"),
        ("POST", "/hi/admin/govops/deletions/execute"),
        ("POST", "/hi/admin/govops/retention/enforce"),
    ]

    @pytest.mark.parametrize("method,path", ENDPOINTS)
    def test_no_token_rejected(self, method, path):
        r = requests.request(method, f"{API}{path}", json={}, timeout=15)
        assert r.status_code in (401, 403), f"{method} {path}: {r.status_code}"

    @pytest.mark.parametrize("method,path", ENDPOINTS)
    def test_non_admin_rejected(self, method, path, demo_token):
        r = requests.request(method, f"{API}{path}", json={}, headers=_h(demo_token), timeout=15)
        assert r.status_code in (401, 403), f"{method} {path}: {r.status_code}"


# -------------------------------------------------------- BACKUPS
class TestBackups:
    backup_id = None

    def test_create_backup(self, admin_token):
        r = requests.post(f"{API}/hi/admin/govops/backups",
                          json={"collections": ["hi_projects", "hi_rooms"], "note": "TEST_iter101"},
                          headers=_h(admin_token), timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        body = r.json()
        assert "backup" in body and body["backup"]["status"] == "running"
        assert body["backup"]["collections"] == ["hi_projects", "hi_rooms"]
        TestBackups.backup_id = body["backup"]["id"]

    def test_create_backup_unknown_collection_400(self, admin_token):
        r = requests.post(f"{API}/hi/admin/govops/backups",
                          json={"collections": ["not_a_real_collection_xyz"]},
                          headers=_h(admin_token), timeout=15)
        assert r.status_code == 400, f"{r.status_code} {r.text[:200]}"

    def test_backup_completes(self, admin_token):
        assert TestBackups.backup_id, "backup id not set"
        bid = TestBackups.backup_id
        deadline = time.time() + 45
        row = None
        while time.time() < deadline:
            r = requests.get(f"{API}/hi/admin/govops/backups", headers=_h(admin_token), timeout=15)
            assert r.status_code == 200
            for b in r.json().get("backups", []):
                if b["id"] == bid:
                    row = b
                    break
            if row and row["status"] == "completed":
                break
            time.sleep(2)
        assert row and row["status"] == "completed", f"backup didn't complete: {row}"
        assert row.get("file_present") is True
        assert row.get("size_bytes", 0) > 0
        # detail endpoint has manifest
        d = requests.get(f"{API}/hi/admin/govops/backups/{bid}", headers=_h(admin_token), timeout=15).json()
        m = d["backup"].get("manifest") or {}
        assert set(m.keys()) == {"hi_projects", "hi_rooms"}, f"manifest keys: {list(m.keys())}"

    def test_verify_backup(self, admin_token):
        bid = TestBackups.backup_id
        r = requests.post(f"{API}/hi/admin/govops/backups/{bid}/verify",
                          headers=_h(admin_token), timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        body = r.json()
        assert body["verified"] is True
        assert body["mismatches"] == []

    def test_restore_without_confirm_400(self, admin_token):
        bid = TestBackups.backup_id
        r = requests.post(f"{API}/hi/admin/govops/backups/{bid}/restore",
                          json={"collection": "hi_rooms", "mode": "merge"},
                          headers=_h(admin_token), timeout=15)
        assert r.status_code == 400, f"{r.status_code} {r.text[:200]}"

    def test_restore_unknown_collection_404(self, admin_token):
        bid = TestBackups.backup_id
        r = requests.post(f"{API}/hi/admin/govops/backups/{bid}/restore",
                          json={"collection": "not_in_backup", "confirm": True},
                          headers=_h(admin_token), timeout=15)
        assert r.status_code == 404, f"{r.status_code} {r.text[:200]}"

    def test_restore_merge_safe(self, admin_token):
        """Merge upserts by id — a known room should still exist afterwards."""
        bid = TestBackups.backup_id
        # snapshot a known room id if any
        d = requests.get(f"{API}/hi/admin/govops/backups/{bid}", headers=_h(admin_token), timeout=15).json()
        expected_count = d["backup"]["manifest"].get("hi_rooms", 0)
        r = requests.post(f"{API}/hi/admin/govops/backups/{bid}/restore",
                          json={"collection": "hi_rooms", "mode": "merge", "confirm": True},
                          headers=_h(admin_token), timeout=60)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        body = r.json()
        assert body["ok"] is True
        assert body["documents_restored"] == expected_count, f"restored {body['documents_restored']} vs manifest {expected_count}"

    def test_delete_backup(self, admin_token):
        bid = TestBackups.backup_id
        r = requests.delete(f"{API}/hi/admin/govops/backups/{bid}", headers=_h(admin_token), timeout=15)
        assert r.status_code == 200 and r.json().get("ok") is True
        # verify list shows file_present false OR removed
        r2 = requests.get(f"{API}/hi/admin/govops/backups", headers=_h(admin_token), timeout=15).json()
        found = [b for b in r2["backups"] if b["id"] == bid]
        assert not found, "deleted backup should not be listed"


# ---------------------------------------------------- DELETION EXECUTION
class TestDeletionExecution:
    def test_full_flow(self, admin_token, demo_token, throwaway):
        uid = throwaway["user_id"]
        tok = throwaway["token"]

        # 1. reauth
        rr = requests.post(f"{API}/hi/privacy/reauth",
                           json={"current_password": throwaway["password"], "action": "account_delete"},
                           headers=_h(tok), timeout=15)
        assert rr.status_code == 200, f"reauth: {rr.status_code} {rr.text[:200]}"
        reauth_tok = rr.json()["reauth_token"]

        # 2. request deletion
        dd = requests.post(f"{API}/hi/privacy/account/deletion",
                           json={"reason": "TEST throwaway"},
                           headers={**_h(tok), "X-Reauth-Token": reauth_tok}, timeout=15)
        assert dd.status_code == 200, f"deletion request: {dd.status_code} {dd.text[:300]}"
        body = dd.json()
        assert body["state"] == "deletion_pending"
        assert len(body["queued_categories"]) > 0

        # 3. dry-run execute
        dry = requests.post(f"{API}/hi/admin/govops/deletions/execute",
                            json={"dry_run": True, "user_id": uid, "ignore_schedule": True},
                            headers=_h(admin_token), timeout=30)
        assert dry.status_code == 200, f"dry: {dry.status_code} {dry.text[:200]}"
        drybody = dry.json()
        assert drybody["dry_run"] is True
        assert drybody["jobs_found"] > 0, f"expected jobs, got {drybody}"
        assert len(drybody["results"]) == 1
        # user must still be able to login (nothing purged yet)
        assert _login(throwaway["email"], throwaway["password"]), "user login broken after dry-run"

        # 4. real execute
        real = requests.post(f"{API}/hi/admin/govops/deletions/execute",
                             json={"dry_run": False, "user_id": uid, "ignore_schedule": True},
                             headers=_h(admin_token), timeout=60)
        assert real.status_code == 200, f"real: {real.status_code} {real.text[:200]}"
        realbody = real.json()
        assert realbody["dry_run"] is False
        assert realbody["jobs_found"] > 0

        # 5. user can no longer login
        bad = requests.post(f"{API}/auth/login",
                            json={"email": throwaway["email"], "password": throwaway["password"]},
                            timeout=15)
        assert bad.status_code in (400, 401, 403, 404), f"deleted user still logs in: {bad.status_code}"

        # 6. demo user completely unaffected
        assert _login(DEMO_EMAIL, DEMO_PW), "demo_home login broke — CRITICAL"


# ------------------------------------------------------------ RETENTION
class TestRetention:
    def test_dry_run(self, admin_token):
        r = requests.post(f"{API}/hi/admin/govops/retention/enforce",
                          json={"dry_run": True}, headers=_h(admin_token), timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        body = r.json()
        assert body["dry_run"] is True
        policies = {a["policy"] for a in body["actions"]}
        assert {"error_telemetry", "expired_share_links", "deleted_user_content"}.issubset(policies), f"missing policies: {policies}"
        assert isinstance(body["total_affected"], int)

    def test_real(self, admin_token):
        r = requests.post(f"{API}/hi/admin/govops/retention/enforce",
                          json={"dry_run": False}, headers=_h(admin_token), timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        body = r.json()
        assert body["dry_run"] is False
        assert isinstance(body["actions"], list) and len(body["actions"]) > 0


# ------------------------------------------------ REGRESSION SPOT-CHECKS
class TestRegression:
    def test_privacy_overview_still_works(self, demo_token):
        r = requests.get(f"{API}/hi/privacy/overview", headers=_h(demo_token), timeout=15)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        assert "account_state" in r.json()

    def test_privacy_export_categories(self, demo_token):
        r = requests.get(f"{API}/hi/privacy/export/categories", headers=_h(demo_token), timeout=15)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
