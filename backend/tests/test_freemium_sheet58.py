"""Sheet #58 — Subscription Free Trial, Demo Mode & Freemium Conversion Engine.
Also covers the NEW DELETE /api/projects/{project_id} endpoint.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://step-by-step-diy.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEMO = {"email": "demo_home@diyhomie.com", "password": "Test1234"}
ADMIN = {"email": "Diyhomieapp@gmail.com", "password": "diyhomie1122"}


def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    j = r.json()
    return j.get("access_token") or j.get("token")


@pytest.fixture(scope="module")
def demo_headers():
    return {"Authorization": f"Bearer {_login(DEMO['email'], DEMO['password'])}"}


@pytest.fixture(scope="module")
def admin_headers():
    return {"Authorization": f"Bearer {_login(ADMIN['email'], ADMIN['password'])}"}


# -------- entitlements --------
class TestEntitlements:
    def test_entitlements_me_shape(self, demo_headers):
        r = requests.get(f"{API}/entitlements/me", headers=demo_headers, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("plan", "is_paid", "caps", "usage", "remaining", "trial_days_left", "upgrade_cta", "price_label"):
            assert k in d, f"missing key {k}"
        assert d["plan"] in ("free", "pro")
        for k in ("scans", "guides", "saved_projects"):
            assert k in d["caps"], f"missing caps.{k}"
            assert k in d["remaining"], f"missing remaining.{k}"
        for k in ("scans", "guides", "saved_projects"):
            assert isinstance(d["remaining"][k], int)
        assert isinstance(d["upgrade_cta"], str) and len(d["upgrade_cta"]) > 0
        assert isinstance(d["price_label"], str) and len(d["price_label"]) > 0

    def test_consume_scan_and_guide_decrements(self, demo_headers):
        # snapshot before
        before = requests.get(f"{API}/entitlements/me", headers=demo_headers, timeout=15).json()
        for feat in ("scan", "guide"):
            key = feat + "s"
            remaining_before = before["remaining"][key]
            r = requests.post(f"{API}/entitlements/consume", headers=demo_headers, json={"feature": feat}, timeout=15)
            assert r.status_code == 200, r.text
            body = r.json()
            # Either paid=unlimited, or free plan returning ok/remaining, or locked
            if body.get("unlimited"):
                pytest.skip("demo user is paid; freemium caps do not apply")
            if body.get("ok"):
                assert "remaining" in body
                # remaining should be one less than before (unless already at 0 -> locked path)
                assert body["remaining"] == max(0, remaining_before - 1)
            else:
                # locked path — must include upgrade_cta
                assert body.get("locked") is True
                assert "upgrade_cta" in body

    def test_consume_lock_when_cap_reached(self, demo_headers, admin_headers):
        # Force a low cap so we can hit lock without consuming forever
        cfg_before = requests.get(f"{API}/admin/freemium/config", headers=admin_headers, timeout=15).json()
        low_cfg = {**cfg_before, "free_scans": 0, "free_guides": 0}
        try:
            put = requests.put(f"{API}/admin/freemium/config", headers=admin_headers, json=low_cfg, timeout=15)
            assert put.status_code == 200
            for feat in ("scan", "guide"):
                r = requests.post(f"{API}/entitlements/consume", headers=demo_headers, json={"feature": feat}, timeout=15)
                assert r.status_code == 200
                body = r.json()
                if body.get("unlimited"):
                    pytest.skip("demo user is paid")
                assert body.get("ok") is False
                assert body.get("locked") is True
                assert "upgrade_cta" in body and "price_label" in body
        finally:
            # restore original config
            restore_payload = {k: cfg_before[k] for k in ("free_scans", "free_guides", "free_saved_projects", "trial_days", "upgrade_cta", "price_label")}
            r = requests.put(f"{API}/admin/freemium/config", headers=admin_headers, json=restore_payload, timeout=15)
            assert r.status_code == 200

    def test_consume_invalid_feature(self, demo_headers):
        r = requests.post(f"{API}/entitlements/consume", headers=demo_headers, json={"feature": "widgets"}, timeout=15)
        assert r.status_code == 400


# -------- demo sandbox --------
class TestDemo:
    def test_demo_templates(self, demo_headers):
        r = requests.get(f"{API}/demo/templates", headers=demo_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "templates" in d and isinstance(d["templates"], list) and len(d["templates"]) >= 1
        slugs = [t["slug"] for t in d["templates"]]
        assert "demo-kitchen-remodel" in slugs
        for t in d["templates"]:
            for k in ("slug", "name", "icon", "tagline", "step_count"):
                assert k in t

    def test_demo_start_idempotent(self, demo_headers):
        slug = "demo-kitchen-remodel"
        r1 = requests.post(f"{API}/demo/start/{slug}", headers=demo_headers, timeout=20)
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert d1.get("project_id")
        # Second call should return existing:true with same project_id
        r2 = requests.post(f"{API}/demo/start/{slug}", headers=demo_headers, timeout=20)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2.get("existing") is True
        assert d2["project_id"] == d1["project_id"]

    def test_demo_start_unknown(self, demo_headers):
        r = requests.post(f"{API}/demo/start/does-not-exist-xyz", headers=demo_headers, timeout=15)
        assert r.status_code == 404

    def test_demo_commit_converts_to_real(self, demo_headers):
        # Start (or reuse existing) demo project
        slug = "demo-fence-build"
        start = requests.post(f"{API}/demo/start/{slug}", headers=demo_headers, timeout=20)
        assert start.status_code == 200
        project_id = start.json()["project_id"]

        commit = requests.post(f"{API}/demo/commit/{project_id}", headers=demo_headers, timeout=15)
        assert commit.status_code == 200
        assert commit.json().get("ok") is True

        # Committing again should 404 (no longer demo)
        again = requests.post(f"{API}/demo/commit/{project_id}", headers=demo_headers, timeout=15)
        assert again.status_code == 404

        # Cleanup: delete converted project via new DELETE endpoint
        d = requests.delete(f"{API}/projects/{project_id}", headers=demo_headers, timeout=15)
        assert d.status_code == 200

    def test_demo_commit_unknown_id(self, demo_headers):
        r = requests.post(f"{API}/demo/commit/nonexistent-project-abc123", headers=demo_headers, timeout=15)
        assert r.status_code == 404


# -------- conversion events --------
class TestConversion:
    @pytest.mark.parametrize("ev", ["demo_start", "cta_view", "cta_click"])
    def test_event_logged(self, demo_headers, ev):
        r = requests.post(f"{API}/conversion/event", headers=demo_headers, json={"event": ev, "meta": {"where": "test"}}, timeout=15)
        assert r.status_code == 200
        assert r.json().get("ok") is True


# -------- admin freemium controls --------
class TestAdminFreemium:
    def test_config_get(self, admin_headers):
        r = requests.get(f"{API}/admin/freemium/config", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ("free_scans", "free_guides", "free_saved_projects", "trial_days", "upgrade_cta", "price_label"):
            assert k in d

    def test_config_put_roundtrip(self, admin_headers):
        cfg_before = requests.get(f"{API}/admin/freemium/config", headers=admin_headers, timeout=15).json()
        try:
            new_cfg = {**cfg_before, "free_scans": 7, "free_guides": 5, "free_saved_projects": 4, "trial_days": 21,
                        "upgrade_cta": "TEST_ Sheet58 CTA copy", "price_label": "$9/mo"}
            payload = {k: new_cfg[k] for k in ("free_scans", "free_guides", "free_saved_projects", "trial_days", "upgrade_cta", "price_label")}
            put = requests.put(f"{API}/admin/freemium/config", headers=admin_headers, json=payload, timeout=15)
            assert put.status_code == 200
            got = requests.get(f"{API}/admin/freemium/config", headers=admin_headers, timeout=15).json()
            assert got["free_scans"] == 7
            assert got["trial_days"] == 21
            assert got["upgrade_cta"] == "TEST_ Sheet58 CTA copy"
        finally:
            restore = {k: cfg_before[k] for k in ("free_scans", "free_guides", "free_saved_projects", "trial_days", "upgrade_cta", "price_label")}
            r = requests.put(f"{API}/admin/freemium/config", headers=admin_headers, json=restore, timeout=15)
            assert r.status_code == 200

    def test_config_non_admin_forbidden(self, demo_headers):
        r = requests.get(f"{API}/admin/freemium/config", headers=demo_headers, timeout=15)
        assert r.status_code in (401, 403)

    def test_analytics(self, admin_headers):
        r = requests.get(f"{API}/admin/freemium/analytics", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "totals" in d and "funnel" in d
        for k in ("users", "paid", "conversion_pct", "demo_started", "demo_committed", "cta_views", "cta_clicks", "cta_ctr"):
            assert k in d["totals"], f"missing totals.{k}"
        assert isinstance(d["funnel"], list) and len(d["funnel"]) == 5
        stages = [f["stage"] for f in d["funnel"]]
        for want in ("Signed up", "Tried a demo", "Committed demo → real", "Has a real project", "Upgraded to paid"):
            assert want in stages, f"missing funnel stage: {want}"


# -------- NEW: DELETE /api/projects/{id} --------
class TestDeleteProject:
    def test_owner_can_delete_and_timeline_cleared(self, demo_headers):
        # Create a project
        create = requests.post(f"{API}/projects", headers=demo_headers, json={"title": "TEST_ delete me", "location": "Kitchen"}, timeout=15)
        assert create.status_code == 200
        pid = create.json()["id"]

        # Delete
        d = requests.delete(f"{API}/projects/{pid}", headers=demo_headers, timeout=15)
        assert d.status_code == 200, d.text
        body = d.json()
        assert body.get("ok") is True
        assert body.get("deleted") == pid

        # GET listing should not include it
        listing = requests.get(f"{API}/projects", headers=demo_headers, timeout=15).json()
        ids = [p["id"] for p in listing]
        assert pid not in ids

        # Deleting again returns 404
        again = requests.delete(f"{API}/projects/{pid}", headers=demo_headers, timeout=15)
        assert again.status_code == 404

    def test_delete_unknown_returns_404(self, demo_headers):
        r = requests.delete(f"{API}/projects/does-not-exist-xyz-123", headers=demo_headers, timeout=15)
        assert r.status_code == 404

    def test_delete_project_owned_by_other_user_returns_404(self, demo_headers, admin_headers):
        # Admin creates a project (owned by admin)
        create = requests.post(f"{API}/projects", headers=admin_headers, json={"title": "TEST_ admin-owned", "location": "Attic"}, timeout=15)
        assert create.status_code == 200
        pid = create.json()["id"]
        try:
            # demo user tries to delete admin's project -> should 404
            r = requests.delete(f"{API}/projects/{pid}", headers=demo_headers, timeout=15)
            assert r.status_code == 404
            # Verify project still exists for admin
            listing = requests.get(f"{API}/projects", headers=admin_headers, timeout=15).json()
            ids = [p["id"] for p in listing]
            assert pid in ids
        finally:
            requests.delete(f"{API}/projects/{pid}", headers=admin_headers, timeout=15)
