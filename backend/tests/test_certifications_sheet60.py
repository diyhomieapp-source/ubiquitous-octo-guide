"""
Info Sheet #60 — DIYhomie Verified (Certification & Lifetime Credentialing) backend tests.
Covers: user status/list/eligible/generate/share, public verify JSON+HTML, admin list/analytics/revoke/reinstate/validate,
non-admin 403, and auto-issuance on project completion.
"""
import os
import time
import pytest
import requests

def _resolve_base_url():
    url = os.environ.get("EXPO_BACKEND_URL", "").strip().rstrip("/")
    if url:
        return url
    try:
        for line in open("/app/frontend/.env").read().splitlines():
            if line.startswith("EXPO_PUBLIC_BACKEND_URL=") or line.startswith("EXPO_BACKEND_URL="):
                return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    except FileNotFoundError:
        pass
    return ""


BASE_URL = _resolve_base_url()
assert BASE_URL, "BASE_URL is empty — set EXPO_BACKEND_URL or EXPO_PUBLIC_BACKEND_URL"

DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASSWORD = __import__("os").environ.get("TEST_USER_PASSWORD", "")
ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASSWORD = __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")


# --------------------------------------------------------------------- fixtures
@pytest.fixture(scope="module")
def demo_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=20)
    assert r.status_code == 200, f"demo login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=20)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# --------------------------------------------------------------------- user endpoints
class TestUserCertifications:
    def test_certifications_shape(self, demo_token):
        r = requests.get(f"{BASE_URL}/api/certifications", headers=_h(demo_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "status" in d and "certificates" in d
        s = d["status"]
        for k in ("level", "label", "active", "total", "is_verified", "to_next"):
            assert k in s, f"missing status.{k}"
        assert s["level"] in ("unverified", "verified", "advanced", "master")
        assert isinstance(d["certificates"], list)

    def test_eligible_shape(self, demo_token):
        r = requests.get(f"{BASE_URL}/api/certifications/eligible", headers=_h(demo_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "eligible" in d and isinstance(d["eligible"], list)
        for e in d["eligible"]:
            assert "project_id" in e and "title" in e

    def test_generate_and_idempotent(self, demo_token):
        # find an eligible project
        r = requests.get(f"{BASE_URL}/api/certifications/eligible", headers=_h(demo_token), timeout=15)
        elig = r.json().get("eligible", [])
        if not elig:
            pytest.skip("no eligible project to certify")
        pid = elig[0]["project_id"]
        r1 = requests.post(f"{BASE_URL}/api/certifications/generate",
                           headers=_h(demo_token), json={"project_id": pid}, timeout=20)
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert "certificate" in d1 and d1["certificate"]["id"]
        # idempotent — calling again returns existing
        r2 = requests.post(f"{BASE_URL}/api/certifications/generate",
                           headers=_h(demo_token), json={"project_id": pid}, timeout=20)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2.get("existing") is True
        assert d2["certificate"]["id"] == d1["certificate"]["id"]

    def test_generate_404_for_non_completed(self, demo_token):
        r = requests.post(f"{BASE_URL}/api/certifications/generate",
                          headers=_h(demo_token), json={"project_id": "NOPE_NOT_A_PROJECT"}, timeout=15)
        assert r.status_code == 404

    def test_share_returns_token_and_url_and_reuses(self, demo_token):
        r = requests.get(f"{BASE_URL}/api/certifications", headers=_h(demo_token), timeout=15)
        certs = r.json().get("certificates", [])
        active = [c for c in certs if c["status"] == "active"]
        if not active:
            pytest.skip("no active certificate to share")
        cid = active[0]["id"]
        s1 = requests.post(f"{BASE_URL}/api/certifications/{cid}/share",
                           headers=_h(demo_token), timeout=15)
        assert s1.status_code == 200, s1.text
        d1 = s1.json()
        assert d1["token"].startswith("cert_")
        assert d1["url"].endswith(d1["token"])
        s2 = requests.post(f"{BASE_URL}/api/certifications/{cid}/share",
                           headers=_h(demo_token), timeout=15)
        assert s2.status_code == 200
        assert s2.json()["token"] == d1["token"], "share token should be reused"


# --------------------------------------------------------------------- public verify
class TestPublicVerify:
    def test_verify_json(self, demo_token):
        r = requests.get(f"{BASE_URL}/api/certifications", headers=_h(demo_token), timeout=15)
        certs = [c for c in r.json().get("certificates", []) if c["status"] == "active" and c.get("share_token")]
        if not certs:
            pytest.skip("no shared cert available")
        token = certs[0]["share_token"]
        rj = requests.get(f"{BASE_URL}/api/certifications/verify/{token}?format=json", timeout=15)
        assert rj.status_code == 200
        j = rj.json()
        for k in ("valid", "status", "title", "holder", "code_compliant", "pro_validated", "certificate_id"):
            assert k in j
        assert j["valid"] is True and j["status"] == "active"

    def test_verify_html(self, demo_token):
        r = requests.get(f"{BASE_URL}/api/certifications", headers=_h(demo_token), timeout=15)
        certs = [c for c in r.json().get("certificates", []) if c.get("share_token")]
        if not certs:
            pytest.skip("no shared cert available")
        token = certs[0]["share_token"]
        rh = requests.get(f"{BASE_URL}/api/certifications/verify/{token}", timeout=15)
        assert rh.status_code == 200
        assert "text/html" in rh.headers.get("content-type", "")
        assert "DIYhomie" in rh.text

    def test_verify_not_found(self):
        rj = requests.get(f"{BASE_URL}/api/certifications/verify/cert_doesnotexist?format=json", timeout=15)
        assert rj.status_code == 404
        assert rj.json().get("valid") is False


# --------------------------------------------------------------------- auto-issuance
class TestAutoIssuance:
    def test_auto_issue_on_project_complete(self, demo_token):
        # 1. Create a fresh project via /api/projects
        payload = {
            "title": "TEST_Sheet60 auto-cert project",
            "room": "living_room",
            "difficulty": "easy",
            "steps": [{"title": "Step 1", "description": "desc"}],
        }
        cp = requests.post(f"{BASE_URL}/api/projects", headers=_h(demo_token), json=payload, timeout=20)
        if cp.status_code not in (200, 201):
            pytest.skip(f"cannot create project: {cp.status_code} {cp.text[:200]}")
        proj = cp.json()
        pid = proj.get("id") or proj.get("project_id")
        assert pid, f"no project id in {proj}"

        # 2. Complete it via POST /api/projects/{id}/complete
        complete_payload = {"story": "TEST_Sheet60 auto-cert done", "hours": 2,
                            "money_saved_cents": 1500, "story_title": "TEST_Sheet60 auto-cert"}
        comp = requests.post(f"{BASE_URL}/api/projects/{pid}/complete",
                             headers=_h(demo_token), json=complete_payload, timeout=25)
        assert comp.status_code in (200, 201), f"complete failed: {comp.status_code} {comp.text[:200]}"

        # 3. GET /api/certifications and check a cert for that project exists
        time.sleep(1)
        certs = requests.get(f"{BASE_URL}/api/certifications", headers=_h(demo_token), timeout=15).json()["certificates"]
        match = [c for c in certs if c.get("project_id") == pid and c["kind"] == "project_completion"]
        assert match, f"no auto-issued cert for project {pid}"


# --------------------------------------------------------------------- admin endpoints
class TestAdminCertifications:
    def test_admin_list(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/certifications", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert "certificates" in d and "total" in d
        assert isinstance(d["certificates"], list)

    def test_admin_list_filters(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/certifications?status=active&q=TEST",
                         headers=_h(admin_token), timeout=20)
        assert r.status_code == 200

    def test_admin_analytics(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/certifications/analytics",
                         headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        d = r.json()
        for k in ("total", "active", "revoked", "shared", "tiers", "by_room", "verified_users"):
            assert k in d, f"missing analytics.{k}"
        for t in ("verified", "advanced", "master"):
            assert t in d["tiers"]

    def test_admin_validate_revoke_reinstate_flow(self, admin_token, demo_token):
        # Get an active cert for demo_home from admin list
        r = requests.get(f"{BASE_URL}/api/admin/certifications?status=active",
                         headers=_h(admin_token), timeout=20)
        certs = [c for c in r.json()["certificates"] if c["user_name"] and c["title"]]
        # find one owned by demo (title case-insensitive filter — any active is fine)
        if not certs:
            pytest.skip("no active certificate to run admin flow on")
        cid = certs[0]["id"]

        # validate → pro_validated=True on user side
        v = requests.post(f"{BASE_URL}/api/admin/certifications/{cid}/validate",
                          headers=_h(admin_token), timeout=15)
        assert v.status_code == 200

        # revoke → status becomes revoked
        rv = requests.post(f"{BASE_URL}/api/admin/certifications/{cid}/revoke",
                           headers=_h(admin_token), json={"reason": "TEST_regression"}, timeout=15)
        assert rv.status_code == 200

        # verify token now returns valid:false
        r_list = requests.get(f"{BASE_URL}/api/admin/certifications",
                              headers=_h(admin_token), timeout=15).json()["certificates"]
        this = next((c for c in r_list if c["id"] == cid), None)
        assert this and this["status"] == "revoked"
        if this.get("share_token"):
            vj = requests.get(f"{BASE_URL}/api/certifications/verify/{this['share_token']}?format=json",
                              timeout=15).json()
            assert vj["valid"] is False and vj["status"] == "revoked"

        # reinstate
        rn = requests.post(f"{BASE_URL}/api/admin/certifications/{cid}/reinstate",
                           headers=_h(admin_token), timeout=15)
        assert rn.status_code == 200

        # confirm active again
        r_list2 = requests.get(f"{BASE_URL}/api/admin/certifications",
                               headers=_h(admin_token), timeout=15).json()["certificates"]
        this2 = next((c for c in r_list2 if c["id"] == cid), None)
        assert this2 and this2["status"] == "active"

    def test_non_admin_forbidden(self, demo_token):
        r1 = requests.get(f"{BASE_URL}/api/admin/certifications", headers=_h(demo_token), timeout=15)
        assert r1.status_code == 403
        r2 = requests.get(f"{BASE_URL}/api/admin/certifications/analytics",
                          headers=_h(demo_token), timeout=15)
        assert r2.status_code == 403
