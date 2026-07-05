"""Backend tests for DIYhomie Education Center (Info Sheet #62)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://step-by-step-diy.preview.emergentagent.com").rstrip("/")

DEMO_EMAIL = "demo_home@diyhomie.com"
DEMO_PASSWORD = "Test1234"
ADMIN_EMAIL = "Diyhomieapp@gmail.com"
ADMIN_PASSWORD = "diyhomie1122"


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def demo_headers():
    return {"Authorization": f"Bearer {_login(DEMO_EMAIL, DEMO_PASSWORD)}"}


@pytest.fixture(scope="module")
def admin_headers():
    return {"Authorization": f"Bearer {_login(ADMIN_EMAIL, ADMIN_PASSWORD)}"}


# ---------------------------------------------------------- user endpoints
class TestUserEducation:
    def test_tracks_list(self, demo_headers):
        r = requests.get(f"{BASE_URL}/api/education/tracks", headers=demo_headers, timeout=30)
        assert r.status_code == 200
        data = r.json()
        tracks = data.get("tracks", [])
        assert len(tracks) >= 3, f"expected >=3 seeded tracks got {len(tracks)}"
        slugs = {t["slug"] for t in tracks}
        assert {"paint-basics", "plumbing-101", "deck-building"}.issubset(slugs)
        for t in tracks:
            assert "progress" in t
            p = t["progress"]
            for key in ("total", "completed", "pct"):
                assert key in p, f"missing progress.{key} in {t['slug']}"
            assert 0 <= p["pct"] <= 100

    def test_track_detail_with_lessons(self, demo_headers):
        r = requests.get(f"{BASE_URL}/api/education/tracks/step-by-step-diy", headers=demo_headers, timeout=30)
        # slug 'step-by-step-diy' is NOT a real seeded track per code; try paint-basics as spec real
        # The review request mentions step-by-step-diy but seeded is paint-basics/plumbing-101/deck-building.
        # If 404 fall back to paint-basics.
        if r.status_code == 404:
            r = requests.get(f"{BASE_URL}/api/education/tracks/paint-basics", headers=demo_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "track" in data and "lessons" in data
        lessons = data["lessons"]
        assert len(lessons) >= 1
        for i in range(len(lessons) - 1):
            assert lessons[i]["order"] <= lessons[i + 1]["order"], "lessons not ordered"
        for l in lessons:
            assert "completed" in l
            assert isinstance(l["completed"], bool)

    def test_lesson_open_upserts_started(self, demo_headers):
        # get first paint-basics lesson id
        r = requests.get(f"{BASE_URL}/api/education/tracks/paint-basics", headers=demo_headers, timeout=30)
        assert r.status_code == 200
        lessons = r.json()["lessons"]
        assert lessons
        # pick an unstarted/unfinished one preferably
        target = next((l for l in lessons if not l["completed"]), lessons[0])
        lid = target["id"]
        r2 = requests.get(f"{BASE_URL}/api/education/lessons/{lid}", headers=demo_headers, timeout=30)
        assert r2.status_code == 200, r2.text
        lsn = r2.json()
        # required lesson fields
        for key in ("sections", "flashcards", "tools", "safety"):
            assert key in lsn, f"lesson missing {key}"
        assert "quiz_id" in lsn  # can be None but must exist

    def test_complete_lesson_flow(self, demo_headers):
        # find plumbing-101 (single-lesson track) to avoid clobbering paint-basics history
        r = requests.get(f"{BASE_URL}/api/education/tracks/plumbing-101", headers=demo_headers, timeout=30)
        assert r.status_code == 200
        lessons = r.json()["lessons"]
        assert lessons, "plumbing-101 should have >=1 lesson"
        lid = lessons[0]["id"]
        r2 = requests.post(f"{BASE_URL}/api/education/lessons/{lid}/complete", headers=demo_headers, timeout=30)
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert body.get("ok") is True
        assert "micro_cert" in body
        assert "quiz_id" in body
        assert "next_lesson" in body
        assert "progress" in body
        prog = body["progress"]
        assert prog["completed"] >= 1
        assert prog["pct"] > 0

    def test_dashboard_me(self, demo_headers):
        r = requests.get(f"{BASE_URL}/api/education/me", headers=demo_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("completed_count", "badges", "suggested", "recent"):
            assert k in data, f"dashboard missing {k}"
        assert isinstance(data["suggested"], list)
        # suggested must be >=3 OR all-remaining. With 4 seeded lessons and completions, must be >=3 or equals remaining
        assert data["completed_count"] >= 1
        remaining = max(0, 4 - data["completed_count"])
        assert len(data["suggested"]) >= min(3, remaining), (
            f"suggested={len(data['suggested'])} completed={data['completed_count']}")


# ---------------------------------------------------------- admin endpoints
class TestAdminEducation:
    def test_admin_list(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/education", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "tracks" in data and "lessons" in data
        assert data["tracks"], "admin tracks empty"
        for t in data["tracks"]:
            assert "lesson_count" in t, "missing lesson_count on admin track"

    def test_admin_analytics(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/education/analytics", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("total_tracks", "total_lessons", "completions", "learners", "by_track"):
            assert k in data
        assert data["total_tracks"] >= 3
        assert data["total_lessons"] >= 4
        assert data["completions"] >= 1
        assert isinstance(data["by_track"], list)

    def test_admin_toggle_lesson(self, admin_headers):
        # get any lesson
        r = requests.get(f"{BASE_URL}/api/admin/education", headers=admin_headers, timeout=30)
        lessons = r.json()["lessons"]
        assert lessons
        # pick a paint-basics lesson2 to avoid disturbing plumbing progress test
        target = next((l for l in lessons if l["track_slug"] == "paint-basics" and l["order"] == 2), lessons[0])
        lid = target["id"]
        orig = target["status"]
        r1 = requests.post(f"{BASE_URL}/api/admin/education/lessons/{lid}/toggle", headers=admin_headers, timeout=30)
        assert r1.status_code == 200, r1.text
        new_status = r1.json()["status"]
        assert new_status != orig
        # toggle back to restore
        r2 = requests.post(f"{BASE_URL}/api/admin/education/lessons/{lid}/toggle", headers=admin_headers, timeout=30)
        assert r2.status_code == 200
        assert r2.json()["status"] == orig

    def test_non_admin_forbidden(self, demo_headers):
        r = requests.get(f"{BASE_URL}/api/admin/education", headers=demo_headers, timeout=30)
        assert r.status_code == 403, f"expected 403 for non-admin got {r.status_code}"
        r2 = requests.get(f"{BASE_URL}/api/admin/education/analytics", headers=demo_headers, timeout=30)
        assert r2.status_code == 403
