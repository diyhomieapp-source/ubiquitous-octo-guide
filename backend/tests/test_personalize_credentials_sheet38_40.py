"""Sheet #38 (AR/Avatar Personalization) + #40 (Contractor Licensing & Credentials) backend tests."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


# ---------------- Shared session / auth helpers ----------------
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(session, email, password):
    r = session.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def demo_token(session):
    return _login(session, "demo_home@diyhomie.com", __import__("os").environ.get("TEST_USER_PASSWORD", ""))


@pytest.fixture(scope="module")
def pro_token(session):
    return _login(session, "pat_pro_test@diyhomie.com", __import__("os").environ.get("TEST_USER_PASSWORD", ""))


@pytest.fixture(scope="module")
def admin_token(session):
    return _login(session, "Diyhomieapp@gmail.com", __import__("os").environ.get("TEST_ADMIN_PASSWORD", ""))


# =========================================================================
# Sheet #38 — Preferences / Personalization
# =========================================================================
class TestPreferences:
    def test_get_defaults_options_presets(self, session, demo_token):
        # First reset to a known state
        session.post(f"{API}/preferences/reset", headers=_h(demo_token), timeout=10)
        r = session.get(f"{API}/preferences", headers=_h(demo_token), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert set(d.keys()) == {"preferences", "options", "presets"}
        prefs = d["preferences"]
        # Defaults
        assert prefs["theme"] == "Dark"
        assert prefs["text_size"] == "Medium"
        assert prefs["jit_coaching"] is True
        assert prefs["preset"] is None
        # 12 option groups (avatar_gender, avatar_look, avatar_gear, avatar_skin,
        # voice, verbosity, overlay_palette, highlight_style, text_size, cue_speed,
        # theme, notification_sound)
        assert len(d["options"]) == 12
        for key in ["avatar_gender", "theme", "text_size", "avatar_skin", "voice"]:
            assert key in d["options"] and isinstance(d["options"][key], list) and d["options"][key]
        # 4 presets
        ids = {p["id"] for p in d["presets"]}
        assert ids == {"trusted_foreman", "diy_hero", "safety_first", "silent"}
        for p in d["presets"]:
            assert "label" in p and "icon" in p

    def test_put_persists_and_clears_preset(self, session, demo_token):
        # Apply a preset first so preset is set
        r0 = session.post(f"{API}/preferences/preset/trusted_foreman", headers=_h(demo_token), timeout=10)
        assert r0.status_code == 200
        assert r0.json()["preferences"]["preset"] == "trusted_foreman"

        payload = {"theme": "Blueprint", "text_size": "Large", "jit_coaching": False}
        r = session.put(f"{API}/preferences", headers=_h(demo_token), json=payload, timeout=10)
        assert r.status_code == 200
        p = r.json()["preferences"]
        assert p["theme"] == "Blueprint"
        assert p["text_size"] == "Large"
        assert p["jit_coaching"] is False
        assert p["preset"] is None, "manual PUT must clear preset"

        # Persistence check via GET
        r2 = session.get(f"{API}/preferences", headers=_h(demo_token), timeout=10)
        p2 = r2.json()["preferences"]
        assert p2["theme"] == "Blueprint"
        assert p2["text_size"] == "Large"
        assert p2["jit_coaching"] is False

    def test_put_ignores_invalid_option_values(self, session, demo_token):
        # Save baseline theme
        base = session.get(f"{API}/preferences", headers=_h(demo_token), timeout=10).json()["preferences"]
        current_theme = base["theme"]
        # Try invalid value
        r = session.put(f"{API}/preferences", headers=_h(demo_token), json={"theme": "Ultraviolet"}, timeout=10)
        assert r.status_code == 200
        assert r.json()["preferences"]["theme"] == current_theme, "invalid option must be ignored"

    def test_put_ignores_unknown_keys(self, session, demo_token):
        r = session.put(f"{API}/preferences", headers=_h(demo_token), json={"bogus_key": "xyz"}, timeout=10)
        assert r.status_code == 200
        assert "bogus_key" not in r.json()["preferences"]

    @pytest.mark.parametrize("preset_id", ["trusted_foreman", "diy_hero", "safety_first", "silent"])
    def test_apply_each_preset(self, session, demo_token, preset_id):
        r = session.post(f"{API}/preferences/preset/{preset_id}", headers=_h(demo_token), timeout=10)
        assert r.status_code == 200, r.text
        p = r.json()["preferences"]
        assert p["preset"] == preset_id
        # sanity: each preset touches at least one known field
        if preset_id == "trusted_foreman":
            assert p["voice"] == "Contractor"
            assert p["theme"] == "Toolbox"
        if preset_id == "silent":
            assert p["notification_sound"] == "Silent"
            assert p["jit_coaching"] is False

    def test_apply_unknown_preset_404(self, session, demo_token):
        r = session.post(f"{API}/preferences/preset/bogus", headers=_h(demo_token), timeout=10)
        assert r.status_code == 404

    def test_reset_restores_defaults(self, session, demo_token):
        r = session.post(f"{API}/preferences/reset", headers=_h(demo_token), timeout=10)
        assert r.status_code == 200
        p = r.json()["preferences"]
        assert p["theme"] == "Dark"
        assert p["text_size"] == "Medium"
        assert p["jit_coaching"] is True
        assert p["preset"] is None

    def test_preferences_requires_auth(self, session):
        r = session.get(f"{API}/preferences", timeout=10)
        assert r.status_code in (401, 403)


# =========================================================================
# Sheet #40 — Pro Credentials + Admin verification
# =========================================================================
class TestProCredentials:
    def test_non_pro_user_gets_403(self, session, demo_token):
        # demo_home_1 is a plain user — should be 403
        r = session.get(f"{API}/pro/credentials", headers=_h(demo_token), timeout=10)
        assert r.status_code == 403

    def test_pro_list_shape(self, session, pro_token):
        r = session.get(f"{API}/pro/credentials", headers=_h(pro_token), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert set(d.keys()) == {"credentials", "compliance", "types"}
        assert isinstance(d["credentials"], list)
        assert "overall" in d["compliance"]
        assert d["compliance"]["overall"] in {
            "compliant", "expiring_soon", "action_required", "under_review", "not_submitted"
        }
        assert "Contractor License" in d["types"]

    def test_pro_add_invalid_type_400(self, session, pro_token):
        r = session.post(f"{API}/pro/credentials", headers=_h(pro_token),
                         json={"type": "FakeType", "number": "TEST_x"}, timeout=10)
        assert r.status_code == 400

    def test_pro_add_delete_and_pending_flow(self, session, pro_token):
        num = f"TEST_{uuid.uuid4().hex[:8]}"
        r = session.post(f"{API}/pro/credentials", headers=_h(pro_token),
                         json={"type": "Certification", "number": num, "issuer": "TEST_issuer",
                               "expires_at": None}, timeout=10)
        assert r.status_code == 200, r.text
        cred = r.json()["credential"]
        assert cred["status"] == "pending"
        assert cred["number"] == num
        cred_id = cred["id"]

        # Verify it appears in list
        rl = session.get(f"{API}/pro/credentials", headers=_h(pro_token), timeout=10)
        assert any(c["id"] == cred_id for c in rl.json()["credentials"])

        # Overall compliance should not be 'not_submitted' anymore (pat_pro already has verified cred);
        # but at least contains 'pending' cred
        pending_creds = [c for c in rl.json()["credentials"] if c["status"] == "pending"]
        assert len(pending_creds) >= 1

        # Cleanup
        rd = session.delete(f"{API}/pro/credentials/{cred_id}", headers=_h(pro_token), timeout=10)
        assert rd.status_code == 200

        # Verify deleted
        rl2 = session.get(f"{API}/pro/credentials", headers=_h(pro_token), timeout=10)
        assert not any(c["id"] == cred_id for c in rl2.json()["credentials"])

    def test_admin_verify_transitions_compliance(self, session, pro_token, admin_token):
        # Add a fresh cred with an expiry >90d out (not expiring)
        from datetime import datetime, timezone, timedelta
        far_expiry = (datetime.now(timezone.utc) + timedelta(days=365)).isoformat()
        num = f"TEST_{uuid.uuid4().hex[:8]}"
        r = session.post(f"{API}/pro/credentials", headers=_h(pro_token),
                         json={"type": "Liability Insurance", "number": num, "issuer": "TEST_admin_flow",
                               "expires_at": far_expiry}, timeout=10)
        assert r.status_code == 200, r.text
        cred_id = r.json()["credential"]["id"]

        # Admin approves
        ra = session.patch(f"{API}/admin/credentials/{cred_id}",
                           headers=_h(admin_token),
                           json={"status": "verified", "note": ""}, timeout=10)
        assert ra.status_code == 200, ra.text
        assert ra.json()["ok"] is True
        assert "compliance" in ra.json()

        # Pro sees status as verified (or expiring if within 30d — but we chose 365d out)
        rl = session.get(f"{API}/pro/credentials", headers=_h(pro_token), timeout=10)
        target = next(c for c in rl.json()["credentials"] if c["id"] == cred_id)
        assert target["status"] == "verified"
        assert target["verified_at"] is not None

        # Cleanup
        session.delete(f"{API}/pro/credentials/{cred_id}", headers=_h(pro_token), timeout=10)

    def test_admin_reject_flow(self, session, pro_token, admin_token):
        num = f"TEST_{uuid.uuid4().hex[:8]}"
        r = session.post(f"{API}/pro/credentials", headers=_h(pro_token),
                         json={"type": "Trade License", "number": num, "issuer": "TEST_reject"}, timeout=10)
        cred_id = r.json()["credential"]["id"]

        ra = session.patch(f"{API}/admin/credentials/{cred_id}",
                           headers=_h(admin_token),
                           json={"status": "rejected", "note": "TEST_needs_reup"}, timeout=10)
        assert ra.status_code == 200

        rl = session.get(f"{API}/pro/credentials", headers=_h(pro_token), timeout=10)
        target = next(c for c in rl.json()["credentials"] if c["id"] == cred_id)
        assert target["status"] == "rejected"
        assert target["note"] == "TEST_needs_reup"

        session.delete(f"{API}/pro/credentials/{cred_id}", headers=_h(pro_token), timeout=10)

    def test_admin_invalid_status_400(self, session, pro_token, admin_token):
        num = f"TEST_{uuid.uuid4().hex[:8]}"
        r = session.post(f"{API}/pro/credentials", headers=_h(pro_token),
                         json={"type": "Surety Bond", "number": num}, timeout=10)
        cred_id = r.json()["credential"]["id"]

        r400 = session.patch(f"{API}/admin/credentials/{cred_id}",
                             headers=_h(admin_token),
                             json={"status": "in_progress"}, timeout=10)
        assert r400.status_code == 400

        session.delete(f"{API}/pro/credentials/{cred_id}", headers=_h(pro_token), timeout=10)

    def test_admin_unknown_id_404(self, session, admin_token):
        r = session.patch(f"{API}/admin/credentials/nope-id-xyz",
                          headers=_h(admin_token),
                          json={"status": "verified"}, timeout=10)
        assert r.status_code == 404

    def test_admin_list_and_counts(self, session, admin_token):
        r = session.get(f"{API}/admin/credentials", headers=_h(admin_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "credentials" in d and "counts" in d
        for k in ("pending", "expiring", "expired", "verified"):
            assert k in d["counts"]
        # each credential should have pro_name + pro_email exposed to admin
        for c in d["credentials"][:5]:
            assert "pro_email" in c
            assert "pro_user_id" in c

    def test_admin_list_status_filter(self, session, admin_token):
        r = session.get(f"{API}/admin/credentials?status=verified", headers=_h(admin_token), timeout=10)
        assert r.status_code == 200
        for c in r.json()["credentials"]:
            assert c["status"] == "verified"

    def test_admin_requires_admin(self, session, demo_token):
        r = session.get(f"{API}/admin/credentials", headers=_h(demo_token), timeout=10)
        assert r.status_code in (401, 403)
