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
