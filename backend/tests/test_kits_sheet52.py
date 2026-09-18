"""Sheet #52 — Smart Home Remodel Kit backend tests"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001")

DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASS = __import__("os").environ.get("TEST_USER_PASSWORD", "")
ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASS = __import__("os").environ.get("TEST_ADMIN_PASSWORD", "")


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    j = r.json()
    return j.get("access_token") or j["token"]


@pytest.fixture(scope="module")
def user_headers():
    return {"Authorization": f"Bearer {_login(DEMO_EMAIL, DEMO_PASS)}"}


@pytest.fixture(scope="module")
def admin_headers():
    return {"Authorization": f"Bearer {_login(ADMIN_EMAIL, ADMIN_PASS)}"}


# ----------------- Public (auth) kit endpoints ------------------
class TestKitsPublic:
    def test_list_kits_seeded(self, user_headers):
        r = requests.get(f"{BASE_URL}/api/kits", headers=user_headers, timeout=30)
        assert r.status_code == 200
        kits = r.json()["kits"]
        slugs = {k["slug"] for k in kits}
        assert len(kits) >= 5, f"expected >=5 seeded kits, got {len(kits)}"
        assert "kitchen-mini-makeover" in slugs
        # card shape
        first = kits[0]
        for f in ("slug", "name", "category", "icon", "difficulty", "est_hours", "component_count", "step_count", "price_from_cents"):
            assert f in first, f"missing field {f}"

    def test_kits_meta(self, user_headers):
        r = requests.get(f"{BASE_URL}/api/kits/meta", headers=user_headers, timeout=30)
        assert r.status_code == 200
        cats = r.json()["categories"]
        assert isinstance(cats, list) and len(cats) >= 5

    def test_kit_detail_and_build(self, user_headers):
        d = requests.get(f"{BASE_URL}/api/kits/kitchen-mini-makeover", headers=user_headers, timeout=30)
        assert d.status_code == 200
        kit = d.json()
        assert kit["slug"] == "kitchen-mini-makeover"
        assert isinstance(kit["components"], list) and len(kit["components"]) > 0
        assert isinstance(kit["steps"], list) and len(kit["steps"]) > 0
        # build manifest with no optional/upsells
        b = requests.post(f"{BASE_URL}/api/kits/kitchen-mini-makeover/build",
                          headers=user_headers, json={"option_ids": [], "upsell_ids": []}, timeout=30)
        assert b.status_code == 200
        m = b.json()
        assert "items" in m and "subtotal_cents" in m and "est_hours" in m
        assert isinstance(m["subtotal_cents"], int) and m["subtotal_cents"] > 0

    def test_build_with_optional_increases_subtotal(self, user_headers):
        kit = requests.get(f"{BASE_URL}/api/kits/kitchen-mini-makeover", headers=user_headers, timeout=30).json()
        opts = [c["id"] for c in kit["components"] if c.get("optional")]
        ups = [u["id"] for u in kit.get("upsells", [])]
        base = requests.post(f"{BASE_URL}/api/kits/kitchen-mini-makeover/build",
                             headers=user_headers, json={"option_ids": [], "upsell_ids": []}, timeout=30).json()
        full = requests.post(f"{BASE_URL}/api/kits/kitchen-mini-makeover/build",
                             headers=user_headers, json={"option_ids": opts, "upsell_ids": ups}, timeout=30).json()
        if opts or ups:
            assert full["subtotal_cents"] >= base["subtotal_cents"]

    def test_kit_detail_404(self, user_headers):
        r = requests.get(f"{BASE_URL}/api/kits/nonexistent-kit-xyz", headers=user_headers, timeout=30)
        assert r.status_code == 404


# ----------------- Start kit → project + orders/mine + arrived + leftover ------------------
class TestKitLifecycle:
    slug = "bathroom-tile-refresh"  # different one, keeps demo user's earlier one intact

    def test_start_creates_project_with_steps_and_guide(self, user_headers):
        r = requests.post(f"{BASE_URL}/api/kits/{self.slug}/start",
                          headers=user_headers, json={"option_ids": [], "upsell_ids": []}, timeout=30)
        # Fallback in case that slug isn't seeded; find one that is
        if r.status_code == 404:
            kits = requests.get(f"{BASE_URL}/api/kits", headers=user_headers, timeout=30).json()["kits"]
            self.__class__.slug = kits[1]["slug"] if len(kits) > 1 else kits[0]["slug"]
            r = requests.post(f"{BASE_URL}/api/kits/{self.slug}/start",
                              headers=user_headers, json={"option_ids": [], "upsell_ids": []}, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "project_id" in j and "order_id" in j
        self.__class__.project_id = j["project_id"]
        self.__class__.order_id = j["order_id"]

        # verify project persisted with steps>0 and guide
        p = requests.get(f"{BASE_URL}/api/projects/{j['project_id']}", headers=user_headers, timeout=30)
        assert p.status_code == 200
        pj = p.json()
        assert pj.get("source") == "kit"
        assert isinstance(pj.get("steps"), list) and len(pj["steps"]) > 0
        assert isinstance(pj.get("guide"), dict)

    def test_orders_mine_includes_new(self, user_headers):
        r = requests.get(f"{BASE_URL}/api/kits/orders/mine", headers=user_headers, timeout=30)
        assert r.status_code == 200
        orders = r.json()["orders"]
        assert any(o["id"] == self.__class__.order_id for o in orders)
        o = next(o for o in orders if o["id"] == self.__class__.order_id)
        for f in ("total_steps", "done_steps", "progress"):
            assert f in o

    def test_arrived(self, user_headers):
        r = requests.post(f"{BASE_URL}/api/kits/orders/{self.__class__.order_id}/arrived",
                          headers=user_headers, timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "arrived"

    def test_leftover_creates_listings(self, user_headers):
        r = requests.post(f"{BASE_URL}/api/kits/orders/{self.__class__.order_id}/leftover",
                          headers=user_headers,
                          json={"items": [{"title": "TEST_Leftover tile pack", "category": "Tile"},
                                          {"title": "TEST_Leftover grout", "category": "Other"}]}, timeout=30)
        assert r.status_code == 200
        assert r.json()["listed"] == 2

    def test_arrived_404_for_bogus_order(self, user_headers):
        r = requests.post(f"{BASE_URL}/api/kits/orders/nonexistent/arrived", headers=user_headers, timeout=30)
        assert r.status_code == 404


# ----------------- Admin endpoints & authorization ------------------
class TestAdminKits:
    def test_admin_list(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/kits", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "kits" in data and "categories" in data
        assert len(data["kits"]) >= 5

    def test_admin_analytics(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/kits/analytics", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert "totals" in j and "top_kits" in j
        for f in ("kits", "active", "orders", "completed", "completion_pct", "gmv_cents"):
            assert f in j["totals"]

    def test_admin_endpoints_require_admin(self, user_headers):
        r = requests.get(f"{BASE_URL}/api/admin/kits", headers=user_headers, timeout=30)
        assert r.status_code == 403
        r2 = requests.get(f"{BASE_URL}/api/admin/kits/analytics", headers=user_headers, timeout=30)
        assert r2.status_code == 403

    def test_admin_create_toggle_delete(self, admin_headers):
        payload = {
            "name": "TEST_Sheet52 Temp Kit",
            "category": "General",
            "icon": "toolbox-outline",
            "tagline": "temporary test kit",
            "description": "auto-created by pytest",
            "difficulty": "Beginner",
            "est_hours": 2,
            "timeline_days": 1,
            "components": [
                {"name": "TEST screws", "kind": "material", "qty": 1, "unit": "pack", "price_cents": 500,
                 "optional": False, "default_on": True, "eco": False},
                {"name": "TEST drill", "kind": "tool", "qty": 1, "unit": "", "price_cents": 4000,
                 "optional": True, "default_on": False, "eco": False},
            ],
            "upsells": [{"name": "TEST upgrade", "description": "faster finish", "price_cents": 1500}],
            "steps": [{"title": "Step 1", "instruction": "Do this", "ar_hint": "", "phase": "install"}],
            "featured": False,
            "active": True,
        }
        r = requests.post(f"{BASE_URL}/api/admin/kits", headers=admin_headers, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        slug = r.json()["slug"]

        # verify via GET
        g = requests.get(f"{BASE_URL}/api/admin/kits/{slug}", headers=admin_headers, timeout=30)
        assert g.status_code == 200
        assert g.json()["name"] == "TEST_Sheet52 Temp Kit"

        # toggle to inactive
        t = requests.post(f"{BASE_URL}/api/admin/kits/{slug}/toggle", headers=admin_headers, timeout=30)
        assert t.status_code == 200
        # updating
        payload["tagline"] = "updated tagline"
        u = requests.put(f"{BASE_URL}/api/admin/kits/{slug}", headers=admin_headers, json=payload, timeout=30)
        assert u.status_code == 200

        # cleanup delete
        d = requests.delete(f"{BASE_URL}/api/admin/kits/{slug}", headers=admin_headers, timeout=30)
        assert d.status_code == 200
        # verify gone
        g2 = requests.get(f"{BASE_URL}/api/admin/kits/{slug}", headers=admin_headers, timeout=30)
        assert g2.status_code == 404
