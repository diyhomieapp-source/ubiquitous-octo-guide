"""Backend tests for Info Sheet #65 — Integration App Store."""
import os
import pytest
import requests
from pathlib import Path


def _load_base_url() -> str:
    env = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
    if env:
        return env.rstrip("/")
    p = Path("/app/frontend/.env")
    for line in p.read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    raise RuntimeError("No backend URL configured")


BASE_URL = _load_base_url()
DEMO = {"email": "demo_home@diyhomie.com", "password": "Test1234"}
ADMIN = {"email": "Diyhomieapp@gmail.com", "password": "diyhomie1122"}


@pytest.fixture(scope="module")
def demo_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=DEMO, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


# ---------- browse / detail ----------
class TestBrowse:
    def test_browse_lists_seeded_integrations(self, demo_token):
        r = requests.get(f"{BASE_URL}/api/appstore", headers=_h(demo_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d.get("integrations"), list)
        assert isinstance(d.get("categories"), list)
        assert len(d["integrations"]) >= 5
        slugs = {i["slug"] for i in d["integrations"]}
        for expected in ["nws-weather-alerts", "energy-tracker", "advanced-analytics",
                          "pro-scheduling", "insurance-sync"]:
            assert expected in slugs, f"missing seeded slug {expected}"
        for i in d["integrations"]:
            assert "installed" in i
            assert isinstance(i["installed"], bool)

    def test_detail_returns_capabilities_scopes_pricing(self, demo_token):
        r = requests.get(f"{BASE_URL}/api/appstore/step-by-step-diy",
                          headers=_h(demo_token), timeout=30)
        # 'step-by-step-diy' is not a seeded slug -> should 404
        assert r.status_code == 404

    def test_detail_valid_slug(self, demo_token):
        r = requests.get(f"{BASE_URL}/api/appstore/nws-weather-alerts",
                          headers=_h(demo_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["slug"] == "nws-weather-alerts"
        assert isinstance(d.get("capabilities"), list) and len(d["capabilities"]) > 0
        assert isinstance(d.get("scopes"), list) and len(d["scopes"]) > 0
        assert d.get("pricing") in ("free", "paid")
        assert "installed" in d


# ---------- install / installed / uninstall lifecycle ----------
class TestInstallLifecycle:
    SLUG = "energy-tracker"

    def test_a_clean_pre_state(self, demo_token):
        # ensure not installed at start
        r = requests.post(f"{BASE_URL}/api/appstore/{self.SLUG}/uninstall",
                           headers=_h(demo_token), timeout=30)
        assert r.status_code in (200, 404)

    def test_b_install_first_time(self, demo_token):
        r = requests.post(f"{BASE_URL}/api/appstore/{self.SLUG}/install",
                           headers=_h(demo_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["ok"] is True
        assert d["existing"] is False

    def test_c_install_idempotent(self, demo_token):
        r = requests.post(f"{BASE_URL}/api/appstore/{self.SLUG}/install",
                           headers=_h(demo_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["existing"] is True

    def test_d_installed_list_contains(self, demo_token):
        r = requests.get(f"{BASE_URL}/api/appstore/installed",
                          headers=_h(demo_token), timeout=30)
        assert r.status_code == 200
        slugs = {row["integration"]["slug"] for row in r.json()["installed"]}
        assert self.SLUG in slugs

    def test_e_browse_reflects_installed_flag(self, demo_token):
        r = requests.get(f"{BASE_URL}/api/appstore", headers=_h(demo_token), timeout=30)
        row = next(i for i in r.json()["integrations"] if i["slug"] == self.SLUG)
        assert row["installed"] is True

    def test_f_uninstall(self, demo_token):
        r = requests.post(f"{BASE_URL}/api/appstore/{self.SLUG}/uninstall",
                           headers=_h(demo_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_g_installed_list_no_longer_contains(self, demo_token):
        r = requests.get(f"{BASE_URL}/api/appstore/installed",
                          headers=_h(demo_token), timeout=30)
        slugs = {row["integration"]["slug"] for row in r.json()["installed"]}
        assert self.SLUG not in slugs

    def test_h_uninstall_when_not_installed_returns_404(self, demo_token):
        r = requests.post(f"{BASE_URL}/api/appstore/{self.SLUG}/uninstall",
                           headers=_h(demo_token), timeout=30)
        assert r.status_code == 404


# ---------- admin routes ----------
class TestAdmin:
    def test_list_all_has_install_counts(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/appstore",
                          headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d.get("integrations"), list) and len(d["integrations"]) >= 5
        for row in d["integrations"]:
            assert "installs" in row and isinstance(row["installs"], int)
            assert "status" in row

    def test_analytics_shape(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/appstore/analytics",
                          headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("total", "published", "active_installs", "paid_installs", "by_integration"):
            assert k in d
        assert isinstance(d["by_integration"], list)
        assert d["total"] >= 5

    def test_toggle_published_state(self, admin_token):
        rl = requests.get(f"{BASE_URL}/api/admin/appstore",
                           headers=_h(admin_token), timeout=30).json()
        target = next(i for i in rl["integrations"] if i["slug"] == "insurance-sync")
        original = target["status"]
        r1 = requests.post(f"{BASE_URL}/api/admin/appstore/{target['id']}/toggle",
                            headers=_h(admin_token), timeout=30)
        assert r1.status_code == 200
        new_status = r1.json()["status"]
        assert new_status != original
        # flip back
        r2 = requests.post(f"{BASE_URL}/api/admin/appstore/{target['id']}/toggle",
                            headers=_h(admin_token), timeout=30)
        assert r2.status_code == 200
        assert r2.json()["status"] == original

    def test_non_admin_forbidden(self, demo_token):
        r = requests.get(f"{BASE_URL}/api/admin/appstore",
                          headers=_h(demo_token), timeout=30)
        assert r.status_code == 403
        r2 = requests.get(f"{BASE_URL}/api/admin/appstore/analytics",
                           headers=_h(demo_token), timeout=30)
        assert r2.status_code == 403


# ---------- regression ----------
class TestRegression:
    def test_education_tracks_still_seed_three(self, demo_token):
        r = requests.get(f"{BASE_URL}/api/education/tracks",
                          headers=_h(demo_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        tracks = d.get("tracks", d if isinstance(d, list) else [])
        assert len(tracks) == 3, f"expected 3 education tracks got {len(tracks)}"
