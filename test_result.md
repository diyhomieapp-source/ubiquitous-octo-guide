#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================
## Iteration 2 — High-Converting Onboarding Funnel (main agent)
New funnel order: onboarding → survey → /analysis → auth(register) → /demo → /paywall → (tabs)

### Backend
- task: "First guide free"
  file: backend/server.py POST /api/projects/{id}/guide
  detail: First guide ever for a user costs 0 credits (prior_guides==0); subsequent guides cost 3.
  needs_retesting: true

### Frontend (new screens)
- /app/frontend/app/analysis.tsx — "WE GET YOU" personalized reveal from stored survey; CTA → /auth?mode=register
- /app/frontend/app/demo.tsx — sandbox: pick/type a project → POST /projects → POST /projects/{id}/guide (free) → shows overview, hero step image, steps preview (first 2 unlocked, rest locked) → CTA → /paywall
- survey.tsx finish → /analysis ; auth.tsx register → /demo ; google/login non-onboarded → /demo
- onboarding.tsx hero image restyled (constrained 230px, faded, blends to black)

### agent_communication
- main: Built conversion funnel + free first guide. Need backend verification that first guide is free and second costs 3; frontend funnel routing reaches demo and generates a guide.

## Iteration 3 — Real Stripe Payments (main agent)
Replaced mock paywall with real Stripe Checkout via emergentintegrations (STRIPE_API_KEY=sk_test_emergent, Emergent proxy). One-time payment mode (proxy does not support subscriptions). Server-fixed prices, idempotent fulfillment via status polling.

### Backend (verified via curl)
- POST /api/billing/checkout {tier, origin_url} -> returns real {url: checkout.stripe.com..., session_id: cs_test_...}; inserts payment_transactions {fulfilled:false}.
- GET /api/billing/status/{session_id} -> {payment_status, status, user}; when payment_status=='paid' and not fulfilled -> grants credits+tier+onboarded (idempotent).
- pro=$12 (500cr/60min), master=$29 (2000cr/240min). STRIPE_API_KEY added to backend/.env.

### Frontend
- paywall.tsx redesigned: personalized resume card ("your guide for X is ready"), 5-star social proof, two plans GET PRO/GET MASTER -> startCheckout (web: window.location.href; native: WebBrowser + poll), trust row, "keep exploring with free credits" fallback, test-card disclaimer.
- app/billing/success.tsx NEW: polls /billing/status/{session_id} up to 8x/2s; paid->setUser+route /(tabs); pending/error states with buttons.

### agent_communication
- main: Need web e2e: register->...->paywall->GET PRO->Stripe Checkout->pay 4242 4242 4242 4242->redirect to /billing/success->credits granted (60->560) & lands on tabs. Also verify status endpoint idempotency and that unpaid stays 60.

## Iteration 4 — Real Recurring Stripe Subscriptions (LIVE keys, main agent)
Switched from one-time (emergent proxy) to true recurring subscriptions using the merchant's OWN sk_live key + official `stripe` lib. Confirmed NOT Stripe Connect (standard Billing).
- Startup ensure_stripe_prices(): idempotent Products + recurring monthly Prices via lookup_keys (diyhomie_pro_monthly $12, diyhomie_master_monthly $29). Verified created in LIVE account.
- POST /api/billing/checkout: creates/reuses stripe Customer (stores stripe_customer_id), mode='subscription', payment_method_types=['card']. Verified returns real cs_live_ URL.
- GET /api/billing/status/{sid}: on session.status=='complete' & !fulfilled -> _activate_subscription (sets tier, status active, stripe_subscription_id, grants monthly credits, onboarded). Idempotent.
- POST /api/webhook/stripe: checkout.session.completed/invoice.paid -> activate/refill; customer.subscription.deleted -> downgrade to free. (Needs STRIPE_WEBHOOK_SECRET set + endpoint configured in Stripe dashboard.)
- backend/.env: STRIPE_SECRET_KEY (sk_live), STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET (empty placeholder).
- paywall.tsx: prices now "/month", disclaimer "Secure recurring billing via Stripe · cancel anytime".

NOTE: LIVE mode — cannot validate full pay->activate with test card 4242 (live declines test cards). Verified mechanics via API. Webhook secret pending user setup post-deploy.

## Iteration 5 — Conversion workflow buildout (main agent)
- api.ts: ApiError with .status; project workspace already routes to /paywall on out-of-credits.
- analysis.tsx: added "HOW HOMIE WORKS" 3-step educational strip before signup.
- auth.tsx (register mode): value subtitle + benefit chips (First guide free / No credit card / Cancel anytime); uses DIYhomie Logo.
- demo.tsx: added secondary CTA "Start building with my free credits" (testID demo-startfree-button) -> sets onboarded, goes to (tabs) (avoids forced paywall; usage-based conversion later).
- (tabs)/index.tsx: home description now mentions guides are tailored to the user's exact fixture/model/material (specific toilet, faucet, paint).
Funnel order unchanged: onboarding → survey → /analysis → register → /demo → /paywall(or free)→ (tabs).

## Iteration 6 — Geolocation + WeatherAPI.com (main agent)
- backend/.env: WEATHER_API_KEY set. server.py: fetch_weather() via WeatherAPI forecast.json; weather_advisories() rule-based do/don't tips (rain/heat/cold/wind/UV/humidity); weather_context_str().
- GET /api/weather?q=... (auth; falls back to user.location) -> {weather, advisories}. Verified curl: q=90210 -> Beverly Hills data + advisory.
- build_guide now fetches weather for project/user location and injects into brain_generate_guide so OUTDOOR steps/timing/safety adapt (ignored for indoor jobs).
- Frontend: src/components/WeatherBanner.tsx (GPS via expo-location w/ permission handling + Settings fallback, else profile ZIP/city). Added to Home below the project launcher. Verified UI: "AUSTIN · 79°F Overcast" + humidity advisory.
- app.json: added iOS NSLocationWhenInUseUsageDescription + Android ACCESS_FINE/COARSE_LOCATION.
- Pending (user said "more later"): Perplexity-driven local codes/construction practices deep-dive.

## Iteration 7 — Engaging multi-widget survey (MadMuscles-style)
Survey expanded 5→8 steps with varied widgets (all navigate end-to-end, verified via screenshot):
- NEW "goals" multi-select (Repairs/Upgrades/Paint/Outdoor/Furniture/Save money).
- NEW "confidence" emoji-rating step (Anxious→Pumped) — kind:"rating".
- NEW "value" interstitial — kind:"value": "3x faster" banner + Going-it-alone vs DIYhomie compare + rising confidence bar chart + "I'M IN — CONTINUE".
- pain_point now has "None of the above" (clears others; others clear None).
- Card type gained kind + subtitle; onSelect None-handling; footer Continue shows for value too.
New answer keys saved to pending_survey/profile: goals[], confidence. Progress bar = 8 segments.

## Iteration 8 — Universal Avatar communication layer (state machine)
- src/avatar/avatarStates.ts: AvatarState union (UNDERSTANDING_PROJECT, ANALYZING_PROBLEM, PLANNING_SOLUTION, CHECKING_TOOLS, SAFETY_REVIEW, GENERATING_STEPS, READY, GUIDING_STEP, WAITING_FOR_USER, IMAGE_ANALYSIS, TROUBLESHOOTING, SIMPLIFYING, MISTAKE, COMPLETION) + randomized phrase pools + GENERATION_SEQUENCE + randomPhrase().
- src/components/AvatarThinking.tsx: walks the sequence on a timer, rotates phrases w/ fade, shows animated Homie mascot + progress dots. Reusable; works for ANY project (scales without hardcoding).
- Wired into demo.tsx loading and project/[id].tsx generating state (replaced old spinner). Verified live via screenshot ("Fix a loose doorknob" -> "DIAGNOSING THE PROBLEM." with dots advancing).
- Removed now-unused spinner code/imports in demo.tsx. Lint clean.
NOTE: generation is a single backend call, so stages are time-progressed (approximating streaming). States for step-execution/troubleshooting/image/simplify/mistake/completion are defined and ready to wire into ASK HOMIE, image upload and step flow next.

## Iteration 9 — Multi-language (i18n) + Header menu/bell hookup (main agent)
- Added i18next + react-i18next + expo-localization. Config: src/i18n/index.ts (auto-detects device language, persists choice in AsyncStorage key diyhomie_lang, fallback en).
- 20 USA languages with native names in src/i18n/languages.ts: en,es,zh,tl,vi,ar,fr,ko,ru,ht,de,hi,pt,it,pl,ja,ur,fa,gu,bn. Translation JSONs in src/i18n/locales/*.json generated via OpenAI (scripts/gen_translations.py).
- NEW screen app/settings/language.tsx (language picker + "Use device language"). Reachable from AppMenu hamburger ("Language" row showing current native name).
- Translated chrome: tabs labels, home screen, AppMenu, notifications, ticket. Screens not yet translated (deferred): onboarding, survey, auth, paywall, profile, projects, supplies, community, faq, kb, contact, legal (still English).
- Home header now has notification bell (-> /notifications) + hamburger (opens AppMenu). testIDs: home-notifications, home-menu, menu-language, lang-<code>, lang-auto.
- Backend: ProfileReq+public_user gained `language`. lang_note(profile) appended to brain_generate / brain_generate_guide / brain_answer system prompts so AI guides+answers are written in the user's chosen language. Frontend setLanguage syncs label to PUT /api/profile.
- Smoke verified: /settings/language renders all 20 langs. Pending full e2e test.

## Iteration 10 — Home Memory (agentic recall) (main agent)
- Per-user `home_memory` array on the user doc (capped at 40 compact, room-tagged snippets; never returned to client to avoid bloat).
- detect_room() tags projects (bathroom/kitchen/basement/garage/bedroom/laundry/living/outdoor). push_memory() appends a snippet on guide build (title + context) and on adapt (the problem reported).
- relevant_memories()/memory_note() inject only room-matching (or 4 most-recent) snippets into brain_intake / brain_generate_guide / brain_adapt system prompts so Homie stays consistent with past work (e.g. rerouted plumbing).
- POST /api/projects/{id}/intake now also returns `remembers` (bool). Intake screen shows a "🧠 Homie remembers your past work in this space" banner (testID intake-remembers) when true.
- Verify: do 2 projects in same room (e.g. "Replace toilet" then "Fix sink plumbing" → both bathroom). 2nd project's intake returns remembers=true and the guide should reference prior work.

## Iteration 11 — SEO Blog Platform + Social Share + Funnel (main agent)
- Every guide build auto-creates an anonymized, SEO post in `blog_posts` (canonical-per-task+product; dupes skipped). No extra LLM call (derived from guide data). Verified via curl: "Replace a kitchen faucet (Moen Adler 87233)" → slug replace-a-kitchen-faucet-moen-adler-87233, category Kitchen, 9 steps.
- Backend (all public, no auth): GET /api/blog (list+categories, search q, filter category), GET /api/blog/{slug} (JSON, +view), GET /api/blog/{slug}/html (SEO HTML: title/meta/keywords, canonical https, OG+Twitter, JSON-LD HowTo+Article, share buttons X/FB/WhatsApp/Reddit/Email/Copy, strong CTA → app root with ?ref=blog&project=), GET /api/sitemap.xml, GET /api/robots.txt. public_base() forces https + x-forwarded-host.
- Frontend in-app: /blog (feed: search, category chips, cards) and /blog/[slug] (reader: sections, Share via RN Share/navigator.share, CTA "Start this with Homie" → creates project → /project/[id]?new=1). Menu entry "DIY Guide Library" (testID menu-blog). ScreenHeader gained optional `right` slot.
- NOTE: SEO HTML lives under /api/blog/{slug}/html because the ingress only routes /api/* to backend; on deploy a prettier /blog redirect can be added.
- testIDs: blog-search, blog-cat-*, blog-post-*, blog-share, blog-share-btn, blog-start-project.

## Iteration 12 — Admin Workstation + Feedback widget + RBAC (main agent)
- Admin role: is_admin on user + public_user; idempotent admin seed on startup from backend/.env ADMIN_EMAIL/ADMIN_PASSWORD (Diyhomieapp@gmail.com). require_admin dependency (403 for non-admin). Verified via curl: admin login is_admin=true, /api/admin/overview 200 (real counts), non-admin 403.
- Feedback: POST /api/feedback (auth) {type bug|feature|other, message, platform}. FeedbackFab floating button mounted across (tabs) → modal submit → thank-you. testIDs: feedback-fab, feedback-type-*, feedback-input, feedback-submit, feedback-done.
- Admin endpoints (require_admin): GET /admin/overview, GET/PATCH/DELETE /admin/feedback, GET/PATCH /admin/tickets, GET/PATCH/DELETE /admin/blog.
- Frontend: /admin guarded by app/admin/_layout.tsx (redirect if !is_admin); app/admin/index.tsx workstation with left nav + modules Overview/Feedback/Support Tickets/Blog Curation (status pickers, publish toggle, delete). Responsive sidebar (wide=side, narrow=top). Admin link in AppMenu only when is_admin (testID menu-admin).
- NOTE: bcrypt __about__ warning is harmless (trapped by passlib). require_admin was briefly dropped in a parallel edit and re-added.

## Iteration 13 — Admin polish: notes, CSV export, MRR (main agent)
- Backend (curl-verified): GET /admin/revenue (MRR/ARR from PLAN_TIERS amounts × tier counts; $89/mo, $1068/yr), GET /admin/feedback/export.csv & /admin/tickets/export.csv (PlainTextResponse text/csv, 403 without auth). FeedbackUpdate already supported note+priority.
- Frontend admin/index.tsx: Overview now shows a revenue card (MRR big, ARR, per-tier breakdown). Feedback module → FeedbackCard with STATUS picker, PRIORITY chips (low/med/high), INTERNAL NOTE textarea + Save, and an Export CSV button. Tickets module has Export CSV too. CSV download via authed fetch→Blob→anchor (web).
- testIDs: fb-export, tk-export, prio-<p>-<id>, fb-note-<id>, fb-note-save-<id>.

## Iteration — Neighborhood Network & Peer Exchange (Sheet #26) (main agent)
- Backend (Mongo, curl-verified working): opt-in fields on user (neighborhood_optin, derived neighborhood_tag via _neighborhood_key/_neighborhood_tag from location city/ZIP — no street data). Endpoints: POST /api/neighborhood/join, GET /api/neighborhood (impact metrics + local project feed from opted-in neighbors' timeline + neighbors list w/ Trusted badge), GET/POST /api/neighborhood/posts (kind=help|qa|spotlight), POST /api/neighborhood/posts/{id}/offer ("I can help"), POST .../reveal/{offer_id} (author-approved mutual contact reveal), POST .../resolve, POST .../flag. Admin: GET /api/admin/neighborhood/flags, POST .../posts/{id}/remove, POST .../dismiss. Lazy 12h auto-promotion of unanswered Q&A (promoted_global flag).
- Privacy: contact emails only revealed to the two parties AND only after author taps "Share contact". Posts filtered by neighborhood_key; removed posts hidden.
- Frontend: app/neighborhood.tsx — opt-in gate (privacy explainer + Join, or "add location" if no location), impact banner, neighbors strip w/ Trusted badge, tabs Feed/Borrow&Lend/Ask Locals, post composer FAB (kind by tab), offer modal, reveal/resolve/flag. Entry points: Community(PRO-EARN) tab banner (testID community-neighborhood) + Profile row (profile-neighborhood).
- testIDs: neighborhood-join, neighborhood-add-location, nb-tab-{feed|help|qa}, nb-fab, nb-post-title, nb-post-body, nb-post-submit, nb-offer-btn-{id}, nb-offer-submit, nb-reveal-{offerId}, nb-resolve-{id}, nb-flag-{id}, nb-back.
- Demo user demo_home@diyhomie.com is in neighborhood "Austin" (opted in). Needs a 2nd opted-in Austin user to test offer/reveal cross-user flow.

## Iteration — B2B/Contractor & Professional Services Suite (Sheet #28) (main agent)
- Backend (Mongo + Stripe Connect, curl-verified full flow): pro_profiles (apply→pending, admin verify→verified sets user.is_pro & publishes pro_partners directory listing, ban). Endpoints: POST /api/pro/apply, GET /api/pro/me (dashboard stats: revenue/outstanding/active/rating), Stripe Connect POST /api/pro/connect/onboard + GET /api/pro/connect/status (Express account + AccountLink, destination-charge model), jobs (POST/GET /api/pro/jobs, GET /api/pro/jobs/{id} shared pro+client, POST proposal, PATCH status, POST message, POST invoices, POST /api/pro/invoices/{id}/send), client portal (GET /api/client/jobs, approve, change-request, review→recomputes pro rating, POST /api/client/invoices/{id}/pay → Stripe Checkout destination charge w/ 8% platform fee), admin (GET /api/admin/pro-accounts, verify, ban). Webhook /api/webhook/stripe extended: checkout.session.completed w/ metadata.pro_invoice_id → marks invoice paid + credits pro payout_cents.
- Frontend: app/pro/index.tsx (dashboard/gate/pending), app/pro/apply.tsx, app/pro/payouts.tsx (Connect onboarding via WebBrowser), app/jobs/index.tsx (client list), app/jobs/[id].tsx (shared collaboration: proposal build/approve, messages, change requests, invoices create/send/pay, status controls, review). Admin ProAccountsModule. Profile rows: profile-pro, profile-client-jobs. testIDs throughout (pro-apply-cta, pro-new-job, pro-job-*, job-approve, job-create-proposal, prop-send, inv-create, inv-send-*, inv-pay-*, job-msg-send, proacct-verify-*, proacct-ban-*).
- PAYMENTS: Stripe Connect uses EXISTING platform live key. Real card charging/onboarding NOT testable here (needs pro to complete Connect onboarding in Stripe dashboard). Test all NON-payment flows. pay endpoint correctly 400s when pro not onboarded / 503 if payments unconfigured.
- WeatherAPI key updated (#weather advisories working, 93.9F Austin → hot-paint warning).

## Iteration — Disaster Response & Emergency Support (Sheet #30) (main agent)
- Backend (curl+screenshot verified): GET /api/emergency/scenarios (8 types: flood_water, burst_pipe, fire_smoke, storm_roof, electrical, gas_leak, structural, other). POST /api/emergency/triage {scenario, description, photo_base64?} → AI (_llm_json, gpt-4o-mini fallback) returns safety-first guide {severity call_911|urgent|caution, call_authority, headline, immediate_steps[], do_not[], temp_fix[], document[], when_to_call_pro} + suggested_trade. Logs emergency_events + a timeline entry (type=emergency) for insurance/FEMA. GET /api/emergency/events lists user events. emit_event('emergency_reported').
- Frontend app/emergency.tsx (dark urgent theme): scenario grid → triage guide (severity banner, tel:911 links, numbered steps, Do NOT, temp fixes, insurance docs) → after-triage actions ONLY (Find nearby {trade} pros → /pros?trade=, Ask neighbors → /neighborhood, Home records → /portfolio), "logged" confirmation. Zero commercial push before safety steps.
- Entry points: home red pill (home-emergency) + Profile row (profile-emergency). testIDs: emg-scenario-{key}, emg-desc, emg-find-pros, emg-ask-neighbors, emg-records, emg-new, emg-back.

## Iteration — Notification, Alert & Messaging Center (Sheet #32) (main agent)
- Backend (curl+screenshot verified): push_notification(user_id,title,body,ntype,priority,meta) honors user notif_prefs (safety+urgent override). Wired into events: emergency(safety/urgent), pro proposal sent/approved, invoice sent/paid, change request, neighborhood offer(social). New automation action 'notify'. Endpoints: GET /api/notifications?filter=, GET /api/notifications/unread-count, POST /{id}/read, POST /read-all, DELETE /{id}, GET/PUT /api/notifications/preferences {project,safety,social,promo,system,dnd}. Admin: POST /api/admin/notifications/broadcast {title,body,priority,ntype,segment(all|pro|paying|tag:x)} fan-out (verified 123 recipients), GET /api/admin/notifications/campaigns (read_rate stats).
- Frontend: app/notifications.tsx rebuilt as full Center (filter tabs, urgent ACTION REQUIRED banner, unread dots, mark-all, delete, tap→deep-link to job/neighborhood/emergency, settings sheet with type toggles + DND, safety toggle locked on). Home bell now shows red unread badge (fetched via /notifications/unread-count on focus). Admin NotificationsModule (Broadcast tab: compose + segment/type/urgent + campaigns list). testIDs: notif-filter-*, notif-mark-all, notif-prefs, pref-*, notif-{id}, notif-del-{id}, bcast-title/body/seg-*/type-*/send.
- NOTE: Push & SMS channels are UI-noted as "unlock after device build" — not built (would need Emergent push + native build + google-services.json / Twilio). In-app + email are live.

## Fix — #32 broadcast preference bug (main agent)
- admin_broadcast now loops per-user calling push_notification (honors prefs; safety/urgent override). Verified: promo broadcast blocked for promo=false user (before=2/after=2); urgent safety still delivers. recipients count = actual delivered.
- Home greeting generalized: "what are we working on?" / "Any repair, maintenance job or home upgrade" (was "what are we building").

## Iteration — Wholesaler Admin UI + Loyalty (#34) + Beta/Feature-Flags (#39) (main agent, forked)
- **Wholesaler #32b admin UI (COMPLETE):** SuppliersModule.tsx (RFQs&Orders tab: send quote via PATCH ?status=quoted&quoted_cents=, confirm/fulfill/cancel; Suppliers tab: add supplier + CSV product import + active toggle). Wired admin nav 'suppliers'. Fix: SupplierReq now accepts stripe_account_id (admin form field new-sup-stripe) → completes online-pay loop. Fix: suppliers/[id].tsx shows error+retry (supd-retry) instead of silent back. Tested 14/14 backend + admin UI live.
- **Loyalty & Rewards (#34) COMPLETE:** backend /api/loyalty/me (contribution score projects*2+helps*3+referrals*5, tiers bronze/silver/gold/platinum, 5 badges incl percentile neighborhood_hero, regional impact metrics), /loyalty/leaderboard (opt-in, anonymized), /loyalty/redeem (credit ledger; guide/showcase/pro_week/donation), /loyalty/campaigns (+join awards credits), admin campaigns CRUD + ledger. Referral conversion now awards +50 loyalty credits. Frontend app/loyalty.tsx (4 tabs). Profile row profile-loyalty. Tested 15/15 backend + frontend E2E green.
- **Beta / Feature Flags (#39) COMPLETE:** backend feature_flags (rollout all/optin/user_type/region/off), /api/features, /features/{key}/optin, /beta-feedback (auto-tag bug/friction/suggestion), admin /admin/features CRUD + /analytics. Frontend app/beta.tsx (opt-in + emoji feedback), admin FeaturesModule.tsx (nav admin-nav-features). Profile row profile-beta. Tested 18/18 backend + mobile E2E; admin UI verified via code review (browser auth loop-prevention blocked live admin login, same pattern as verified SuppliersModule).
- Seeds added: seed_loyalty_campaigns (3), seed_feature_flags (3: ar_personalization/bulk_buying/real_estate_mode).
- QUEUED (not started): #34 Real Estate/Listing, #35 Sustainability/Circular, #36 Bulk Buying, #38 AR/Avatar Personalization, #40 Contractor Licensing/Credential Checker, #41 Tool Rental/Peer Lending, #42 Resell/Donation Marketplace.

## Iteration 2 — RealEstate #34 + Circular #35 + Bulk #36 + Personalize #38 (main agent, forked)
- **#34 Real Estate/Listing Mode:** backend /api/realestate/report (reuses portfolio + AI "What's improved" summary cached by project count, value-add estimate w/ disclaimer, DIY/Pro labels, confidence, disclosure checklist), /realestate/share + public/{token}. Frontend app/realestate.tsx (value hero handles $0 invested gracefully). Profile row profile-realestate. TESTED 23/23 backend + frontend E2E (with #35/#36).
- **#35 Sustainability/Circular:** collections material_listings. /api/circular/{meta,listings,mine,listings(POST),{id}/claim,{id}/close,impact,eco-alternatives}. Cross-user claim, self-claim 400, eco impact (waste_lbs/co2_kg), donation write-off est, region leaderboard, green-product catalog w/ certs. Frontend app/circular.tsx (Browse/Impact/Eco Finder/Offer-Ask tabs). Profile row profile-circular. Closing an offer awards +15 loyalty credits. TESTED green.
- **#36 Bulk Buying:** collection bulk_deals, tiered discounts (2→5%,4→15%,6→25%). /api/bulk/{meta,deals,deals(POST),{id}/join,{id}/leave,{id}/close}. Creator auto-joins; close awards +20 credits + notifies participants. Frontend app/bulk.tsx (progress bar to next tier, create/join/leave/lock-in). Profile row profile-bulk. TESTED green.
- **#38 AR/Avatar Personalization:** user.preferences. /api/preferences (GET/PUT), /preferences/preset/{id} (Trusted Foreman/DIY Hero/Safety-First/Silent), /preferences/reset. 12 option groups + jit_coaching. Frontend app/personalize.tsx (avatar preview, presets, option chips, skin swatches). Profile row profile-personalize. Backend curl-verified + lint clean; NOTE: live AR overlay + spoken avatar voice render only in NATIVE BUILD (prefs persist now; rendering MOCKED in Expo Go/web).
- STILL QUEUED (not started): #40 Contractor Licensing/Credential Checker, #41 Tool Rental & Peer Lending, #42 Resell/Donation Marketplace, #43 AR Instruction Builder, #44 Order/Supply-Chain Tracking, #45 Skill Exchange Marketplace. Note #41/#42 overlap heavily with the #35 Materials Exchange (extend it); #40/#45 extend the existing Pro suite (#28).

## Iteration 3 — Personalize #38 + Credentials #40 (main agent, forked)
- #38 AR/Avatar Personalization: /api/preferences (GET/PUT/preset/reset). app/personalize.tsx. Profile row profile-personalize. TESTED 22/22 backend; frontend: fixed missing avatar_skin swatch section. NOTE: live AR/voice rendering = native build only (prefs persist).
- #40 Contractor Licensing/Credential Checker: pro_credentials collection, /api/pro/credentials (GET/POST/DELETE) + compliance, /api/admin/credentials (+counts) + PATCH verify/reject. app/pro/credentials.tsx, admin CredentialsModule (nav admin-nav-credentials), pro dashboard banner (also shown to PENDING pros now). TESTED backend + admin verify E2E green.
- pat_pro_test@diyhomie.com is now status=pending (has a submitted credential) — can submit creds; use admin to verify.
- STILL QUEUED: #41 Tool Rental & Peer Lending, #42 Resell/Donation Marketplace (both extend #35 Materials Exchange), #43 AR Instruction Builder, #44 Order/Supply-Chain Tracking, #45 Skill Exchange Marketplace.

## Iteration 4 — API/Webhook Platform #46 (main agent, forked)
- Added imports hmac/hashlib/Header. Collections: api_keys, webhooks, webhook_deliveries.
- Developer endpoints: /api/developer/{meta,keys(GET/POST),keys/{id}/revoke,webhooks(GET/POST),webhooks/{id}(DELETE),webhooks/{id}/test}. Scoped public API: /api/v1/{me,projects,community} via X-API-Key header (get_api_key_user + _require_scope). Webhooks signed HMAC-SHA256 (X-DIYhomie-Signature); fire_event() helper for real dispatch. Admin: /api/admin/partners (registry + usage totals).
- Frontend app/developer.tsx (API Keys / Webhooks / API Docs tabs; key copy via expo-clipboard). Admin PartnersModule (nav admin-nav-partners). Profile row profile-developer.
- CURL-VERIFIED E2E: create key → v1/me + v1/projects 200, no key → 401, webhook create + test-fire (delivery logged), admin partners totals. Lint clean. Frontend E2E via agent PENDING (pattern-consistent with verified screens).
- STILL QUEUED: #41 Tool Rental & Peer Lending, #42 Resell/Donation Marketplace (extend #35 Materials Exchange), #43 AR Instruction Builder, #44 Order/Supply-Chain Tracking, #45 Skill Exchange Marketplace.

## Iteration 5 — AI Critical Path & Risk Audit #47 (main agent, forked)
- Backend: GET /api/projects/{id}/audit (AI risk/confidence scoring via _llm_json gpt-4o-mini; cached by steps_count+done_count; ?refresh=1 to recompute) returns {risk_score, confidence, path_status, factors[], next_action, reschedule, summary}. POST /api/projects/{id}/reflect (post-mortem card: went_well/pitfalls/next_time).
- Frontend: src/components/RiskAuditCard.tsx (collapsible: run audit CTA → confidence bar, factors w/ level dots, next action, re-run). Rendered in app/project/[id].tsx when project has steps.
- CURL-VERIFIED: audit returns risk 30/confidence 70/5 factors on a demo project. Lint clean. Frontend E2E via agent PENDING (pattern-consistent).
- STILL QUEUED: #41 Tool Rental & Peer Lending, #42 Resell/Donation Marketplace (fold into #35 Materials Exchange), #43 AR Instruction Builder, #44 Order/Supply-Chain Tracking, #45 Skill Exchange Marketplace.

## Iteration 6 — API Monetization, Billing & Usage #48 (main agent, forked)
- Backend: API_PLANS (free 1k/mo, starter $29+overage/20k, enterprise $499/1M). get_api_key_user now meters per-key (period_count reset monthly) + enforces quota (429 on free-plan overrun; usage-billed plans accrue overage). api_usage_daily collection for trend. Endpoints: /api/developer/plans, /developer/usage (per-key usage+quota+cost+14d trend+est bill), /developer/keys/{id}/plan (change), /api/admin/api-billing (plan_counts, MRR, billable, top partners).
- Frontend: developer.tsx new "Usage" tab (est bill, 14-day trend bars, per-key quota bar + plan selector). Admin PartnersModule shows Base MRR + Billable revenue cards.
- CURL-VERIFIED: plans list, plan change→starter, usage $29 base, admin MRR $29. Lint clean. Frontend E2E via agent PENDING for #46/#47/#48 (all backend-verified + pattern-consistent).
- STILL QUEUED: #41 Tool Rental & Peer Lending, #42 Resell/Donation Marketplace (fold into #35), #43 AR Instruction Builder, #44 Order/Supply-Chain Tracking, #45 Skill Exchange Marketplace.

## Iteration 7 — Lifelong Portability & Data Export #49 (main agent, forked)
- Backend: /api/portability/{summary,export,transfer,import,delete-request}, /api/admin/data-requests. Export = full JSON bundle (profile/projects/timeline/community/listings/orders/credentials/ledger/notifications). Transfer token (14d) → import merges into new owner (annotated imported_from, originals preserved). delete-request requires confirm="DELETE" (GDPR audit-logged, non-destructive/queued). data_audit + deletion_requests collections.
- Frontend app/data.tsx (ownership pledge, data counts, export→clipboard JSON, transfer via Share, import code, delete request). Profile row profile-data.
- CURL-VERIFIED E2E: export summary, transfer→import (3 projects+19 timeline merged to pat_pro_test), delete 400 on bad confirm, admin totals {exports:1,transfers:1,imports:1}. Lint clean.
- Session modules total: 12. #46/#47/#48/#49 pending consolidated frontend E2E.

## Iteration 8 — #49 Home Ownership Log (web share) + #51 Agentic Prompt Library (main agent, forked)
- #49 completion: backend already had /api/portability/share + /api/portability/log/{token} (branded print-to-PDF HTML). Added frontend app/data.tsx "Branded Home Ownership Log" section → button testID data-log calls POST /portability/share then opens {BACKEND}/api/portability/log/{token} (web: window.open; native: Linking) + copies URL. CURL-VERIFIED share+log render.
- #51 Agentic AI Prompt Library: resolve_prompt() now backs 6 core AI flows (master_step, full_guide, intake_questions, quick_answer, emergency_triage, image_style) — live-editable, A/B, pausable with safe hard-coded fallback. Collections: prompts, prompt_stats, prompt_audit. seed_prompts on startup.
  - Admin endpoints (require_admin): GET /admin/prompts, GET /admin/prompts/analytics, GET/PUT /admin/prompts/{key}, POST {key}/discard|publish|status|rollback|ab, POST/PUT/DELETE {key}/variants[/{vid}]. Public: POST /prompts/feedback.
  - Approval workflow: PUT saves `pending` (review) → publish moves pending→content, bumps version, keeps history (rollback). status=paused → resolve_prompt falls back to registry default. A/B weighted variant selection + per-variant usage stats.
  - Frontend: src/components/admin/PromptLibraryModule.tsx (list w/ status/risk/version/usage; detail sheet Editor/A/B/History tabs; save draft→approve&publish, pause/resume, variant weights, version restore, audit log). Wired into admin/index.tsx nav admin-nav-prompts.
  - CURL-VERIFIED E2E: list(6 seeded), analytics totals, edit→publish(v2), add variant+ab on, pause, rollback(v3), feedback up. Lint clean. Frontend E2E via testing agent PENDING.

## Iteration 9 — #52 Smart Remodel Kits & AR Project Packages (main agent, forked)
- Backend: collections project_kits, kit_orders. 5 seeded kits (kitchen-mini-makeover, universal-bathroom-refresh, new-deck-build, luxury-vinyl-flooring, accent-wall-lighting). Endpoints: GET /api/kits/meta, /api/kits(list, ?category&q), /api/kits/orders/mine, /api/kits/{slug}, POST /api/kits/{slug}/build (compute Smart Table manifest from option_ids+upsell_ids), POST /api/kits/{slug}/start (creates a real project pre-loaded with curated guide+steps → uses existing AR/step screen, no AI cost; creates kit_order), POST /api/kits/orders/{id}/arrived, POST /api/kits/orders/{id}/leftover (lists leftover materials into circular material_listings as free offers). Admin: GET /api/admin/kits (+order counts), /api/admin/kits/analytics (GMV, completion%), GET/POST/PUT/DELETE + /toggle. require_admin gated.
- Frontend: app/kits.tsx (Browse w/ search+category chips → kit detail sheet w/ optional add-ons + upsells toggles + live Smart Table total + step plan → "Start this project"; My Kits tab w/ progress, "Kit arrived", "List leftovers", "Open guide"). profile-kits row. Admin KitsModule.tsx (analytics + list w/ active toggle + delete + New-kit builder with dynamic components & steps). nav admin-nav-kits.
- Checkout = affiliate/cart links + Smart Table (user will supply affiliate URLs later; no real charge). CURL-VERIFIED E2E: list 5 kits, build manifest, start→project(7 steps+guide,source=kit), arrived, leftover→1 listing, orders/mine. Lint clean. Frontend E2E via testing agent PENDING.

## Iteration 10 — #53 AI Project ROI, Savings & Outcome Insights (main agent, forked)
- Layered on existing `timeline` collection (digital-twin completion log already stores cost_cents, pro_cost_cents, money_saved_cents, hours, room, skill, rating). IMPORTANT: timeline is shared with emergency logs → ROI queries filter project_id present (exclude emergency entries).
- Backend: ROI_BENCHMARKS (resale value-add % + life-years by room), ROI_RECS (seasonal energy/maintenance recs, sourced). _roi_for_entry() computes saved, resale value_add (pro_cost*value_add_pct), roi_pct, effective hourly, + explainable breakdown[]. Endpoints: GET /api/roi/summary (totals + per-project cards + badges Best ROI/Most Efficient/Verified Value + best_project), GET /api/roi/recommendations (season-aware), GET /api/roi/project/{project_id}, GET /api/admin/roi/analytics (by_room avg ROI, shares, testimonials, top_share_drivers) — require_admin.
- Seeded 3 demo completions for demo_home (Kitchen/Bathroom/Deck, demo_roi flag) so dashboard demos with $2,760 saved / 468% avg ROI.
- Frontend: app/roi.tsx (Impact dashboard: hero cumulative, project value cards w/ badges + expandable 'How is this calculated?' breakdown + Share sharecard, seasonal next-ROI recs). profile-roi row. Admin RoiModule.tsx (Value Delivered: totals + ROI-by-room bars + top share/testimonial drivers). nav admin-nav-roi.
- CURL-VERIFIED: summary/recommendations/admin analytics all correct. Lint clean. Frontend E2E via testing agent PENDING.

## Iteration 11 — #54 Smart Training, Quiz & Skill Builder (main agent, forked)
- Backend: collections quizzes, quiz_attempts. 6 seeded quizzes (Tile&Grout, Electrical, Plumbing, Painting, Decking&Outdoor, Safety Basics), each 3 Qs with correct index + explanation + trigger keywords + pass_pct. Endpoints: GET /api/quizzes/meta, /api/quizzes(list w/ passed state), /api/quizzes/for-project/{id} (keyword-matches project title/context to a quiz), /api/quizzes/{id}, POST /api/quizzes/{id}/submit (grades, stores attempt, returns per-Q results+explanations+recommendation advance/remedial, mentor_invite on 100%). GET /api/skills/me (per-topic badges, passed_count, mentor_optin/eligible), POST /api/skills/mentor-optin, GET /api/skills/leaderboard (opt-in named else Anonymous; own name always shown). Admin (require_admin): GET /api/admin/quizzes(+attempt stats), /api/admin/quizzes/analytics (pass rate by topic), GET/POST/PUT/DELETE + /toggle.
- Frontend: app/skills.tsx (Skill Builder hub: mastered badges hero, mentor opt-in card, quiz list → quiz modal with radio Qs → graded results w/ correct/wrong highlight + explanations + retake, leaderboard; accepts ?quizId to auto-open). Contextual: src/components/SkillCheckBanner.tsx rendered on project/[id].tsx (shows when a matching unpassed quiz exists → routes to /skills?quizId=). profile-skills row. Admin QuizzesModule.tsx (analytics + pass-rate-by-topic + list w/ toggle/delete + New-quiz builder with dynamic questions/options/correct-answer/explanation). nav admin-nav-quizzes.
- CURL-VERIFIED: list 6, submit→100% pass→Electrical Pro badge, skills/me, leaderboard, admin analytics. Lint clean. Frontend E2E via testing agent PENDING.

## Iteration 12 — #57 Expert / Mentor / Knowledge Partner Platform (main agent, forked)
- Backend: collections expert_applications, expert_guides + user.expert profile. Endpoints: GET /api/expert/me, POST /api/expert/apply, POST/PUT /api/expert/guides[/{id}], POST /api/expert/guides/{id}/submit (draft→pending). Public: GET /api/knowledge (published feed), /api/knowledge/mentors, /api/knowledge/{id} (views++), POST /api/knowledge/{id}/rate, /flag. Admin (require_admin): GET /api/admin/experts, /api/admin/experts/analytics, POST /api/admin/experts/{id}/review (approve→sets user.expert approved+badge+50 credits), GET /api/admin/knowledge, /api/admin/knowledge/flags, POST /api/admin/knowledge/{id}/review (publish/reject/obsolete; publish +25 author credits), DELETE. Only approved experts can author; publish requires admin QA (approval workflow).
- Frontend: app/expert.tsx (apply form → pending state → approved workspace: badge/credits hero + my guides + New-guide builder + submit-for-review). app/knowledge.tsx (Pro Guides feed w/ search/category + guide detail modal w/ steps/safety + star rating + report/flag; Mentors tab). Admin ExpertsModule.tsx (Applications approve/reject, Guide QA publish/reject/obsolete/delete, Flags review, analytics). profile-knowledge + profile-expert rows. nav admin-nav-experts.
- CURL-VERIFIED full lifecycle: apply→admin approve→create guide→submit→admin publish→public feed(1)→detail/rate/flag→mentors(1)→analytics→flags(1). Lint clean. Frontend E2E via testing agent PENDING. Note: demo_home is now an approved Certified Pro (Electrical & Lighting) with 1 published guide from curl testing.

## Iteration 13 — #59 Activity Audit Logging & Transparency + DELETE project (main agent, forked)
- NEW MODULE /app/backend/audit_engine.py (keeps server.py lean). Wired in server.py: audit_engine.configure(db,logger,JWT_SECRET_KEY,JWT_ALGORITHM); include build_user_router(get_current_user) + build_admin_router(require_admin); app.middleware("http")(audit_engine.audit_middleware). Indexes added for audit_events/audit_alerts/consent_registry.
- Auto HTTP logging middleware: logs mutations (POST/PUT/PATCH/DELETE) + logins; categorizes by path; resolves actor from JWT (user/admin) or X-API-Key (partner); risk scoring (high/medium/low); skips noisy GET/telemetry paths. Collections: audit_events, audit_alerts, consent_registry.
- Risk/alerting: rapid_resource_delete (>=8/60s), rapid data_export (>=5/60s), api_key_created, data_export, data_deletion → audit_alerts (status open) + admin resolve.
- User transparency: GET /api/audit/me (events+data-use summary+consents), GET /api/audit/me/export (full JSON, self-logs export), GET/POST /api/consents (marketing/analytics/cookies/data_processing/personalization).
- Admin: GET /api/admin/audit (q/category/event/actor/risk/date filters+paging), /analytics (by_category/risk/actor_type, top_actors, open_alerts), /alerts, /alerts/{id}/resolve, /user/{user_id} (partner debugging trail).
- Frontend: app/privacy.tsx (consent toggles, data-use chips, activity feed, export) + profile-privacy row. Admin AuditModule.tsx (Event Log w/ search+risk/category filters, Analytics bars, Alerts w/ resolve) → nav admin-nav-audit.
- ALSO FIXED: DELETE /api/projects/{project_id} (owner delete + cascade timeline; 404 for non-owner) — resolves prior 405.
- CURL-VERIFIED E2E: consents set, events auto-logged (login/consent/project create+delete), admin query/analytics/alerts, rapid-delete + export alerts fired, resolve OK, user trail. Lint clean. Frontend E2E via testing agent PENDING.

## Iteration 14 — #60 DIYhomie Verified Certification & Credentialing (main agent, forked)
- NEW MODULE /app/backend/certification_engine.py (keeps server.py lean). Wired: configure(db,logger); include build_user_router(get_current_user)+build_public_router()+build_admin_router(require_admin). Indexes for certificates. Auto-issue hooked into POST /projects/{id}/complete via certification_engine.issue_for_completion(). Uses audit_engine.log_event for issue/share/revoke.
- Collection: certificates {user_id, kind, title, project_id, room, skill, cost/saved/hours, milestones, safety_flags, code_compliant, pro_validated, status active|revoked, issued_at, share_token, level_at_issue}. Verified tiers: verified(>=1)/advanced(>=3)/master(>=5 or 3 pro-validated).
- User endpoints: GET /certifications (status+list), /certifications/status, /certifications/eligible (completed projects w/o cert), POST /certifications/generate {project_id}, POST /certifications/{id}/share (token+URL). Public: GET /certifications/verify/{token} (branded print-to-PDF HTML) + ?format=json verification. Admin: GET /admin/certifications(+q,status), /analytics (tiers/by_room/verified_users), POST /{id}/revoke{reason}, /reinstate, /validate (pro).
- Frontend: app/certifications.tsx (Verified status hero, ready-to-certify list, cert cards w/ badges + open branded cert, profile-certifications row). Admin CertificationsModule.tsx (issued/tiers/by-area analytics + search + revoke/reinstate/validate) nav admin-nav-certs.
- CURL-VERIFIED E2E: status unverified→verified after issue, generate, list, share token, public verify JSON+HTML, admin list/analytics/validate/revoke(→user unverified)/reinstate, non-admin 403. Lint clean. Frontend E2E via testing agent PENDING.
- QUEUED next: #61 Beta Launch/Guided Onboarding & First-Touch Support, #62 AI Pro Pricing Calculator & Quote Engine.

## Iteration 15 — #62 Education Center & Learn-to-DIY Content Hub (main agent, forked)
- NEW MODULE /app/backend/education_engine.py (keeps server.py lean). Wired: configure(db,logger); include build_user_router(get_current_user)+build_admin_router(require_admin); seed_education() in startup; indexes for edu_lessons/edu_progress.
- Collections: edu_tracks {slug,title,level,category,icon,order,summary,status}, edu_lessons {id,track_slug,title,order,level,est_minutes,summary,sections[],flashcards[{term,def}],tools[],safety[],quiz_id(link to #54),micro_cert,status,version,author}, edu_progress {user_id,lesson_id,track_slug,status started|completed,completed_at,micro_cert}. Seeded 3 tracks / 4 lessons; lessons auto-link to matching #54 quizzes.
- User endpoints: GET /education/tracks (progress %), /education/tracks/{slug} (lessons+completed flags), GET /education/lessons/{id} (marks started), POST /education/lessons/{id}/complete (logs via audit_engine, returns micro_cert+quiz_id+next_lesson+progress), GET /education/me (dashboard: completed/badges/>=3 suggested/recent). Admin: GET /admin/education, /analytics (completions/learners/by_track), CRUD tracks+lessons, PUT lesson bumps version, POST lessons/{id}/toggle publish.
- Frontend: app/education.tsx (dashboard stats, recommended lessons, curriculum track cards w/ progress bars, track-detail modal, lesson-reader modal w/ steps+flashcards+safety, complete→optional quiz deep-link /skills?quizId=). profile-education row. Admin EducationModule.tsx (stats, completions-by-track bars, per-lesson publish/unpublish + version) nav admin-nav-education.
- CURL-VERIFIED E2E: tracks list w/ progress, open+complete lesson (progress 0→50%, micro_cert, next lesson, quiz link), dashboard (1 done,1 badge,3 suggested), admin list/analytics, non-admin 403. skills.tsx already reads ?quizId param (deep-link works). Lint clean. Frontend E2E via testing agent PENDING.

## Iteration 16 — #63 Sponsored Learning, Campaigns & Brand Collaboration Suite (main agent, forked)
- NEW MODULE /app/backend/campaign_engine.py. Wired: configure(db,logger); include build_user_router(get_current_user)+build_admin_router(require_admin); seed_campaigns() in startup; campaign_participation indexes. Uses audit_engine.log_event for join/complete/consent.
- Collections: campaigns {id,slug,title,sponsor_name,theme,description,product_tag,featured_pro,status draft|active|ended,reward{badge,discount_code,credit},milestones[{id,title,type lesson|task,ref_slug,points}]}, campaign_participation {campaign_id,user_id,completed_milestones[],status joined|completed,reward_claimed,reward_code,story_opt_in,story}. Seeded 2 active campaigns (smart-lighting-month, prep-for-winter) tied to #62 education tracks.
- User endpoints: GET /campaigns (active w/ my progress), GET /campaigns/me (badges), GET /campaigns/{slug} (milestones w/ completed + auto_ready for lesson type verified against edu_progress), POST /campaigns/{slug}/join, POST /campaigns/{slug}/milestone/{mid}/complete (lesson milestone requires linked track completed; all done -> status completed + reward + discount code), POST /campaigns/{slug}/story-optin (consent-gated). Admin: GET /admin/campaigns (participants/completions), POST create, PUT update, POST /{id}/toggle active<->ended, DELETE, GET /{id}/analytics (joined/completed/completion_rate/story_optins/milestone_funnel/consented stories).
- Frontend: app/campaigns.tsx (reward badges, active campaign cards w/ progress, detail modal: sponsor/featured pro/reward/milestones w/ claim + consent story switch + join). profile-campaigns row. Admin CampaignsModule.tsx (list + toggle + analytics w/ funnel + consented stories) nav admin-nav-campaigns.
- CURL-VERIFIED E2E: list, join, milestone complete (lesson auto-verified via #62, then task -> 100% + Winter-Ready badge + WARM20 code), story opt-in, my badges, admin list/analytics/funnel/stories, non-admin 403. Re-published edu lesson toggled during prior tests. Lint clean. Frontend E2E via testing agent PENDING.

## Iteration 17 — #63 (v2) Sponsored Brand Partnership & Product Campaign extension (main agent, forked)
- EXTENDED campaign_engine.py (no duplicate module) to fully cover the second "#63" spec (Sponsored Brand Partnership & Product Campaign Engine):
  - Product-offer CTA: campaigns now have cta {label,url,type buy|sample|warranty|coupon|booking}; seeded/backfilled on both campaigns. NEW POST /campaigns/{slug}/cta-click (logs attribution via campaign_events + audit_engine, returns url).
  - Sentiment/feedback: NEW POST /campaigns/{slug}/feedback {rating 1-5, learned_something, comment} (upsert per user).
  - Partner dashboard analytics now returns cta_clicks, feedback_count, avg_rating, learned_pct, comments (+ existing joined/completed/funnel/consented stories/story_optins).
  - CampaignReq gains cta field for admin create/update.
- Frontend campaigns.tsx: detail modal now shows product-offer CTA button (camp-cta → opens URL + logs click) + "Sponsored content · never charged" transparency note. Admin CampaignsModule analytics shows CTA clicks / Avg rating / Learned %.
- CURL-VERIFIED: cta present on detail, cta-click returns url + logs, feedback recorded, admin analytics shows cta_clicks=1, avg_rating=5.0, learned_pct=100, comment captured. Lint clean.

## Iteration 18 — #64 Data, Analytics & Project Reporting Export Engine (main agent, forked)
- NEW MODULE /app/backend/export_engine.py. Wired: configure(db,logger); include build_user_router(get_current_user)+build_public_router()+build_admin_router(require_admin); export_jobs token index. Uses audit_engine.log_event for export + download.
- User endpoints: GET /export/options (7 data types + per-user counts + formats), POST /export/generate {types[],date_from,date_to,format json|csv,share,expires_days,max_downloads} -> returns summary + data/csv; if share -> creates export_jobs {token,bundle,expires_at,max_downloads,download_count} + share.download_url/report_url. Public: GET /export/download/{token} (validates expiry + download limit, increments count, logs), GET /export/report/{token} (branded printable HTML report). Admin: GET /admin/export/kpis (platform KPIs incl total_member_savings_usd), GET /admin/export/jobs.
- Data types: projects, timeline, events(audit), skills(edu_progress), campaigns(participation), certificates, notifications. CSV built from timeline (date/project/room/skill/cost/saved/hours).
- Frontend: app/export.tsx (type checkboxes w/ counts, JSON/CSV toggle, Copy export + Create secure share link→opens printable report). profile-export row. Admin ExportModule.tsx (KPI grid + Copy KPIs JSON + recent export jobs w/ download counts) nav admin-nav-export.
- CURL-VERIFIED E2E: options (counts), generate json+share (token+expiry), generate csv (24 rows), download (audit logged), report HTML, admin kpis (users123/savings$3125), non-admin 403. Lint clean. Frontend E2E via testing agent PENDING.

## Iteration 19 — #65 Integration App Store (main agent, forked)
- NEW MODULE /app/backend/appstore_engine.py (complements EXISTING developer/partner API layer: api_keys, /api/v1, plans, metering, /admin/partners, /admin/api-billing). Wired: configure(db,logger); user + admin routers; seed_appstore() in startup (fixed a bad seed line that had crashed startup: `await export_engine and campaign_engine...` -> restored proper education+campaign+appstore seeds). Uses audit_engine for install/uninstall (risk medium).
- Collections: integrations {id,slug,name,category,publisher,pricing free|paid,price_label,description,capabilities[],scopes[],icon,status draft|published,version}, integration_installs {integration_id,slug,user_id,status active|disabled,consent_scopes[],installed_at,disabled_at}. Seeded 5 add-ons (NWS alerts, energy tracker, advanced analytics, pro scheduling, insurance sync).
- User: GET /appstore (browse published + installed flags + categories), GET /appstore/installed, GET /appstore/{slug}, POST /appstore/{slug}/install (consent scopes + audit), POST /appstore/{slug}/uninstall (instant revocation + audit). Admin: GET /admin/appstore (+install counts), GET /analytics (installs/paid/by_integration), POST create, PUT update (version bump), POST /{id}/toggle publish, DELETE.
- Frontend: app/appstore.tsx (category filter, add-on cards, detail modal w/ capabilities + permissions + transparency + connect/disconnect). profile-appstore row. Admin AppStoreModule.tsx (stats + catalog publish toggle + top installed) nav admin-nav-appstore.
- CURL-VERIFIED E2E: browse(5,cats), install, installed list, uninstall, admin list+analytics, non-admin 403, education still seeded(3 tracks). Fixed corrupted StyleSheet tail + missing render line in admin/index.tsx. Lint clean. Frontend E2E via testing agent PENDING.
- NOTE: Enterprise API/data-exchange half of #65 already existed (developer keys/plans/metering); this adds the browsable App Store + consent install/revoke.

## Iteration 20 — #67 DevOps Monitoring & Platform Reliability (main agent, forked)
- NEW MODULE /app/backend/monitoring_engine.py (admin/founder ops). Wired: configure(db,logger); build_admin_router(require_admin); app.middleware("http")(monitoring_middleware) which times every /api request, keeps in-proc counters (requests/errors/latency/by_status) and persists status>=400 to error_events. Indexes: error_events, incidents.
- Admin endpoints: GET /admin/monitoring/health (DB ping+latency, uptime, error_rate, service statuses, status healthy|degraded|critical + error_rate_alert), GET /metrics (requests/errors/error_rate/avg+p95 latency/by_status), GET /errors (recent + top_failing + total), POST /incidents {title,severity}, GET /incidents(status), POST /incidents/{id}/resolve.
- Frontend: admin MonitoringModule.tsx (status card + services + live metrics + status-bucket badges + top failing + recent errors + incident log/resolve + refresh). nav admin-nav-monitoring. Admin-only (no user screen).
- CURL-VERIFIED: 404 captured → error_events; health(degraded w/ err_rate 33% on tiny sample), metrics(reqs/errors/avg/p95/by_status), errors(top_failing), incident create+resolve, non-admin 403. Lint clean.
- SCOPE NOTE: auto-scaling & code rollback need infra/hosting control not available here; surfaced as advisory thresholds + note to connect Sentry/DataDog. Self-verified via curl (admin-only feature).

## Iteration 56 — Blueprint 09: Subscription Access, Feature Gating & Billing (main agent, forked)
- NEW MODULE /app/backend/subscription_engine.py (HI-facing). Wired in server.py: import + configure(db,logger) + include_router(build_router(get_current_user)) after onboarding (B08). Reuses EXISTING tested Stripe checkout/webhook/portal in server.py — owns NO payment secrets.
- Tiers free/starter/pro derived from user.subscription_tier (master→pro). Added "starter" ($9, lookup diyhomie_starter_monthly) to PLAN_TIERS alongside pro ($12).
- Entitlement matrix LIMITS (free/starter/pro): homes 1/3/∞, projects 3/25/∞, chat_daily 15/100/∞, inventory 25/250/∞, documents 10/100/∞ + flags reminders/code_check/export/priority_ai.
- Shared gate: check(user,feature) + enforce(user,feature)→HTTPException(402). Wired enforce into: conversation_hub send_message ("chat" daily), project_planner /start ("project"), onboarding create_property ("home").
- Endpoints: GET /api/hi/subscription/me (tier, plan, limits, usage snapshot, status), GET /api/hi/subscription/plans (catalogue w/ highlights + current flag).
- CURL-VERIFIED (demo_home@diyhomie.com free tier): /me returns tier free + usage; /plans lists free/starter($9)/pro($12); project start → 402; property create → 402. Backend reloaded clean, routes registered.
- FRONTEND: NEW app/home-intel/upgrade.tsx paywall (usage bars, plan cards w/ highlights, Choose Starter/Pro → POST /billing/checkout {tier,origin_url} via WebBrowser mirroring existing app/paywall.tsx, Manage billing → /billing/customer-portal). "Your plan" card added to home-intel/account (→ /home-intel/upgrade). 402 handling added to chat/[id].tsx, projects/start.tsx, account/index.tsx addHome → Alert w/ "See plans" → /home-intel/upgrade. Lint clean. Unauth render smoke OK.
- PENDING: frontend E2E via testing agent (login flow → paywall render w/ real plans/usage, gating alerts). Home Switcher shortcut + First Run banner on home-intel/index.tsx also PENDING authenticated verification.
- NOTE: Stripe key in pod is a LIVE key (sk_live) — do NOT complete real checkout in tests; only verify checkout URL/session creation.

## Iteration 57 — B09 paywall funnel WEB fix + First Run banner (retest, PASS)
- FIX: Alert.alert is a no-op on react-native-web → added src/utils/paywall.ts showLimitReached() (window.confirm on web, Alert on native). Wired into account addHome, projects/start, chat send 402 handlers.
- RETEST PASS (demo_home, web): Home limit 402 → confirm 'Home limit reached' → routes /home-intel/upgrade; Project limit 402 → confirm → routes to paywall; First Run banner (onboarding_complete flipped false for demo) renders '50%' on /home-intel and taps to /home-intel/welcome; upgrade screen re-confirmed (Free/Starter $9/Pro $12 + 5 usage bars). No critical/minor bugs. Report iteration_57.json.

## Iteration 58 — B09 subscription experience: Perks + Upgrade Nudges + Guided Walkthrough (PASS)
- Guided Walkthrough: NEW /home-intel/welcome.tsx (fixes previously-broken banner link to non-existent route). Reads /hi/account/overview onboarding.steps; celebratory stepper (progress bar, per-step CTA→setup screens, done=strikethrough+green check), welcome-finish POSTs /hi/account/onboarding/complete → /home-intel. testIDs welcome-step-*/welcome-cta-*/welcome-finish.
- Upgrade Nudges: dashboard (/home-intel) fetches /hi/subscription/me; computes highest over/near-limit count feature (>=80%); renders warning banner hi-upgrade-nudge → /home-intel/upgrade. Hidden for pro.
- Plan Perks: NEW /home-intel/perks.tsx. Backend /hi/subscription/me now returns perks[] (label+included per current tier). Free/starter also fetch /plans pro highlights as 'Unlock with Pro' locked list + perks-upgrade CTA. account-plan-card routes free→upgrade, paid→perks.
- ALL PASS via testing agent (demo_home free tier). Lint clean. Report iteration_58.json. (Testing flipped demo onboarding_complete=true at finish — expected.)
