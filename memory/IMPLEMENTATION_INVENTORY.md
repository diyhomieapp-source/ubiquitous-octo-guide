# DIYHomie — Implementation Inventory & Source-of-Truth Report
_Phase 1 (inspection & verification). Generated June 2026 after test iteration 100 (all green). No code was rebuilt or deleted to produce this document._

## 1. Architecture at a glance
- **Frontend:** Expo SDK 54 (React Native, expo-router file-based routing) at `/app/frontend`. ~51 feature areas under `app/home-intel/*`, plus auth, admin (`/admin`), pros, marketplace surfaces. Shared code in `src/` (api client w/ JWT, theme, components, offline queue, storage, analytics).
- **Backend:** FastAPI at `/app/backend`. `server.py` (~9,500 lines) holds auth/core + wires **83 modular `*_engine.py` files**, each owning one domain with its own `/api/hi/...` router (user) and often an admin router.
- **Database:** MongoDB (Motor, async). All records carry string UUID `id` fields; collections are engine-scoped (`hi_*`, `gr_*`, `pi_*`, `pc_*`, `pcx_*`, `cel_*`, `notif_*`, `sf_*`, `mi_*`, `ob_*` ...).
- **Auth:** JWT with per-device sessions (`sid` claim), bcrypt passwords, admin seeding, brute-force events, session revocation. Server-side ownership checks on every engine route (UI is never the access authority).
- **AI:** Emergent LLM key via `emergentintegrations` (GPT-4o chat + vision, Whisper STT, OpenAI TTS); Perplexity optional; Gemini Nano Banana for image generation (design studio).
- **Testing:** 100 recorded test iterations; pytest suites under `/app/backend/tests`; latest reports in `/app/test_reports/iteration_99.json`, `iteration_100.json` — ALL GREEN.

## 2. Status classification

### A. FULLY IMPLEMENTED & TESTED (the working core)
Home & Property
- home_intelligence (property/assets/issues/diagnosis) · room_intelligence (floors/rooms/map/connections) · home_passport (Doc 50: unified passport, profile, home timeline) · property_brain (facts w/ confidence+provenance) · digital_twin · document_vault (OCR manual/receipt/warranty) · measurement (sources/verification) · import (property records) · dashboard (health timeline) · knowledge_graph · search (authorization-first federated)

Projects & Execution
- project_planner (AI plans/phases/steps/materials) · project_workspace (Doc 49/51: briefings, NOW card, problems, evidence, offline bundle) · project_intelligence (NBA, blockers, decisions, changes, budgets, Doc 59 budget-workspace + expenses + change approve/reject) · guided_execution (Doc 52 voice work mode) · guidance_runtime (Doc 47 procedure packs) · orchestrator · guided_repair (issue → plan) · property_record (timeline/closeout/share) · cleanup (leftovers/disposal) · quality_feedback

Materials & Money
- material_intelligence (Doc 55: workspace tabs, quantity calc w/ basis, substitution checks, purchase readiness w/ safety gate, in-store shopping, receipt OCR) · inventory (toolbox + project matching) · tool_intelligence · readiness · marketplace · recommendation (products/affiliates) · funding (savings wallet) · subscription (tiers/limits/trial, Stripe test mode) · handoff (shopping list/home report)

Safety (multi-layer, hard gates)
- safety_engine (Doc 43 verdicts/PPE/block rules) · safety_escalation (Doc 56 checkpoints, RED never dismissible) · emergency (readiness) · compliance (permits/codes)

Professionals
- pro_connect (Doc 48 creators/briefs/requests/scopes) · pro_collab (Doc 57 handoff packages w/ sharing review, statuses, verbatim pro responses, hybrid DIY/Pro labels) · pro_handoff (Doc 8 issue trade briefs) · pro_workspace · escalation (job summaries) · certification

Care & Engagement
- maintenance (tasks/recurrence/seasonal + Doc 58 skip reasons & post-project follow-ups) · home_care (priority intelligence) · reminders · notification (inbox/prefs/quiet hours + Doc 61 snooze & "Today with Homie" briefing) · celebration (Doc 63 completion records, achievements, HOMIE_VICTORY_01 package, reduced-motion) · rewards + rewards_funding · community · education · collaboration (households/roles/invites/activity/audit — covers Doc 60) · data_governance (privacy/export/deletion — covers most of Doc 32) · accessibility · activation (onboarding intents) · onboarding (account/property)

Voice / Vision / AR
- multimodal (Doc 54 Homie context/intents/action chips) · visual (evidence/annotations) · ar_guidance (Doc 40 action primitives/packages) · spatial_targeting (Doc 53) · conversation_hub (chat)

Platform / Admin
- admin_ops (RBAC/flags) · analytics (event catalog + client track) · audit · homie_hq (AI cost intel) · integration_gateway (secrets vault) · monitoring · release · reliability · platform · design (design system) · support · sync (offline/conflicts) · export · email (autoresponder) · appstore · campaign · affiliate · investor/investor_intel · asset_exit · design_studio (Doc 28/62: inspiration→concept→approve→convert)

### B. IMPLEMENTED BUT INTENTIONALLY MOCKED / KEYLESS FALLBACK
- "Watch a Pro" demo clips: `mock://` placeholder URLs (need real video assets)
- PostHog, Sentry, AWS SES, Weather: run in keyless/fallback mode until real keys provided
- Push notifications: full architecture built; **blocked on user's `google-services.json`** + native build
- Pro marketplace matching: manual/admin status pipeline by design (no live provider network yet — Doc 57 "build later")

### C. DOCUMENTED (in Build Docs) BUT DEFERRED BY DESIGN ("build later" scope)
- True spatial AR (Unity/ARKit anchoring, 3D avatar) — requires native build + Unity/Reallusion asset professionals; the API "intelligence layer" contract is complete
- Live retailer inventory / barcode scanning / real-time pricing (Doc 55)
- Appointment scheduling, video consults, pro payments (Doc 57)
- Climate-aware seasonal intelligence, manufacturer API schedules (Doc 58)
- Celebration Studio admin UI, multiple animation packages, licensed music assets (Doc 63)
- Admin MFA; family profiles for minors (Doc 60)
- Doc 32 remainder (full export automation) — partially covered by export/data_governance engines; user will paste Doc 32 when ready

### D. BROKEN / DUPLICATED / DISCONNECTED
- **Broken: none known.** Iterations 99–100 all green; the one crash found (project workspace `cleanup_disposal`) was fixed and retested.
- **Deliberate overlaps (complementary, not duplicates):** three "pro" engines (Doc 8 issue-briefs / Doc 48 creator-requests / Doc 57 project-handoffs) serve different entry points; two materials layers (planner CRUD vs Doc 55 intelligence) share `hi_project_materials`; maintenance vs home_care (scheduler vs prioritizer). Consolidation is optional future refactoring, not a defect.
- **Tech debt:** `server.py` keeps growing as the router aggregator (~9.5k lines). A `routes/` split is the top refactoring candidate — nonurgent, zero user impact.

## 3. Environment & integrations (names only)
Backend `.env`: MONGO_URL, DB_NAME, JWT_*, ADMIN_*, EMERGENT_LLM_KEY (active), STRIPE_* (test, active), PERPLEXITY_API_KEY, POSTHOG_*, SENTRY_*, AWS_*/SES (fallback), WEATHER_API_KEY, EMERGENT_PUSH_KEY (placeholder until deploy), BROWSERBASE_*, PIPEDREAM_*.
Frontend `.env`: EXPO_PUBLIC_BACKEND_URL + Emergent packager vars (protected — never edit).

## 4. Source of truth & Git
- The live source of truth is this Emergent workspace (`/app`), branch `main` with milestone auto-commits.
- **No GitHub remote is connected.** To create an external checkpoint: profile → connect GitHub → "Save to GitHub" → pick branch → PUSH.

## 5. Prioritized forward plan
1. **P0 — Keep shipping Build Docs as pasted** (audit-first: most new docs are already 60-90% covered; build only true deltas; test every batch). Pending from user: Doc 32 full text.
2. **P0 — Unblock push notifications**: user provides `google-services.json` during native build via Publish.
3. **P1 — Real keys** for PostHog/Sentry/SES/Weather when production telemetry is wanted.
4. **P1 — GitHub checkpoint** (Save to GitHub) before any large refactor.
5. **P2 — Refactor `server.py`** into `routes/` aggregator modules (mechanical, test-protected).
6. **P2 — Real content assets**: pro demo videos, licensed celebration audio, Unity AR asset work (external specialists per Doc 40 §15).
7. **P3 — Deliberate consolidation review** of the three pro-engines and two materials layers once product direction settles.

## 6. Test credentials
See `/app/memory/test_credentials.md` (demo_home@diyhomie.com / Test1234; admin Diyhomieapp@gmail.com / diyhomie1122).
