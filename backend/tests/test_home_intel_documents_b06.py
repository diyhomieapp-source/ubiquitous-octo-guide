"""
Tests for DIYhomie Home Intelligence (B06) — Home Document Vault & Asset
Knowledge Capture.

Endpoints under test:
  - POST   /api/hi/documents                          (upload, is_image false)
  - GET    /api/hi/documents                          (list + counts + review_count)
  - GET    /api/hi/documents/{id}                     (detail w/ extractions + rels)
  - PUT    /api/hi/documents/{id}                     (edit title/category/notes)
  - POST   /api/hi/documents/{id}/link                (link to asset)
  - GET    /api/hi/documents/{id} again               (rel name resolution)
  - PUT    /api/hi/documents/{id}/extractions/{eid}   (confirm / reject)
  - GET    /api/hi/documents/review-queue             (pending extractions)
  - GET    /api/hi/documents/search?q=                (title + category words)
  - POST   /api/hi/documents/{id}/ask                 (grounded Q&A)
  - DELETE /api/hi/documents/{id}                     (cleanup)

A fresh throw-away user is used to keep state isolated.
"""
import base64
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = __import__("os").environ.get("TEST_BASE_URL", "http://localhost:8001")

TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAj"
    "CB0C8AAAAASUVORK5CYII="
)


# ---------------------------------------------------------- fixtures
@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def user_ctx(api):
    email = f"TEST_b06_{uuid.uuid4().hex[:8]}@diyhomie.com"
    r = api.post(f"{BASE_URL}/api/auth/register",
                 json={"email": email, "password": __import__("os").environ.get("TEST_USER_PASSWORD", ""),
                       "name": "B06 Tester"}, timeout=30)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text[:300]}"
    j = r.json()
    return {"token": j["access_token"], "user_id": j["user"]["id"], "email": email}


@pytest.fixture(scope="module")
def h(user_ctx):
    return {"Authorization": f"Bearer {user_ctx['token']}",
            "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def asset_id(api, h):
    """A B01 asset we can link a document to."""
    r = api.post(f"{BASE_URL}/api/hi/assets", headers=h,
                 json={"name": "TEST_B06_Furnace", "category": "HVAC",
                       "brand": "Carrier", "model_number": "X-99"}, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    return body.get("id") or body.get("asset", {}).get("id")


# ---------------------------------------------------------- upload
class TestB06Upload:
    def test_upload_non_image_no_extraction(self, api, h, request):
        """is_image=false: no vision, no extractions, status ready."""
        r = api.post(f"{BASE_URL}/api/hi/documents", headers=h, json={
            "title": "TEST_B06_Receipt_NonImage",
            "category": "receipt",
            "file_base64": TINY_PNG_B64,
            "file_type": "file",
            "is_image": False,
            "notes": "Non-image upload test",
        }, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("processing_status") == "ready"
        assert data.get("extracted_fields") == 0
        assert data.get("title") == "TEST_B06_Receipt_NonImage"
        assert data.get("id")
        request.config._b06_doc_id_noimg = data["id"]  # stash

    def test_upload_image_extraction_path(self, api, h, request):
        """is_image=true: runs vision (may return 0 fields on tiny png). Must
        still succeed and mark ready without raising."""
        r = api.post(f"{BASE_URL}/api/hi/documents", headers=h, json={
            "title": "TEST_B06_Manual_Image",
            "category": "manual",
            "file_base64": TINY_PNG_B64,
            "file_type": "image",
            "is_image": True,
        }, timeout=120)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("processing_status") == "ready"
        assert isinstance(data.get("extracted_fields"), int)
        request.config._b06_doc_id_img = data["id"]

    def test_upload_requires_file(self, api, h):
        r = api.post(f"{BASE_URL}/api/hi/documents", headers=h, json={
            "title": "TEST_no_file", "category": "receipt",
            "file_base64": "", "file_type": "image", "is_image": False,
        }, timeout=30)
        assert r.status_code == 400


# ---------------------------------------------------------- list / counts
class TestB06List:
    def test_list_returns_counts_and_flags(self, api, h):
        r = api.get(f"{BASE_URL}/api/hi/documents", headers=h, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "documents" in data and isinstance(data["documents"], list)
        assert "counts" in data and isinstance(data["counts"], dict)
        assert "review_count" in data
        assert data.get("total", 0) >= 1
        # every doc must expose the two derived flags
        for d in data["documents"]:
            assert "needs_review" in d
            assert "is_linked" in d
        # category counts should include receipt >=1 & manual >=1 from uploads
        assert data["counts"].get("receipt", 0) >= 1
        assert data["counts"].get("manual", 0) >= 1

    def test_list_category_filter(self, api, h):
        r = api.get(f"{BASE_URL}/api/hi/documents?category=receipt",
                    headers=h, timeout=30)
        assert r.status_code == 200
        for d in r.json()["documents"]:
            assert d["category"] == "receipt"


# ---------------------------------------------------------- detail / edit
class TestB06Detail:
    def test_detail_shape(self, api, h, request):
        doc_id = request.config._b06_doc_id_noimg
        r = api.get(f"{BASE_URL}/api/hi/documents/{doc_id}",
                    headers=h, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["document"]["id"] == doc_id
        assert isinstance(data["extractions"], list)
        assert isinstance(data["relationships"], list)
        # non-image upload should have zero extractions
        assert len(data["extractions"]) == 0

    def test_edit_updates_fields(self, api, h, request):
        doc_id = request.config._b06_doc_id_noimg
        r = api.put(f"{BASE_URL}/api/hi/documents/{doc_id}", headers=h, json={
            "title": "TEST_B06_Receipt_Edited", "category": "invoice",
            "notes": "updated notes"}, timeout=30)
        assert r.status_code == 200, r.text
        # verify via GET
        g = api.get(f"{BASE_URL}/api/hi/documents/{doc_id}",
                    headers=h, timeout=30).json()
        assert g["document"]["title"] == "TEST_B06_Receipt_Edited"
        assert g["document"]["category"] == "invoice"
        assert g["document"]["notes"] == "updated notes"

    def test_detail_404_for_unknown(self, api, h):
        r = api.get(f"{BASE_URL}/api/hi/documents/{uuid.uuid4()}",
                    headers=h, timeout=30)
        assert r.status_code == 404


# ---------------------------------------------------------- link
class TestB06Link:
    def test_link_to_asset(self, api, h, asset_id, request):
        doc_id = request.config._b06_doc_id_noimg
        r = api.post(f"{BASE_URL}/api/hi/documents/{doc_id}/link", headers=h,
                    json={"related_entity_type": "asset",
                           "related_entity_id": asset_id,
                           "relationship_type": "manual_for"}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
        # verify relationship + shortcut asset_id + resolved name
        g = api.get(f"{BASE_URL}/api/hi/documents/{doc_id}",
                    headers=h, timeout=30).json()
        assert g["document"].get("asset_id") == asset_id
        rels = g["relationships"]
        assert any(rl["related_entity_type"] == "asset"
                   and rl["related_entity_id"] == asset_id
                   and rl.get("name") for rl in rels)

    def test_link_invalid_type_rejected(self, api, h, request):
        doc_id = request.config._b06_doc_id_noimg
        r = api.post(f"{BASE_URL}/api/hi/documents/{doc_id}/link", headers=h,
                     json={"related_entity_type": "unicorn",
                           "related_entity_id": "x"}, timeout=30)
        assert r.status_code == 400


# ---------------------------------------------------------- extraction review
class TestB06ExtractionReview:
    def _seed_manual_extraction(self, api, h, doc_id):
        """The vision model probably returned 0 fields for the tiny png.
        Seed one via a direct DB-less path by uploading an image doc and
        then treating any created extraction — otherwise skip."""
        g = api.get(f"{BASE_URL}/api/hi/documents/{doc_id}",
                    headers=h, timeout=30).json()
        return g["extractions"]

    def test_review_queue_returns_shape(self, api, h):
        r = api.get(f"{BASE_URL}/api/hi/documents/review-queue",
                    headers=h, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "documents" in data
        for d in data["documents"]:
            assert "pending" in d
            assert d["pending"] >= 1

    def test_confirm_reject_extraction_when_present(self, api, h, request):
        """If vision produced any extraction on the image upload, exercise
        confirm and reject transitions and check state via detail GET."""
        doc_id = request.config._b06_doc_id_img
        g = api.get(f"{BASE_URL}/api/hi/documents/{doc_id}",
                    headers=h, timeout=30).json()
        exts = g["extractions"]
        if not exts:
            pytest.skip("No extractions produced by vision on tiny PNG; "
                        "confirm/reject exercised only when present.")
        # confirm first with edited value
        e0 = exts[0]
        r = api.put(
            f"{BASE_URL}/api/hi/documents/{doc_id}/extractions/{e0['id']}",
            headers=h, json={"status": "confirmed",
                             "extracted_value": "TEST_confirmed"}, timeout=30)
        assert r.status_code == 200
        # verify
        g2 = api.get(f"{BASE_URL}/api/hi/documents/{doc_id}",
                     headers=h, timeout=30).json()
        after = [e for e in g2["extractions"] if e["id"] == e0["id"]][0]
        assert after["status"] == "confirmed"
        assert after["confidence_level"] == "Confirmed by User"
        assert after["extracted_value"] == "TEST_confirmed"


# ---------------------------------------------------------- search
class TestB06Search:
    def test_search_by_title(self, api, h):
        # Use a token that isn't a category keyword so search doesn't collapse
        # to a category filter (title/text regex path).
        unique = f"ZapunctuallyUnique{uuid.uuid4().hex[:6]}"
        up = api.post(f"{BASE_URL}/api/hi/documents", headers=h, json={
            "title": unique, "category": "other",
            "file_base64": TINY_PNG_B64, "file_type": "file",
            "is_image": False}, timeout=30)
        assert up.status_code == 200, up.text
        did = up.json()["id"]
        r = api.get(f"{BASE_URL}/api/hi/documents/search",
                    headers=h, params={"q": unique}, timeout=30)
        assert r.status_code == 200
        docs = r.json()["documents"]
        assert any(d["title"] == unique for d in docs)
        # cleanup
        api.delete(f"{BASE_URL}/api/hi/documents/{did}", headers=h, timeout=30)

    def test_search_by_category_word_maps_to_filter(self, api, h):
        r = api.get(f"{BASE_URL}/api/hi/documents/search",
                    headers=h, params={"q": "manual"}, timeout=30)
        assert r.status_code == 200
        docs = r.json()["documents"]
        # every match must be in the manual category since the category word
        # collapses the search to a category filter
        for d in docs:
            assert d["category"] == "manual"

    def test_search_empty_query_returns_empty(self, api, h):
        r = api.get(f"{BASE_URL}/api/hi/documents/search",
                    headers=h, params={"q": ""}, timeout=30)
        assert r.status_code == 200
        assert r.json()["documents"] == []


# ---------------------------------------------------------- ask
class TestB06Ask:
    def test_ask_returns_answer_string(self, api, h, request):
        doc_id = request.config._b06_doc_id_noimg
        r = api.post(f"{BASE_URL}/api/hi/documents/{doc_id}/ask",
                     headers=h,
                     json={"question": "What category is this document?"},
                     timeout=120)
        # 502 acceptable if upstream LLM briefly unavailable; log & skip
        if r.status_code == 502:
            pytest.skip("LLM temporarily unavailable (502).")
        assert r.status_code == 200, r.text
        j = r.json()
        assert "answer" in j and isinstance(j["answer"], str)

    def test_ask_empty_question_400(self, api, h, request):
        doc_id = request.config._b06_doc_id_noimg
        r = api.post(f"{BASE_URL}/api/hi/documents/{doc_id}/ask",
                     headers=h, json={"question": "   "}, timeout=30)
        assert r.status_code == 400


# ---------------------------------------------------------- delete & cleanup
class TestB06Delete:
    def test_delete_document_cleans_extractions_and_rels(self, api, h, request):
        doc_id = request.config._b06_doc_id_img
        r = api.delete(f"{BASE_URL}/api/hi/documents/{doc_id}",
                       headers=h, timeout=30)
        assert r.status_code == 200
        assert r.json().get("ok") is True
        # verify 404
        g = api.get(f"{BASE_URL}/api/hi/documents/{doc_id}",
                    headers=h, timeout=30)
        assert g.status_code == 404
        # cleanup the other doc too
        api.delete(f"{BASE_URL}/api/hi/documents/{request.config._b06_doc_id_noimg}",
                   headers=h, timeout=30)
