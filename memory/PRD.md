# DIYhomie — Product Requirements (living doc)

## North Star / Purpose
People come to DIY sites frustrated: generic guides, walls of text, info scattered across
many sites, nothing specific to *their* exact situation. DIYhomie fixes this by being like
**an expert master contractor standing right next to you** — who knows everything about
construction, budget, time, and local codes, and only ever shows the right info at the right
moment so you're never overwhelmed or confused.

### Core promise (what makes us different)
1. **Hyper-specific guides** — references the user's EXACT fixture/model (e.g. "American
   Standard Cadet 3 model #2886") and that product's real install instructions, not generic steps.
2. **Context-aware** — adapts to the user's situation (e.g. installing on a concrete basement
   floor → what to do differently), tools owned, experience, budget, location/codes, weather.
3. **Conversational** — ask a simple plain-language question and get an expert answer, as if a
   pro were right there. No reading blobs or hunting across sites.
4. **Progressive disclosure** — show text / images / step-by-step only at the right time; never
   dump everything at once. Never overwhelm.
5. **Adaptive** — if something comes up mid-project ("I have this issue…"), the avatar adjusts
   and can **update the step-by-step guide dynamically**.
6. **Outcome-focused** — get the user from start → completed project as easily as possible,
   saving money and time.

Goal: solve the real pain points of existing DIY platforms with solutions people grow to love.

## Tech stack
- Frontend: Expo (React Native + RN Web), expo-router, react-native-reanimated, react-native-svg,
  expo-location, i18next/react-i18next + expo-localization.
- Backend: FastAPI + Motor (MongoDB), JWT auth, Emergent Google Auth, Stripe (LIVE keys).
- AI: Perplexity Sonar Pro (guides, live web) with OpenAI gpt-4o-mini fallback via EMERGENT_LLM_KEY;
  OpenAI gpt-image-1 for step images. WeatherAPI.com for weather.

## Shipped
- Onboarding funnel (onboarding → survey [MadMuscles-style] → analysis → auth → demo → paywall/free).
- Emergent Google Auth + JWT email/password.
- AI structured guides (overview/tools/materials/safety/code_alert/steps[title,instruction,
  visual_description]/common_mistakes/troubleshooting/inspection_checklist). Step image gen.
- ASK HOMIE Q&A per project. Weather-aware guide generation + WeatherBanner.
- Universal Avatar communication layer (state machine + AvatarThinking).
- Stripe recurring subscriptions (Pro/Master monthly).
- Support ticket submit (POST /api/support/ticket).
- **i18n**: 20 USA languages, device-language auto-detect, in-app language switcher
  (/settings/language), AI guides/answers generated in the user's chosen language.
- Home header: notification bell + hamburger AppMenu (support/legal/language links).

## Backlog (requested by user — awaiting prioritization / admin email)
- **A. SEO Blog Platform**: every generated guide auto-repurposed into a polished, anonymized,
  SEO-optimized blog post (categories, tags, keywords). Backend-rendered HTML pages + sitemap.xml
  for Google + in-app blog feed. Auto-publish vs admin-approve (TBD). User opt-out toggle.
- **B. Share & Earn referrals**: active paid users get a referral link; $5 Stripe credit per
  converted referral (Stripe customer balance → auto-applies to next invoice, carries over, survives
  lapse). Unlimited. Confetti on reward. Possible double-sided (new user perk).
- **C. Feedback widget**: floating, non-obtrusive; bug / feature idea / other + message
  (+ optional screenshot / contact). Feeds the admin workstation.
- **D. Admin Workstation (web-only, owner-gated `/admin`)**: left-side nav panel housing all admin
  modules — Support Tickets, Blog Curation, Feedback triage, Referrals/Accounting (live Stripe),
  Autoresponder (needs Resend/SendGrid key). This is the home for the admin side of A/B/C.

### Core-experience upgrades to fully deliver the North Star (high leverage)
- **Model/product-specific intake**: capture exact brand+model (and surface/site context like
  "concrete basement floor") and have the AI reference that product's real instructions.
- **Dynamic guide adaptation**: when user reports a snag in ASK HOMIE, let Homie revise the
  affected step(s) / insert new steps in the live guide (not just answer in chat).
- **Smarter progressive disclosure**: reveal images/sub-steps on demand at the right moment.

## Notes / constraints
- Admin role-gating + any auth/seed changes MUST go through integration_expert.
- Stripe is LIVE — test referral credit flow in Stripe TEST mode first.
- Only core chrome is translated so far (tabs, home, menu, notifications, ticket); other screens
  still English (incremental rollout).
- Pending user decisions: build order (A/B/C/D + core upgrades) and the admin email to gate /admin.

## Shipped (continued)
- **Core Magic** (the North-Star differentiator): (1) conversational model-aware INTAKE before guide build (POST /api/projects/{id}/intake → 2-4 tailored questions); (2) CONTEXT-AWARE guide gen (POST /guide accepts {context}); (3) DYNAMIC GUIDE ADAPTATION (POST /api/projects/{id}/adapt — Homie revises/inserts steps when user reports a problem; UPDATED badges). Tested iteration_7.
- **Home Memory** (agentic recall): per-user room-tagged memory snippets (capped 40, server-only). Relevant memories injected into intake/guide/adapt prompts; cross-room isolated. Intake returns `remembers` → "🧠 Homie remembers" banner. Tested iteration_8 (4/4 pytest).

## Still-queued backlog (unbuilt): A. SEO Blog Platform, B. Share & Earn referrals, C. Feedback widget, D. Admin Workstation (needs admin email). Also progressive-disclosure polish.

## Shipped (continued 2)
- **SEO Blog Platform + Social Share + Funnel**: guides auto-repurpose into anonymized SEO posts (category/tags/keywords). In-app /blog feed + reader; crawlable SEO HTML at /api/blog/{slug}/html (HowTo+Article JSON-LD, OG/Twitter, canonical https, sitemap.xml, robots.txt). Social share (X/FB/WhatsApp/Reddit/Email/Copy + in-app native share). Strong CTA funnels readers → signup/"Start this with Homie". Menu entry "DIY Guide Library". Tested iteration_9 (6/6 backend + frontend).

## Shipped (continued 3)
- **Share & Earn referrals (COMPLETE)**: backend was done (link_referral, Stripe Customer Balance credit on subscription activation, GET /api/referrals/me, $5/500¢ reward). Added FRONTEND: /referrals screen (code + invite link, Copy via expo-clipboard, native Share, stats, available credit, confetti via react-native-confetti-cannon), entry points in Profile tab card + hamburger menu. Referral capture: ?ref=CODE captured at app load (web+native) → stored → sent in POST /auth/register. Tested iteration_11.
- **Project Communities v2 (AI-first community, Phase 1 = PROJECTS)**: replaces old Pro-Earn forum tab. Vision = Products/Projects/People living knowledge base; AI answers first, community adds real homeowner proof. Phase 1 shipped: 12 seeded project communities (community_seed.json) w/ stats (completed/avg time/difficulty/avg cost/success), top_questions, common_mistakes, helpful_tips, seeded experiences + Q&A threads (hybrid "looks busy" data). Real users: POST experiences (computed badge: Verified Installer/Experienced DIYer/Master Builder), cheer, ask questions, reply ("Ask someone who's done this"). Reputation badges via CommunityBits. AI-first CTA on each community creates a project → /project/{id}. Endpoints: GET /community/projects, GET /community/feed, GET /community/projects/{slug}, POST experiences/cheer/threads/replies. Startup seed_community() idempotent + indexes. Tested iteration_11 (14/14 pytest + frontend).

## Community roadmap (remaining phases — NOT built)
- Phase 2: PRODUCT communities (per-product pages: install count, real photos, recommended accessories, "Ask previous installers"), product micro-communities.
- Phase 3: PEOPLE deepening (Verified Owner/Installer proof uploads, Pro verification, leaderboards, titles, rewards/free months), DM/connect.
- AI cites community stats in guides ("Based on N installations…"); journals auto-publish toggle (user chose: keep manual for now).

## Backlog (unchanged): split server.py (~2135 lines) into routers; migrate base64 images → S3/CDN; Facebook auth; password reset email; LiveKit voice avatar.

## Shipped (continued 4) — Internal CRM + Vendor/Subscription DB (admin, web-only)
- **User CRM (Contacts)** module in /admin: auto-profile per user enriched live (plan, membership/billing status, LTV from payment_transactions, projects created/completed, last login/activity, community contributions, location). Dashboard stat cards. Auto **smart segments** (New/Trial/Monthly/Annual/Expired/Canceled, Inactive 30/60/90, Highly Active, Community Contributors, High Value, Power Users, + category-interest Plumbing/HVAC/Electrical/Appliance/Bathroom/Deck/Painting from project titles). Search + segment filter + sort. Contact drawer: PROFILE (editable phone/country/state + tags), TIMELINE (chronological events), NOTES (add/delete internal notes).
- **Vendor & Subscription DB** module: full CRUD + documentation repository per vendor (purpose, api-keys location, internal notes, warnings, dependencies). Vendor dashboard (monthly/annual spend, critical count, by-category, upcoming renewals). Pre-seeded 7 real vendors (Perplexity, OpenAI, Anthropic, Stripe, MongoDB, WeatherAPI.com, Emergent) via vendor_seed.json, idempotent on startup.
- Endpoints (all admin-gated, 401/403 enforced): GET /admin/crm/stats, GET/PUT /admin/crm/contacts(+/{id}), POST /admin/crm/contacts/{id}/tags, POST /admin/crm/contacts/{id}/notes, DELETE /admin/crm/notes/{id}; GET/POST/PUT/DELETE /admin/vendors(+/{id}), GET /admin/vendors/stats.
- Lightweight **last-login tracking** added to /auth/login, /auth/register, /auth/google. Marketing automation = architecture-ready only (not sending).
- Tested iter_12: 23/23 backend pytest + full frontend E2E. Files: src/components/admin/CrmModule.tsx, VendorsModule.tsx; app/admin/index.tsx (sidebar +CRM +Vendors).

## CRM/Vendor roadmap (future): email/SMS campaign sending (needs Resend/SendGrid), drip/onboarding sequences, sales pipelines, affiliate management, support-ticket deep integration, BI dashboards, revenue forecasting.
## Tech-debt (growing): server.py now ~2572 lines — split into routers (auth/projects/ai/billing/admin/blog/community/crm/vendors) is now high priority.

## Shipped (continued 5) — Paint/Finish Visualizer (Decor8 AI)
- New **Paint Studio** screen (/app/frontend/app/paint-studio.tsx): upload/snap a room or exterior photo → AI recolors it. Features: Walls, Exterior, Cabinets, Flooring. Color selection = curated Sherwin-Williams / Benjamin Moore / Behr palettes + custom hex; Flooring uses finish swatches (mahogany/oak/laminate/walnut/marble/slate). Press-and-hold "before" compare. Room-type selector for walls. Affiliate-ready "Everything you'll need" shopping list (Home Depot/Lowe's — coming soon, user will add those APIs later for commission).
- Backend (server.py, Decor8 section): POST /api/visualize (auth), GET /api/visualize/history. Proxies Decor8 (key in backend/.env DECOR8_API_KEY, never exposed to client). Endpoints: /change_wall_color (param wall_color_hex_code — note: live API differs from public docs), /change_kitchen_cabinets_color (cabinet_color_hex_code), /generate_designs_for_room (prompt-based) for flooring/exterior. Accepts base64 data URI OR public URL; response parsed from info.images[0].url. httpx async, 90s timeout. **First render free per user, then 4 credits**; 402 when out. Stores visualizations collection.
- Entry points: Home 'PAINT STUDIO' banner + hamburger menu. app.json: added camera/photo permissions + expo-image-picker plugin.
- Integrated strictly via integration_playbook_expert. Tested iter_13 (9/9 backend pytest live + frontend E2E). Decor8 calls cost ~$0.20 each (real money).

## Decor8 roadmap: exterior/flooring quality tuning; Home Depot + Lowe's affiliate product hookup on the shopping list (user-provided APIs) for commission; tie visualizations to a project/Home Memory.

## Shipped (continued 6) — DIY Calculators
- Data-driven calculator engine: src/calculators/registry.ts (26 calculators w/ real formulas) + one shared renderer src/components/CalculatorRunner.tsx (live inputs -> results + SHOPPING LIST w/ qty). Categories: Painting & Walls, Flooring & Tile, Outdoor & Landscape, Concrete & Masonry, Framing & Carpentry, Roofing & Gutters, Other. Calcs include: paint, wallpaper, drywall, insulation, flooring, tile, deck, fence, mulch/soil, gravel, grass-seed, concrete-slab, post-hole, brick/block, framing, stairs, trim, crown-molding, roofing, gutter, pool volume, cabinet hardware, tool rent-vs-buy.
- Standalone hub /calculators (search + grouped) + page /calculators/[id]. CONTEXTUAL POPUP: src/components/CalculatorSheet.tsx + calculatorForProject(title) keyword map auto-shows the matching calculator inside a project guide ("Estimate materials for this project" banner -> bottom sheet). Pure client-side math, offline.
- Entry points: Home banners (Paint Studio + DIY Calculators), hamburger menu items, project-guide contextual banner.
- Each calculator outputs a shopping list (qty) — architected to later auto-fill Home Depot/Lowe's quantities for affiliate commission.
- Tested iter_14 (frontend). Fixed post-test: restored SAFETY conditional JSX wrapper in project/[id].tsx, tightened cabinet-hardware keyword (was matching 'doorknob'), fixed invalid deck icon (-> floor-plan). All lint-clean.

## Calculators roadmap: add long-tail/engineering calcs (electrical load NEC, beam/joist span, septic, refrigerant, paver patio, retaining wall, BTU/HVAC sizing, etc.); AI chat/avatar auto-trigger the right calculator at the right step; pipe calculator qty into HD/Lowe's affiliate cart.

## Shipped (continued 7) — Home Maintenance Scheduler (HomeZada-inspired)
- New /maintenance screen: "Generate my plan" populates a curated recurring seasonal schedule (~20 tasks across HVAC/Plumbing/Exterior/Safety/Appliances/Electrical/Lawn) with frequency, due dates, est. cost. Tasks grouped OVERDUE / DUE THIS MONTH / UPCOMING. Complete (circle check) logs spend + rolls recurring tasks forward by frequency (once-tasks delete). Add/edit/delete custom tasks (FAB + edit sheet). Budget summary: on-track status, overdue/due counts, annual maintenance budget (sum of est_cost × occurrences/yr) vs spent-YTD progress bar.
- Backend (server.py Home Maintenance section): /api/maintenance/generate (idempotent), /tasks (GET/POST), /tasks/{id} (PUT/DELETE), /tasks/{id}/complete, /summary. Collections: maintenance_tasks, maintenance_log. Added `from pymongo import ReturnDocument`. FREQ_PER_YEAR/FREQ_DAYS + MAINTENANCE_TEMPLATE (20 tasks). Status computed from next_due (overdue/due_soon<=30d/upcoming).
- Entry points: Home 'MAINTENANCE SCHEDULE' banner + hamburger menu 'Maintenance Schedule'.
- Tested iter_15: 16/16 backend pytest + full frontend E2E. Schedule is template-driven (deterministic, free) — AI-personalization (climate/home-age aware + auto-add from completed projects) is the next layer.

## Maintenance roadmap: AI-personalize the plan (use Core Magic intake: home age, systems, climate/location) and auto-create tasks from completed projects; reminders; tie task costs into annual budget forecasting in the CRM/admin.

## Shipped (continued 8) — Location-aware Local Code Check (Perplexity)
- Backend POST /api/code-check (auth): injects user's location into a structured "municipal building inspector" system prompt, calls Perplexity sonar-pro (live web search) to find the adopted IRC/IBC/NEC/plumbing code cycle + local amendments + permit rules, returns STRICT JSON {code_basis, answer, requirements[], permit_required, confidence, citations[], disclaimer}. Saves to code_checks collection. project_needs_code() keyword gate. Returns 503 if PERPLEXITY_API_KEY missing (does NOT fall back to non-search LLM — avoids hallucinating legal codes).
- Frontend src/components/CodeCheckCard.tsx: shown ONLY on project guides whose title needs code compliance (projectNeedsCode keyword match). Question input, spinning-wrench loading ("Searching <city> codes…"), result with code-basis chip, confidence badge, requirements, permit badge, clickable source citations, and a verify-with-building-dept disclaimer. Handles 503 gracefully ("turns on once Perplexity is connected").
- Wired into app/project/[id].tsx after the calculator banner.

## Shipped (continued 9) — User Profile & Dashboard + Self-Serve Billing
- Profile tab redesigned into a dashboard: credits/voice counters, ACTIVE/COMPLETED project stat cards, MANAGE ACCOUNT menu (Billing & Plan, My Projects, My Support, Share & Earn, Language, Help & FAQ), profile facts, tool shed, location editor, upgrade banner (free tier only), logout.
- New /settings/billing screen: current plan + status + renewal date, "Manage billing & card" → Stripe-hosted Customer Portal (card/invoices/cancel), referral credit balance, plan comparison, payment history. New /support/tickets screen: user's own tickets w/ status pills + new-ticket CTA.
- Backend: GET /api/billing/summary (tier/status/renews_at/cancel_at_period_end/credit_cents/payments/plans), POST /api/billing/customer-portal (Stripe billing_portal session; _ensure_customer creates/reuses stripe_customer_id; 503 if portal not activated), GET /api/support/tickets (per-user scoped). Stripe Customer Portal confirmed ACTIVE (returns live billing.stripe.com URL).
- Landing/onboarding sub-headline copy updated to the "trusted contractor on call 24/7" message.
- Tested iter_16: 10/10 backend pytest + frontend E2E (all PASS, Stripe LIVE constraint respected — no checkout triggered).

## Shipped (continued 10) — Built-in Autoresponder / Email Marketing Engine (Amazon SES)
- New self-hosted email engine (`/app/backend/email_engine.py`, separate module to keep server.py lean): templates, drip automations, broadcasts to CRM segments, send-queue, background scheduler loop (30s), open-tracking pixel, unsubscribe links, SES SNS bounce/complaint webhook, suppression list. Engine is $0 — only delivery uses Amazon SES.
- Transactional triggers wired: welcome on signup, purchase + renewal (Stripe), support ticket reply (new POST /api/admin/tickets/{id}/reply). 4 default templates auto-seeded (welcome/purchase/renewal/ticket_reply, deletion-protected, merge vars {{name}}/{{plan}}/{{app_url}}).
- Admin "Email Marketing" module (`src/components/admin/EmailModule.tsx`): Overview stats, Templates CRUD, Automations builder (trigger + delayed steps), Broadcasts (segment picker + send), Suppression list. Reuses CRM smart-segments via email_segment_resolver.
- DRAFT MODE until AWS keys added: AWS_REGION/AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/SENDER_EMAIL/SES_CONFIGURATION_SET placeholders added to backend/.env. overview.configured=false; emails queue safely, send the moment keys + SES production access are in.
- Tested iter_17: 15/15 backend pytest PASS (auth gating, CRUD, segments, suppression skip, welcome-on-signup enqueue, open pixel, unsubscribe, SES bounce webhook). FIXED real Motor bug: `if not _db` → `if _db is None` (was silently disabling all transactional triggers).
- ⚠️ ACTION: user to (1) buy domain (Route 53 recommended), (2) verify domain DKIM in SES + request production access, (3) paste AWS IAM keys + SENDER_EMAIL into backend/.env to go live.

## Shipped (continued 11) — Intelligent Affiliate Product Widget (blog monetization)
- New `affiliate_engine.py` module: AI categorizes each auto-generated blog article into Main Product / Materials / Tools / Optional Upgrades / Replacement Parts / Frequently Bought Together, then builds affiliate deep-search links across 7 retailers (Amazon, Home Depot, Lowe's, Walmart, Ace, Tractor Supply, Harbor Freight). Zero manual linking.
- Auto-generates on blog creation (instant quick list + background AI enrich); admin can Regenerate per-post and Backfill all. Links built at read time so changing affiliate IDs needs no regeneration.
- Widget renders in BOTH the SEO SSR HTML (`/api/blog/{slug}/html`, rel="nofollow sponsored") and the in-app blog reader (`AffiliateWidget` via `GET /api/blog/{slug}/materials`).
- Admin "Affiliate Widget" module (`AffiliateModule.tsx`): Settings (enable, title, optional sections, preferred brands, blacklist, disclosure), Retailers (per-store enable/priority/affiliate tag/Impact deeplink template), Articles (regenerate + backfill). Amazon tag injects as `&tag=`; others support Impact/CJ `{url}` deeplink templates.
- Phase 1 = affiliate SEARCH links (works now, no gated APIs). Phase 2 (later) = live price/image/rating via Amazon PA-API / Impact once user has approvals.
- Tested iter_18: 11/11 backend pytest + frontend admin & blog reader verified. App onboarding redesigned with custom DiyBackdrop (orange glow + faint blueprint grid + scattered tool icons), removed photo bg.

## Shipped (continued 12) — Web Landing / Funnel Page + App Store badges
- New `app/landing.tsx`: high-converting marketing funnel for web visitors — sticky nav (Sign in / Start free), bold hero ("Fix it. Build it. Do it right.") with animated phone app-preview mockup, App Store + Google Play badges, value strip, 3-step "how it works", 6-feature grid, ⭐ testimonials, final CTA band, footer. Uses `DiyBackdrop`. Fully responsive (wide≥900 desktop layout vs stacked mobile).
- `app/index.tsx`: unauthenticated WEB visitors now route to `/landing` (native users still go to `/onboarding`). Logged-in users → tabs/paywall unchanged.
- Store badges: `APP_STORE_URL`/`PLAY_STORE_URL` consts at top of landing.tsx — empty for now (apps not published) so badges route to web onboarding with "coming soon" note; paste real store links later to go live.
- NOTE: testimonial quotes (Marcus/Dana/Priya) are illustrative placeholders — user should replace with real reviews before launch.

## Shipped (continued 13) — Avatar Home (State A) + Smart Table / Supply Drawer (State B) [Sheet #3]
- Home tab redesigned into immersive avatar canvas (State A): pure-black, glowing floating Homie, glassmorphic ask/voice bar (BlurView), suggestion chips, resume pill, avatar-chip menu. Live-3D Reallusion + voice mic = future native build (slot ready).
- Smart Supply Drawer (State B): white slide-up sheet on project screen (orange trim, charcoal text). Backend upgraded `GET /projects/{id}/supplies` → categorized manifest (materials/tools) each with 7-retailer affiliate links + owned-state + readiness %; `PATCH /projects/{id}/supplies` toggles owned (persists to project.supply_state). "Order remaining on Amazon" bundle. Reuses affiliate_engine. Curl-verified (readiness 60→80% on toggle) + screenshot verified.

## Roadmap status vs user's 8 build sheets
- #1 AR Room Scan/Digital Twin: DEFERRED — Unity/ARFoundation can't run in Expo; real scan = ARKit RoomPlan, iOS-LiDAR-only, needs native build. Foundation (rooms model + manual dims) offered, not yet built.
- #2 Profiles/Community: profile photo+bio+bubble, auto-post on completion, report/flag, privacy — NOT built (community base already exists).
- #3 Smart Table: DONE (above).
- #4 Hands-Free Voice/AR: BLOCKED (native + ElevenLabs keys).
- #5 Affiliate Referral: Share&Earn already exists; gear-popup + social-share extensions NOT built.
- #6 Scheduler (critical path/weather): weather + steps exist; Gantt/dependency ordering NOT built.
- #7 Completion Story/Testimonial generator: NOT built.
- #8 Admin Dashboard: LARGELY EXISTS (overview, CRM, affiliate panel, email marketing, vendors, tickets). 
- #9 Automation rules + AI inbox: email automations builder exists; visual if/then rules engine + AI inbox NOT built.
- No new external services added (Cloudflare/Supabase/Firebase) — using existing Mongo + affiliate search links.

## ⚠️ BLOCKER/ACTION: backend/.env PERPLEXITY_API_KEY is EMPTY. Perplexity is NOT active — guide generation has been silently using the Emergent fallback (gpt-4o-mini, no web search), and Code Check returns 503. User must paste a real Perplexity API key into backend/.env PERPLEXITY_API_KEY to activate both accurate guides and local code lookup.

## Shipped (continued 14) — CFO Finance Dashboard [Sheet #10] + Homeowner Journey / Achievement / Completion engine [Sheets #2, #7, #11]
- **CFO Dashboard**: FinanceModule wired into Admin Workstation nav (`admin-nav-finance`). Cards: MRR, revenue (month), monthly expenses, net, margin, ARPU, paying users, runway. Editable monthly expenses (add/delete, testIDs finance-expense-*) + cash-on-hand (finance-cash-*). Endpoints: GET `/admin/finance/summary`, POST/DELETE `/admin/finance/expenses`, PUT `/admin/finance/cash`. MRR derived from active subs × PLAN_TIERS; revenue from payment_transactions this month.
- **Completion Story engine [#7]**: `POST /projects/{id}/complete` (CompletionModal on project screen, banner `project-finish`). Collects material cost, hours, star rating, reflection, before/after photos (base64), share toggle. AI (`brain_completion_story`, gpt-4o-mini) returns story_title, testimonial story, estimated pro cost, skill tag. Computes money_saved = max(0, pro_cost − cost). Writes a `db.timeline` entry. Duplicate completion → 400. Confetti + result screen with new achievements.
- **Homeowner Journey / Progression [#11]**: `GET /journey` (screen `/journey`, linked from profile `profile-journey`): lifetime money saved, total hours, projects completed, achievements grid (9 milestone badges: first/3/5/10 projects, $500/$1k saved, storyteller, before/after, community mentor), skills chips (room→skill map + AI tag), Homeowner Timeline. Public shareable journey: `GET /journey/u/{user_id}` (respects share_public), native Share sheet.
- **Profile bubble [#2]**: photo avatar (image picker, `profile-avatar-pick`), one-line bio (`profile-bio-input`), public-journey Switch (`profile-share-toggle`). public_user + ProfileReq extended (avatar_base64, bio, share_public).
- **Community auto-post [#2]**: on completion with share=true, writes a `community_experiences` doc (shows in `/community/feed` "JUST COMPLETED"); feed title falls back to experience title.
- Verified: backend 12/12 pytest pass + curl (story/savings/badges/dup-block/feed); frontend Playwright all flows pass. Test file: /app/backend/tests/test_finance_journey.py.

## Shipped (continued 15) — #12 Knowledge Search + Pro-Referral, #13 Automation Rules Engine, #14 Home Digital Twin
- **#12 Knowledge Search** (agreed approach: Mongo regex search + AI query-expansion via gpt-4o-mini, NO vector DB): `GET /knowledge/search?q=` spans blog guides, community projects, experiences/tips, Q&A threads; returns grouped results + related terms + did-you-mean. Screen `/search` (entry: Community search bar `community-search-bar`), popular/related chips, escalation block. **Pro-Referral**: `GET /pro-referrals/trades`, `POST /pro-referrals` (lead capture), `GET /pro-referrals/me`; admin `GET /admin/pro-leads` + `PATCH /admin/pro-leads/{id}`. ProReferralModal (trade/issue/location/urgency). Admin ProLeadsModule (`admin-nav-proleads`). Email notify to pro deferred until AWS SES keys. NO vector DB yet (future upgrade). Tested: 15/15 pytest + Playwright, no bugs.
- **#13 Automation Rules Engine** (mostly internal): `emit_event(trigger,user,data)` runs enabled rules. Triggers: signup, project_completed (both wired), subscription_started, referral_completed. Actions: award_credits, add_tag, send_email (queues via email_engine, degrades w/o SES), webhook (httpx), log. Endpoints: `/admin/automations` CRUD + `/meta` (triggers/actions/recipes) + `/{id}/toggle` + `/{id}/test` + `/logs`. 4 prebuilt recipes. AutomationModule (`admin-nav-automations`): form-based builder, recipe library, toggle, test-run, activity log. Backend curl-verified (create/test/toggle/logs/delete).
- **#14 Home Digital Twin & Lifetime Log** (100% internal, reuses timeline + home_memory): `GET /home` returns rooms, systems, stats (projects/saved/invested/hours/years), years[], merged lifetime log (completed projects + home notes — metadata only, no blobs). CRUD: `/home/rooms`, `/home/systems` (POST/DELETE). `GET /home/year-review/{year}`. Screen `/home-profile` "My Home" (entry: profile `profile-home`): hero, stat grid, Year-in-Review modal, Rooms & Systems registry (add/delete), lifetime knowledge log timeline. AR scan capture stays native-deferred (#1). Backend curl-verified.

## Shipped (continued 16) — #18 Marketplace & Pro Service (buildable-now slice) + Logo refresh
- **Logo**: `Logo.tsx` now shows the DIYhomie mascot (`assets/homie-mascot.png`) popping out of the orange square (cap above top edge, shirt covering bottom, `bottom:-10%`), kept pulse-ring animation + idle float. Removed old `logo-contractor.png` (unused). Global across all screens.
- **#18 Marketplace** (payments DEFERRED, referral-tracking only, per user): provider directory + partner onboarding + deep handoff + contextual trigger. New `pro_partners` collection (6 seeded verified pros). Endpoints: `GET /pros?trade=&q=&location=`, `GET /pros/{id}`, `POST /pros/apply` (→ pending unverified), `GET /projects/{id}/handoff` (auto project+home summary), `GET /projects/{id}/pro-suggestion` (risky-keyword/code-alert trigger), admin `GET/POST/PATCH/DELETE /admin/pros`. Extended `POST /pro-referrals` with `pro_id` + `project_summary` (increments partner leads_count, joins pro_name). Screens: `/pros` (directory, entry: Profile 'Find a Pro' `profile-pros`), `/pros-apply` (partner onboarding). ProReferralModal extended (proId/proName + 'Share my project details' consent). Project screen contextual `project-get-pro` banner → `/pros?trade=&projectId=`. Admin ProLeadsModule now has Leads + Partners tabs (verify/list/delete). Email-to-pro notify waits on AWS SES. Tested: 14/14 pytest + Playwright, no bugs. NO Stripe scheduling/payments yet (deferred).

## Shipped (continued 17) — #19 Smart Maintenance, Asset & Warranty
- Extended home-twin systems with asset/warranty fields: brand, model, serial, purchase_date, warranty_expires, support_url, receipt, serviced{} map. Auto-maintenance schedules per system type via MAINT_RULES (HVAC filter 90d + tune-up 180d, water heater flush 365d, roof inspect 365d, etc.). Endpoints: `GET /home/maintenance` (due/overdue/soon items + interval, next due from purchase/install/last-serviced, plus warranty statuses), `POST /home/systems/{id}/serviced` (resets that task's interval). `POST /home/systems` accepts new fields.
- Frontend: "My Home" (/home-profile) now shows a MAINTENANCE section (overdue/soon count, color-coded task cards with DONE buttons `maint-done-{id}`) and the add-system form captures serial (`home-add-serial`) + warranty-expires (`home-add-warranty`). Verified: backend curl (schedule gen, mark-serviced resets interval to green) + screenshot smoke (3 overdue cards render, DONE works). Recall feed (CPSC) DEFERRED (new API). Reminder emails wait on AWS SES.

## Roadmap status update (post continued-17)
- DONE: #2, #7, #10, #11, #12, #13, #14, #18, #19 + logo refresh.
- Backlog queued: #20 Analytics, #21 Trust Center, #22 Feature Flags/DevOps, #5 referral popup, #6 Gantt scheduler, #15 Accessibility, #17 RAG feedback. #1/#4 native-blocked.
- Pending user keys: AWS SES, Perplexity. Note: TEST_UI systems/projects from testing agent exist on admin account (harmless demo data).

- DONE: #2, #7, #10, #11, #12, #13, #14, #18 (buildable slice) + logo refresh.

- DONE: #2, #7, #10, #11, #12, #13, #14.
- Backlog (queued, not built): #5 referral gear-popup, #6 Gantt dependency scheduler, #15 Accessibility/Aging-in-place planner (needs AR + code tables), #17 RAG training/feedback loop (needs vector DB; feasible slice = guide "flag as wrong" + admin AI-quality dashboard). #1/#4 native-build-blocked.
- Pending user keys: AWS SES (email + automation email action + pro-lead notify), Perplexity (Code Check + web-search guides).


- #2 Profiles/Community: DONE (photo, bio, public toggle, auto-post on completion). Remaining: report/flag moderation.
- #7 Completion Story/Testimonial: DONE.
- #10 CFO Finance Dashboard: DONE.
- #11 Homeowner Achievement & Progression: DONE (timeline, savings, hours, badges, skills, shareable journey).
- Backlog (queued, not built): #5 referral gear-popup, #6 Gantt dependency scheduler, #9 visual automation rules + AI inbox, #12 Knowledge Search + Pro-Referral hand-off (needs vector/RAG), #13 Automation & Workflow Builder (visual rules engine). #1/#4 remain native-build-blocked.


---
## Session update (fork) — Sheets #58, #59, #60 shipped + DELETE fix

### Completed & TESTED this session
- **#58 Freemium/Demo/Upgrade Engine** — verified (iteration 38/39). Entitlements, demo sandbox, upgrade banners, admin FreemiumModule.
- **#59 Activity Audit Logging & Transparency** — NEW module `/app/backend/audit_engine.py` (HTTP middleware auto-logs mutations/logins, consent registry, risk alerts). User `/privacy` screen + admin `AuditModule`. Verified (iteration 39).
- **#60 DIYhomie Verified Certification** — NEW module `/app/backend/certification_engine.py` (auto-issue on project completion, verified tiers, branded PDF/HTML cert + public verify, revoke/reinstate/validate). User `/certifications` screen + admin `CertificationsModule`. Verified (iteration 40).
- **BUG FIX**: `DELETE /api/projects/{id}` added (was 405) — owner delete + timeline cascade, 404 for non-owner.

### Architecture note
New features are now built as SEPARATE engine modules (audit_engine, certification_engine) included into server.py to avoid growing the ~8.9k-line monolith. Continue this pattern.

### PENDING QUEUE (user pasted, NOT yet built) — build in order, each its own module + testing_agent:
- **#61** Beta Feature Launch, Guided Onboarding & First-Touch Support Engine (persona onboarding walkthroughs, contextual help, first-impression/NPS capture, adoption analytics, admin no-code walkthrough/FAQ control).
- **#62 (A)** Dynamic Pro Pricing Calculator & AI Quote Engine (DIY vs pro cost ranges, region/scope modeling, "Get Bids" pro handoff, quote history + feedback). NOTE: user later re-labeled #62 as (B) below — clarify which they want first.
- **#62 (B)** Homeowner/Builder Education Center & Learn-to-DIY Content Hub (modular curriculum tracks, AR/avatar lessons, learning dashboard, mentor-contributed lessons, versioned content). (User sent both under "#62" — ASK which.)
- **#63** Global Skills Index & Community Impact Leaderboard (skills matrix, impact dashboard, mentor/pro QA pages, opt-in seasonal/regional leaderboards). Builds on #54 skills + #57 experts + #60 certs.
- **#64** Community Events, Group Projects & Local Campaign Engine (event/campaign creation + RSVP, group Smart Table logistics, impact tracking, sponsor hooks, viral invite flow).

### Still-open items from earlier
- server.py monolith refactor (P0, deferred — mitigated by new-module pattern).
- Deferred #59 sub-item: lifecycle auto-prune/anonymize compliance automation.
- Broken pending user keys: Perplexity (Code Check), AWS SES (Email Engine).

---
## Session update (fork) cont. — Sheet #62 shipped
- **#62 Education Center & Learn-to-DIY Hub** — NEW `education_engine.py`: curriculum tracks + versioned lessons (steps/flashcards/safety), personal learning dashboard, lesson completion → micro-cert badge + deep-link to linked #54 quiz. User `/education` screen + admin EducationModule. Verified iteration 41 (backend 9/9 + frontend E2E).

### PENDING QUEUE (updated) — build in order, each its own module + testing_agent:
- **#61** Beta Feature Launch, Guided Onboarding & First-Touch Support Engine.
- **#62(A) — STILL PENDING**: Dynamic Pro Pricing Calculator & AI Quote Engine (user pasted TWO specs as "#62"; the Education Center one is DONE, the Pro Pricing one is NOT built).
- **#63** Global Skills Index & Community Impact Leaderboard (builds on #54 skills + #57 experts + #60 certs + #62 education).
- **#64** Community Events, Group Projects & Local Campaign Engine.
- Still deferred: server.py refactor (mitigated by module pattern), #59 lifecycle auto-prune/anonymize.

---
## Session update (fork) cont. — Sheet #63 shipped
- **#63 Sponsored Learning, Campaigns & Brand Collaboration** — NEW `campaign_engine.py`: brands launch sponsored skills challenges tied to #62 education tracks; users join + complete milestones (lesson-type auto-verified vs edu_progress) to earn badge + discount rewards; consent-gated story sharing; admin partner analytics (funnel + consented stories) + activate/end toggle. User `/campaigns` screen + admin CampaignsModule. Verified iteration 42 (backend 12/12 + frontend E2E). Fixed invalid `home-heart-outline` icon on Profile.

### PENDING QUEUE (updated):
- **#61** Beta Feature Launch, Guided Onboarding & First-Touch Support Engine.
- **#62(A) Pro Pricing/Quote Engine** — still pending (Education Center #62 is DONE).
- **Global Skills Index & Community Impact Leaderboard** (the earlier "#63" spec, superseded in numbering by Sponsored Campaigns; still unbuilt).
- **#64** Community Events, Group Projects & Local Campaign Engine.
- Deferred: server.py refactor; #59 lifecycle auto-prune/anonymize.

### Engine module pattern (established this session): audit_engine, certification_engine, education_engine, campaign_engine — all separate files included into server.py. Continue for new features.

---
## Session update (fork) cont. — #63 (v2) Brand-Product extension
- User pasted a SECOND "#63" (Sponsored Brand Partnership & Product Campaign) — same domain as campaign_engine. EXTENDED it (DRY, no dup module): product-offer CTA {label,url,type} with attribution (POST /campaigns/{slug}/cta-click), user feedback/sentiment (POST /campaigns/{slug}/feedback), and partner-dashboard analytics now include cta_clicks/avg_rating/learned_pct/comments. Frontend: CTA button + "Sponsored/never charged" transparency in campaign modal; admin analytics show CTA/rating/learned. Curl-verified + screenshot confirmed. (Not separately run through testing_agent — self-verified.)

### PENDING QUEUE (unchanged): #61 Beta Launch/Onboarding; #62(A) Pro Pricing/Quote Engine; Global Skills Index & Community Impact Leaderboard; #64 Community Events. Deferred: server.py refactor, #59 lifecycle auto-prune.

---
## Session update (fork) cont. — Sheet #64 shipped
- **#64 Data, Analytics & Project Reporting Export Engine** — NEW `export_engine.py`: user selects any subset of 7 data types, exports JSON/CSV, or creates an audit-trailed EXPIRING share link with a branded printable HTML report (download-limit + expiry enforced). Admin platform-KPI export + job log. User `/export` screen + admin ExportModule. Verified iteration 43 (backend 14/14 + frontend E2E). Established engine modules now: audit, certification, education, campaign, export.

### PENDING QUEUE (updated):
- #61 Beta Feature Launch, Guided Onboarding & First-Touch Support Engine.
- #62(A) Dynamic Pro Pricing Calculator & AI Quote Engine (still pending).
- Global Skills Index & Community Impact Leaderboard.
- (User hinted more: Resell Partner SDK, Payment Gateway Upgrades, Advanced Reporting, MVP Launch/QA checklist.)
- Deferred: server.py refactor; #59 lifecycle auto-prune/anonymize.

---
## Session update (fork) cont. — Sheet #65 shipped
- **#65 Integration App Store** — NEW `appstore_engine.py` (complements existing developer/partner API layer). Browsable, permissioned add-on catalog; install with explicit consent scopes + instant revoke (audit-logged); admin publish/version/QA + install analytics. Seeded 5 add-ons. User `/appstore` + admin AppStoreModule. Verified iteration 44 (backend 16/16 + frontend E2E). Fixed a startup seed bug + corrupted admin/index.tsx tail during this build.

### Engine modules now: audit, certification, education, campaign, export, appstore (all separate files → keeps server.py lean).

### PENDING QUEUE:
- #61 Beta Feature Launch, Guided Onboarding & First-Touch Support.
- #62(A) Dynamic Pro Pricing Calculator & AI Quote Engine.
- Global Skills Index & Community Impact Leaderboard.
- User-hinted finals: Stakeholder Launch Checklist, DevOps/Monitoring, Demo/Investor Bundle, Mega-Check QA Run, Resell Partner SDK, Payment Gateway Upgrades.
- Deferred: server.py refactor; #59 lifecycle auto-prune/anonymize.

---
## Session update (fork) cont. — Sheet #67 shipped
- **#67 DevOps Monitoring & Reliability** — NEW `monitoring_engine.py` + middleware: live health (DB ping/latency/uptime), auto error capture (error_events), live metrics (req/err rate/latency p95/by-status), top failing endpoints, incident tracker. Admin MonitoringModule (nav admin-nav-monitoring). Curl-verified (admin-only). Auto-scaling/rollback = advisory only (no infra control here).
### Engine modules: audit, certification, education, campaign, export, appstore, monitoring.
### PENDING QUEUE: #61 Beta Launch/Onboarding; #62(A)/PriceOps AI Pro Pricing (awaiting user confirm); Global Skills Index & Community Impact Leaderboard; #64-alt Community Events; MVP Launch/QA checklist. Deferred: server.py refactor; #59 lifecycle auto-prune.

---
## Home Intelligence Suite (Build Blueprints 01–03) — NEW standalone section (route base /home-intel)

**Blueprint 01 — Home Intelligence MVP (DONE, tested iter45/46):**
- Backend `home_intelligence_engine.py` (routers /api/hi/*): assets CRUD, document upload w/ gpt-4o vision OCR, issue intake + safety triage (emergency detection), safety-first AI guidance card (clarification, confidence, source evidence), outcomes (completed/unresolved/escalated), shareable job summary, dashboard, Whisper /transcribe (voice = stub in UI).
- Frontend: app/home-intel/{index,assets,asset-add,asset/[id],help,guidance}.tsx; util src/utils/pickImage.ts.
- Entry: Profile → "Home Intelligence".

**Blueprint 02 — Room Intelligence (DONE, tested iter47; fixed route-collision bug):**
- Backend `room_intelligence_engine.py` (/api/hi/rooms/*): floors (auto Main Floor), classify (AI room-type suggestion, never auto-Confirmed), rich rooms (persistent_room_id, room_type, dimensions, capture_type/measurement_source for future AR), connections (bidirectional map), room profile, room map, update-preserving-history, archive. Analytics → hi_analytics.
- FIX: removed legacy GET/POST /api/hi/rooms in home_intelligence_engine (was shadowing B02 rich create); _resolve_room now creates rich rooms; DB migration backfilled old rooms.
- Frontend: app/home-intel/rooms/{index,walkthrough,capture,connect,[id],map,update}.tsx.
- Assets & issues carry room_id.

**Blueprint 03 — AI Project Planner (DONE, tested iter47):**
- Backend `project_planner_engine.py` (/api/hi/projects/*): start (goal→title/category or clarify), discovery, plan (safety review + phased plan Plan/Prepare/Purchase/Complete Work/Inspect/Clean Up/Maintain + steps + grouped materials + cost ranges), workspace step status, pause/resume, materials CRUD + user_status, notes/media, Ask Homie, outcome. Emergency goals → 409 + escalated. Analytics events.
- Frontend: app/home-intel/projects/{index,start,[id],materials,complete}.tsx.
- Entry: dashboard "Plan a Project"; room profile "Start Project".

**QUEUED (not yet built):**
- Blueprint 04 — Maintenance Intelligence & Home Care Scheduler (tasks, recurrence/occurrences, AI suggestions, calendar, seasonal guide, reminders). Data: hi_maintenance_*.
- Blueprint 05 — Homie AI Assistant & Conversation Hub (central chat front-door, context selector, photo ID, conversation→approved records, history). Data: hi_conversation_*.

Test credentials: demo_home@diyhomie.com / Test1234 ; admin Diyhomieapp@gmail.com / diyhomie1122.

**Blueprint 06 — Home Document Vault (DONE, tested iter48):**
- Backend `document_vault_engine.py` (/api/hi/documents/*): upload (image→gpt-4o vision field extraction w/ user review; non-image→ready), list w/ category counts + review_count + needs_review/is_linked flags, detail (+extractions+relationships w/ resolved names), edit, delete (cascades ext/rels, preserves linked entities), link to property/room/asset/project/task (asset link mirrors into hi_asset_documents for guidance grounding), extraction review (confirm/reject/edit → 'Confirmed by User'), review-queue, plain-language + category search, Ask Homie (grounded, non-hallucinating). Access logs (hi_document_access) + analytics.
- Frontend: app/home-intel/documents/{index,add,[id],search,review}.tsx. Entry: dashboard "Document Vault".
- Collections: hi_documents, hi_document_extractions, hi_document_relationships, hi_document_access.
- Minor UX note (future): search collapses to category filter when a category word appears in the query — consider a fallback.

**Blueprint 04 — Maintenance Intelligence & Home Care Scheduler (DONE, tested iter49 — 32/32 backend pytest + frontend E2E):**
- Backend `maintenance_engine.py` (/api/hi/maintenance/*): tasks CRUD, recurrence creates separate occurrences (history never overwritten), complete/skip/reschedule/pause/archive, calendar counts, seasonal groups (Spring/Summer/Fall/Winter), Home Care Score (completed vs overdue), AI suggestions via gpt-4o grounded on user's hi_assets + season (generate/list/accept/dismiss). Collections: hi_maintenance_tasks/checklist/occurrences/suggestions.
- Frontend: app/home-intel/maintenance/{index,add,[id],tasks,calendar,seasonal,suggestions}.tsx. Entry: dashboard "Home Care & Maintenance" (testID hi-maintenance).
- Wired into server.py (import maintenance_engine + configure(db, logger, _llm_json) + include_router).

**Blueprint 05 — Homie AI Assistant & Conversation Hub (DONE, tested iter50 — 21/21 backend pytest + frontend E2E):**
- Backend `conversation_hub_engine.py` (/api/hi/chat/*): context-options (rooms/assets/projects/documents), conversations CRUD, send-message grounded on selected context via gpt-4o-mini, photo attach + gpt-4o vision identification (image stored server-side, never returned in history), safety-first emergency short-circuit (assistant.emergency=true), up to 2 structured suggested_actions (create_asset/create_maintenance_task/start_project) that require explicit user APPROVE to create real records (double-approve → 409). Collections: hi_conversations, hi_conversation_messages.
- Frontend: app/home-intel/chat/{index,[id]}.tsx (conversation list + chat thread with context picker modal, photo attach, action-approval buttons). Entry: dashboard "Ask Homie" (testID hi-chat).
- Wired into server.py (import + configure(db, logger, _llm_json, EMERGENT_LLM_KEY) + include_router).

**Blueprint 10 — Admin Control Center & Content Operations (DONE, tested iter51 — 19/19 backend pytest + frontend E2E):**
- Backend `admin_ops_engine.py`: 5-role RBAC (super/product/support/content_reviewer/finance) on top of JWT+is_admin, permissions read live from Mongo. Admin router /api/hi/admin/* (me, dashboard w/ 8 cards incl recent_errors, users search+detail+suspend/restore/override/feature-override/delete, content templates CRUD+publish+archive+rollback+versioning, safety queue+review, feature flags 8 seeded +toggle, support queue+reply, admin-role mgmt super-only + last-super 409 guard, read-only hash-chained audit). User router /api/hi/support (file/list/view/message own tickets). Sensitive actions require {confirm,reason} + write audit. Owner Diyhomieapp@gmail.com auto-seeded as super_admin at startup.
- Safety auto-escalation: conversation-hub emergency now records into hi_safety_escalations (visible in admin queue).
- Frontend: `src/components/admin/HomeOpsModule.tsx` (8 tabs) added to /admin sidebar as "Home Intelligence Ops" (web-only, permission-gated tabs).
- Collections: hi_admin_users, hi_admin_permissions, hi_admin_audit, hi_content_templates(+_versions), hi_safety_escalations, hi_support_tickets, hi_support_messages, hi_feature_flags.
- RBAC designed via integration_expert. NOTE: published templates are stored as approved guidance context but not yet injected into Homie's prompts (future wiring).

**Maintenance Reminders (DONE, tested iter52 — 12/12 backend + frontend):**
- Backend `reminders_engine.py` (/api/hi/reminders): feed (overdue/due_today/this_week + counts + headline), badge, preferences (push_enabled, digest_frequency off/daily/weekly), test-push, and a daily push-digest scheduler loop (per-user last_push_date guard). Collection: hi_reminder_prefs.
- Backend `push_engine.py`: Emergent managed push relay — POST /api/register-push + send_push() helper. EMERGENT_PUSH_KEY=placeholder in .env (deployer sets real key at build). Graceful degradation in preview.
- Frontend: reminders.tsx (feed + push toggle + digest chips + test push), _layout.tsx push handlers (module-scope handler+channel, warm/cold tap listeners), src/utils/push.ts (registerForPush + silent reRegisterIfGranted), auth.tsx silent re-register on app open, 'Reminders' button + red badge on maintenance home. app.json: expo-notifications plugin + android.googleServicesFile + POST_NOTIFICATIONS.
- PENDING FOR USER: push only works after Publish + native build with a google-services.json (Android) from Firebase; APNs key + Google service-account JSON prompted at build. In-app reminders work now.

**Templates-in-Homie (DONE, tested iter53):** admin_ops_engine.get_published_templates() (safety-first ordering, bounded) injected as APPROVED GUIDANCE into conversation_hub chat prompts AND project_planner generation. Drafts/archived excluded. Verified chat reflects published 'Ladder Safety' template.

**Blueprint 07 — Tool/Material/Supply Inventory 'My Toolbox' (DONE, tested iter53 — 23/23 backend + 100% frontend):**
- Backend `inventory_engine.py` (/api/hi/inventory): CRUD (+q/category/location filters), /locations distinct, gpt-4o photo identify, archive. Match /match/{project_id} groups Already Have / Need to Buy / Need Verification (token+substring name matching, consumable low→verification); /match/{project_id}/apply writes back project material user_status (have_it/need_it/unsure). Collection: hi_inventory_items.
- Frontend: app/home-intel/inventory/{index,add,[id]}.tsx (add uses photo→identify autofill), 'Match against my toolbox' button on projects/materials.tsx, 'My Toolbox' entry (testID hi-inventory) on HI dashboard.
- Reusable test: /app/backend/tests/test_inventory_b07.py.

**Blueprint 08 — Account, Property Onboarding & Guidance Preferences (DONE, tested iter54 — 16/16 backend + frontend):**
- Backend `onboarding_engine.py` (/api/hi/account): guidance preferences (experience_level/budget_sensitivity/risk_tolerance/tone/units) auto-defaulted; onboarding overview with progress + steps + /onboarding/complete; multi-property SETUP CRUD (create/edit/activate/delete; first is active; last-home delete 409); is_active flag. Collection: hi_user_prefs (+ extended hi_properties fields). get_guidance_context() + default_skill_level() injected into conversation_hub chat AND project_planner (verified metric units in chat).
- Frontend: app/home-intel/account/index.tsx (onboarding progress, preference chips, homes list/add/activate/remove, load-error+retry state). Entry: dashboard "Setup & Preferences" (testID hi-account).
- Fixed review notes: removed no-op property_type ternary; added error/retry state (no infinite spinner).
- DEFERRED (planned follow-up): cross-feature "active-home switching" — rooms/assets/projects/maintenance/toolbox still read the single/first property; the active flag + property CRUD data model is ready for the retrofit.

**FULL BLUEPRINT SEQUENCE COMPLETE:** B01,B02,B03,B04,B05,B06,B07,B08,B10 all built+tested; plus Maintenance Reminders, Templates-in-Homie.

**Active Home Switching (DONE, tested iter55 — 14/14 backend + frontend, no regressions):**
- Retrofitted all 7 HI engines' `_get_or_create_property()` to prefer the `is_active` property (fallback to any). Added active-property (property_id) filtering to project list (/api/hi/projects) and toolbox list (/api/hi/inventory). Rooms/assets/dashboard already property-scoped via helper.
- Switch via /api/hi/account/properties/{id}/activate (Setup & Preferences 'Set active'). Verified: switching homes shows only that home's rooms/projects/toolbox; creates attach to active home; no leakage; switching back restores.
- Note: maintenance/documents lists remain user-scoped (acceptable). DRY: _get_or_create_property still duplicated across engines (future refactor).

**QUEUED / PENDING:**
- Blueprint 09 — Subscriptions/Billing: DONE (Stripe, not Paddle — reused existing tested Stripe checkout/webhook/portal). New `subscription_engine.py` defines free/starter/pro HI tiers + entitlement matrix + reusable enforce() gate. Added "starter" ($9) to PLAN_TIERS alongside pro ($12); legacy "master" maps to pro. Gating live on: Homie chat (daily), project create, home create → HTTP 402 → frontend routes to /home-intel/upgrade paywall (usage bars + plan cards + Manage billing). "Your plan" card in Setup & Preferences. NOTE: Stripe key in env is a LIVE key — real checkout not exercised in tests (only session/URL creation).
- Guided First Run: turn onboarding checklist into a first-launch walkthrough.
- Push: awaiting user's google-services.json for Android push before build. (central chat front-door using room/asset/project/doc context; context selector; photo ID; conversation→approved records with user approval; history; hi_conversation_*).
- Blueprint 07 — Tool/Material/Supply Inventory (hi_inventory_*; add/identify(photo)/edit/archive; storage locations; project shopping-list matching 'Already Have/Need to Buy/Need Verification'; usage/leftovers). Integrates with B03 project materials.
- Blueprint 08 — Account, Property Onboarding & Preferences (UserProfile prefs: guidance_detail_level/preferred_interaction/diy_experience; goals; multi-property + UserPropertyAccess; property switcher across all /home-intel screens; notification/privacy prefs; guest sessions). NOTE: app already has JWT auth/register — B08 should extend, not duplicate.


---
## Session update (fork) cont. — Blueprint 15 & 16 FRONTEND UI shipped
- **B15 Guided Measurement** (backend was already done): completed UI. `measure/index.tsx` (action list + recent), `measure/new.tsx` (manual/camera-estimate capture), NEW `measure/[id].tsx` (view/edit dims/unit/confidence/notes, "I verified this measurement" → Confirmed badge, edit-history/revisions, delete). Camera-estimate mode shows verify-before-purchase warning + ESTIMATE tag. Entry: HI dashboard "Measure Anything" (testID hi-measure).
- **B16 Project Cleanup & Disposal** (backend was already done): NEW `cleanup/` dir — `index.tsx` (session hub: leftover materials with keep/reuse/donate/recycle/dispose + "Save to my Toolbox", waste list with risk color, Finish cleanup + completion summary), `add-leftover.tsx`, `add-waste.tsx`, `waste/[wid].tsx` (risk-colored safety note + guidance + local-verification note + mark-handled). Entry: project workspace "Cleanup & Disposal" (testID proj-cleanup).
- Verified iteration_61 (9/10) + iteration_62 (fixed cleanup-complete summary vanishing — load() now GETs session by-project first instead of always POSTing a new one). Both green.

---
## Session update (fork) cont. — Blueprint 18 shipped (Integration Gateway)
- **B18 Integration Gateway, Secrets Vault & Automation Control Plane** — NEW `integration_gateway_engine.py`. ONE secure layer for all external services. Connector Registry (11 seeded: emergent_llm, stripe, posthog, sentry, firebase_push, decor8, perplexity, aws_ses, weatherapi + DORMANT pipedream & browserbase). Credential REFERENCE service — vault stores only `env:VAR` pointers; admin UI shows status (Connected/Not configured/Expiring/Rotated/Checked) NEVER values. Webhook gateway (HMAC signature verify + dedupe by provider_event_id + sanitized receipts). Workflow dispatcher + IntegrationJob state machine (queued→running→succeeded / failed_retryable→dead_letter, exp backoff, idempotency, approval-gating for sensitive actions Level 3). Browser-automation broker (approval-gated, audited, Browserbase dormant). Health monitor + sanitized health events. Automation levels 0-4. Observability via analytics + sentry (keyless-safe).
- Routers: /api/hi/admin/integrations/* (require_admin), /api/hi/integrations/* (user OAuth connections list/revoke), /api/integrations/webhooks/{connector_key} (public). Seeded on startup (seed_connectors). Vault backend = backend/.env (references only).
- Admin UI: `src/components/admin/IntegrationsModule.tsx` → /admin sidebar "Integrations" (admin-nav-integrations). Connector list + detail (test, run test job, enable/disable, rotate, retry, approve).
- Verified iteration_63 (16/16 backend pytest + full frontend E2E). SECURITY confirmed: no raw secret returned/stored/displayed anywhere. Pipedream + Browserbase dormant until keys added.

### PENDING QUEUE: B19 Building Intelligence Capture / Digital Twin Core (building next); B20 Home Knowledge Graph & Document Intelligence (queued). Earlier: B14 Photo Room Design (Gemini Nano Banana), B17 AI Orchestration Gateway.

---
## Session update (fork) cont. — Blueprint 19 shipped (Digital Twin Core)
- **B19 Building Intelligence Capture Platform & Digital Twin Core** — NEW `digital_twin_engine.py`. ONE evolving twin per property (dt_twins, versioned) enriched by multi-source captures (manual/photo/walkthrough + future AR/LiDAR/MeasureAssist/plan-import). Collections: dt_twins, dt_floors, dt_rooms, dt_connections, dt_elements, dt_measurement_refs, dt_capture_sessions, dt_artifacts, dt_evidence, dt_conflicts, dt_settings. References existing hi_rooms/hi_measurements (no duplication).
- Confidence & Conflict engine: SOURCE_RANK hierarchy (user_confirmed/manual > document > AR/LiDAR > photo/walkthrough > ai_estimate). New lower/equal-rank evidence that differs beyond conflict_threshold raises a CONFLICT instead of overwriting confirmed data. Conflict resolution: keep_existing / use_new / manual / unknown. Twin confidence + model_status auto-recomputed.
- Routers: /api/hi/twin/* (overview, capture-sessions lifecycle, rooms/measurements/connections evidence, conflicts list+resolve, room-context read API) + /api/hi/admin/twin/* (settings: capture-type toggles + limits + conflict_threshold; queue; metrics). Wired + configured in server.py (no startup seed needed; settings lazy-created).
- Frontend user: app/home-intel/twin/{index,capture,conflicts}.tsx. Entry: HI dashboard "Property Digital Twin" (hi-twin). Admin: src/components/admin/TwinModule.tsx → /admin "Digital Twin" (admin-nav-twin).
- Verified iteration_64 (16/16 backend pytest + full frontend E2E, mobile + web). Conflict engine confirmed: manual value never overwritten by photo estimate.

### PENDING QUEUE: B20 Home Knowledge Graph & Document Intelligence (queued, NOT started); B14 Photo Room Design (Gemini Nano Banana); B17 AI Orchestration Gateway.

---
## Session update (fork) cont. — Blueprint 20 shipped (Knowledge Graph)
- **B20 Home Knowledge Graph & Document Intelligence** — NEW `knowledge_graph_engine.py`. Source-aware connected knowledge (entities + relationships + sources + excerpts + assertions with SOURCE LINEAGE). Two strictly-separated planes: GLOBAL (approved, published after review) vs PRIVATE (user's own, never public without consent+admin review). RELIABILITY_RANK hierarchy (manufacturer_document > approved_standard/template > admin_research > user_contribution > ai_generated). SAFETY_SENSITIVE predicates never auto-published.
- Retrieval service `retrieve()` (used by AI Orchestration): token-overlap scoring, visibility-enforced (private only for owner, global must be published), returns source_references + assertions, prefers structured entities. Collections: kg_entities, kg_entity_versions, kg_relationships, kg_sources, kg_excerpts, kg_assertions. Seeded a global "Paint an interior wall" procedure + material/tool/warning + relationships.
- Routers: /api/hi/knowledge/* (retrieve, entity detail w/ relationships, contribute private→optional review) + /api/hi/admin/knowledge/* (dashboard, review-queue, entities CRUD, review approve/publish/reject/archive, versions + rollback, sources CRUD, lineage). Seeded on startup (seed_knowledge).
- Frontend user: app/home-intel/knowledge/{index,contribute}.tsx. Entry: HI dashboard "Knowledge Base" (hi-knowledge). Admin: src/components/admin/KnowledgeModule.tsx → /admin "Knowledge Graph" (admin-nav-knowledge).
- Backend curl-verified (retrieval w/ source refs, contribute→review, publish→global v2, lineage, version snapshots, 403 gating). Frontend E2E pending testing_agent.

### PENDING QUEUE: B21 Adaptive Project Intelligence & Execution Engine (enhancement to B03 — building next); B14 Photo Room Design (Gemini); B17 AI Orchestration Gateway; Twin-from-photos; Connect Pipedream (needs key).

---
## Session update (fork) cont. — Blueprint 21 shipped (Adaptive Project Intelligence)
- **B21 Adaptive Project Intelligence & Execution Engine** (enhances B03 planner, no rewrite) — NEW `project_intelligence_engine.py`. Reads existing hi_projects/hi_project_phases/hi_project_steps/hi_project_materials; adds pi_blockers, pi_decisions, pi_change_events, pi_budget_snapshots.
- Next-Best-Action engine: prioritizes active blockers > hard safety stop > acquire missing materials > current/next step > plan/complete. Returns {title, why, actions, phase}.
- Blockers CRUD (auto-sets project status 'blocked' for safety/professional; auto-unblocks when last active blocker resolved). Decisions (pending→answered). Change-impact review: POST /change returns impact_summary + recommendations (budget Low → keep safety, defer optional upgrades; measurement → recalc quantities; material → compatibility+confirm; scope → safety preserved); /change-events/{id}/apply records budget_preference. Budget snapshot (estimated required/optional vs actual, limit, variance, over_budget). Safety-gated step completion (428 requires confirm for risky steps).
- Routers: /api/hi/pi/* (workspace, next-best-action, blockers, decisions, change+apply+history, budget get/put, steps safe-complete). Configured in server.py (no seed).
- Frontend: app/home-intel/projects/intelligence.tsx (NBA card + progress + blockers add/resolve + needed-now + budget + change-details preview/apply). Entry: project workspace "Next Best Step & Blockers" (proj-intelligence).
- Backend curl-verified (NBA, blocker surfacing/resolve, budget change impact). Frontend E2E pending testing_agent.

### PENDING QUEUE: B14 Photo Room Design (Gemini Nano Banana); B17 AI Orchestration Gateway; Twin-from-photos; Connect Pipedream (needs key).

---
## Session update (fork) cont. — Blueprint 22 shipped (Property Collaboration & Shared Access)
- **B22 Property Collaboration, Roles & Shared Access** — NEW `collaboration_engine.py`. Property-scoped SERVER-SIDE RBAC on top of existing JWT auth (NO changes to login/auth). Roles: owner/property_manager/editor/contributor/viewer/professional_guest (expiring). ROLE_PERMS map + reusable `check_access(pid,user,permission_key)` / `require(...)` helpers (owner bypass; wildcard `room.*` matching; guest expiry auto-suspend). Collections: prop_members, collab_invites, collab_activity, task_assignments, collab_audit. Users collection = `db.users`; properties owner field = hi_properties.user_id, name field = "name".
- Invites: secure `secrets.token_urlsafe(32)` tokens stored ONLY as SHA-256 hash; plaintext returned once; dedupe pending invite per email; 14-day (guest 7-day) expiry. Accept validates hash+expiry, creates/activates member. Owner-only: invite/list-invites/revoke/change-role/remove/audit. Server-side 403 enforced (verified: non-owner gets 403 on /invites). Assignments (assign/respond/my-assignments). Activity feed + full audit log.
- Routers: /api/hi/collab/* (owned, shared-with-me, my-permissions, members, invites, invite, invites/accept, members/{id}/role|remove, activity, audit, assign, assignments, my-assignments, assignments/{id}/respond). Configured in server.py.
- Frontend: app/home-intel/collab/{index(owner manage),shared(shared-with-me + accept + my assignments),accept(deep-link redirect)}.tsx. Entries: HI dashboard "Share & Collaborators" (hi-collab) + "Shared With Me" (hi-shared).
- **Guided Cleanup Nudge**: project completion screen (complete.tsx) now shows a highlighted "Clean up & log leftovers" action (next-cleanup) → /home-intel/cleanup.
- Backend curl-verified end-to-end (invite→register→accept→shared-with-me→scoped perms→403 enforcement). TEST USER: collab_test@diyhomie.com / Test1234. Frontend E2E pending testing_agent.

### PENDING QUEUE: B14 Photo Room Design (Gemini Nano Banana); B17 AI Orchestration Gateway (route AI via Knowledge Base); Twin-from-photos; Connect Pipedream (needs key).

---
## Session update (fork) cont. — Blueprint 23 shipped (Product Recommendation & Affiliate Attribution)
- **B23 Product Recommendation, Partner Routing & Affiliate Attribution** — NEW `recommendation_engine.py` (distinct from existing affiliate_engine which is blog/SEO). Project-first, NOT a marketplace — DIYhomie never processes payments. Ranking is SAFETY-FIRST: compatibility rank sorts before ranking_score; affiliate weight lowest and server-side-guarded to never exceed safety weight. Collections: rec_partners, rec_catalog_items, rec_compat_rules, product_needs, product_recommendations, affiliate_clicks, partner_conversions, rec_config.
- Compatibility statuses (compatible/likely_compatible/needs_verification/incompatible[excluded]) driven by spec overlap + compat rules (e.g. hvac_filter needs size verification). Disclosure text shown only for commission partners, before handoff. Outbound handoff creates AffiliateClick + returns external URL + disclosure, NEVER claims purchase / collects payment. Partner-confirmed conversions only (admin record + reverse); purchases never inferred. Partner activation guarded (needs disclosure if commission + link format + tracking).
- Routers: /api/hi/rec/* (needs, needs/{id}/recommendations, recommendations/{id}/action|click, for-project/{id}) + /api/hi/admin/rec/* (dashboard, partners create/activate/pause, weights PUT [guarded], mismatches, conversions record/reverse/list). Seeded 2 partners (HomeFix affiliate + Acme manufacturer) + 3 catalog items + 2 compat rules on startup.
- Frontend user: app/home-intel/rec/index.tsx (per-material recommendations w/ compatibility labels, verify notes, safety warning, disclosure, View Product via Linking + click record, save/have/not-relevant/report actions). Entry: project workspace "Recommended Products" (proj-recommend). Admin: src/components/admin/RecommendationsModule.tsx → /admin "Product Partners" (admin-nav-partners).
- Backend curl-verified (compat gating, safety-first ranking, disclosure, click handoff, save action, partner-confirmed conversion, policy guard rejects affiliate>safety, 403 gating). Frontend E2E pending testing_agent.

### PENDING QUEUE: B14 Photo Room Design (Gemini Nano Banana); B17 AI Orchestration Gateway; Twin-from-photos; Connect Pipedream (needs key).

- B23 fix: admin sidebar key collision resolved — renamed Product Partners key to "recpartners" (Partner Platform keeps "partners"). Verified iteration_68: 17/17 backend + full frontend.

---
## Session update (fork) cont. — Blueprint 24 & 25 shipped

**B24 Community Rewards Funding, Redemption & Financial Controls** — `rewards_funding_engine.py` (additive; does NOT touch B13 rewards_engine ledger). Only CONFIRMED-RECEIVED partner revenue funds the redemption budget (allocation % per source, safety reserve). Redemptions HOLD points (not permanently deducted) until provider confirms; idempotency_key prevents double-taps; fraud risk scoring gates risky redemptions to review; emergency pause halts redemptions without touching core features. Tango-style provider abstraction (simulated until real keys via Integration Gateway).
- User: `/api/hi/rewards-funding/*` (catalog, history, redeem). Screen `app/home-intel/rewards/redemption.tsx` + "Redeem" entry on rewards home.
- Admin: `/api/hi/admin/rewards/*` (command-center, revenue record/receive/reverse, settings, emergency-mode, fraud-reviews decide, providers pause/activate). Module `RewardsFundingModule.tsx` → /admin key `rewardsfunding`. (Shares prefix with B13 admin router via distinct sub-paths — no collision.)
- Curl-verified: revenue funds pool ($500 affiliate → $50 available after $50 reserve), demo catalog returns 3 gift cards, liability/sustainability computed.

**B25 Homie HQ Operations, Growth & AI Cost Intelligence** — `homie_hq_engine.py` (admin-only). Does NOT replace PostHog/Sentry (both dormant, keyless). Normalizes internal signals (payment_transactions, hi_projects, hi_support_tickets, error_events, fraud_reviews, revenue_events, ai_usage_records) into standardized metrics; insight engine produces evidence+confidence+impact insights (anomaly/trend/correlation/opportunity/risk); recommendation engine gates by automation_level (observe/recommend/prepare/approval_required/automated); Approval Center — high-impact actions require explicit admin approval, only low-risk safe actions auto-execute. AI Cost Intelligence: `record_ai_usage()` wired into central `_llm_json` → AIUsageRecord per call (provider, feature_area, est cost, latency; NO prompt content). Cost per active user/subscriber/feature/provider + daily threshold alerts (never disables safety features). Experiments (PostHog-aligned, guardrail-gated winners).
- Admin: `/api/hi/admin/hq/*` (dashboard "what needs attention" urgent/needs_review/opportunities/successes, refresh, metrics, ai-costs, insights, alerts, recommendations, approvals decide, settings, experiments). Frontend admin module PENDING (built next).
- Collections: op_metrics, op_alerts, op_insights, op_recommendations, op_approvals, ai_usage_records, op_experiments, op_settings.
- Curl-verified: dashboard summary + connectors + 5 domains, ai-costs, refresh 200.

Test credentials: demo_home@diyhomie.com / Test1234 ; admin Diyhomieapp@gmail.com / diyhomie1122.

---
## Session update (fork) cont. — Blueprint 26 shipped

**B26 Asset Exit, Resale & Responsible Disposition Engine** — `asset_exit_engine.py` (additive). Flow: identify → assess condition (user-reported AND optional AI photo-observed, kept SEPARATE; AI never certifies function/authenticity/safety) → estimate exit paths (AI valuation ranges, always ESTIMATES not offers) → compare effort/speed/value/suitability → route to approved partner (user-value ranking, commission last, disclosures shown) → complete → asset lifecycle update (hi_assets status sold/traded_in/donated/recycled/disposed; inventory archived; history preserved). DIYhomie holds no funds / verifies no buyers / handles no payments. Private-sale safety education included. Recycle/donate/dispose flagged needs_verification (local rules vary).
- User: `/api/hi/exit/*` (config, cases CRUD, assess, options, compare w/ highlights best/highest-return/fastest/lowest-effort/most-sustainable, select, safety, listing generate+review, complete, report-valuation). Screens `app/home-intel/exit/{index,[id]}.tsx`. Entry: HI dashboard "Sell, Donate or Recycle" (testID hi-exit).
- Admin: `/api/hi/admin/exit/*` (dashboard, categories enable/disable, partners CRUD+pause/activate, valuation flags resolve). Module `AssetExitModule.tsx` → /admin key `assetexit`. 7 seeded exit partners.
- Curl-verified: full flow (start→assess→options w/ AI valuation $300-400 for iPhone→compare best=private_sale→complete sold), admin dashboard, demo→403 on admin. AI valuation/listing use _llm_json (feature_area tagged for B25 cost tracking).

Admin nav order now starts: Overview, Homie HQ, Asset Exit & Resale, Product Analytics, ... + Rewards Funding.

---
## Session update (fork) cont. — Blueprint 27 shipped

**B27 AR Step-by-Step Visual Guidance Runtime** — `ar_guidance_engine.py` (additive, provider-AGNOSTIC). True AR overlays (Unity/ARKit/ARCore) run ONLY in a native build; this engine owns everything provider-independent & always testable: eligibility + safety gateway, spatial-context resolver, guidance content builder (from APPROVED hi_project_steps), session state machine, per-instruction confirmation, outcome recording, strict fallback (AR→2D→text→professional). Hard rules honored: AR optional & never blocks text; session tied to room/asset/project/work-item; NO hidden stud/wire/pipe/structural claims (unverified→"ESTIMATED"); progress updates ONLY on explicit user confirmation; safety-critical/professional work gated out (PROFESSIONAL_REQUIRED / NOT_RECOMMENDED).
- Eligibility statuses: AVAILABLE/LIMITED/UNAVAILABLE/NOT_RECOMMENDED/PROFESSIONAL_REQUIRED (device/platform/camera/risk/measurement-confidence/room-context aware). Web & non-AR devices → LIMITED (2D). Hazard keywords (electrical panel, gas, structural, roof, asbestos…) → PROFESSIONAL_REQUIRED.
- User: `/api/hi/ar/*` (eligibility, sessions CRUD, calibrate, instructions confirm/skip, pause/resume/recenter, report-tracking, fallback, complete{work_item_confirmed}, cancel). Screen `app/home-intel/ar/index.tsx` (status card → start guided view → one-instruction runner w/ overlay chip, ESTIMATED tag, safety notes, controls Text/Recenter/Tracking/Pause/Safety/Exit, always-available text list, finish modal that never auto-completes task). Entry: project workspace "View Steps in AR" (proj-ar).
- Admin: `/api/hi/admin/ar/*` (settings, categories, platforms, guidance-types disable, dashboard w/ completion rate + tracking-failure metrics). Module `ARModule.tsx` → /admin key `arguidance`.
- Curl-verified: eligibility(web→LIMITED/estimated, ios→LIMITED for generic), session start→calibrate→confirm→complete (work_item_updated=false when not confirmed), admin dashboard, demo→403.
- Collections: ar_sessions, ar_anchors, ar_instructions, ar_outcomes, ar_settings.
- NOTE for user: live camera AR overlays require Publish + a native iOS/Android build — not testable in Expo Go/web. The guided runtime + fallbacks work everywhere now.

Admin nav order: Overview, Homie HQ, Asset Exit & Resale, AR Guidance, Product Analytics, ...

---
## Session update (fork) cont. — Blueprints 28 & 29 shipped

**B28 Notification, Reminder & Communication Orchestration** — `notification_engine.py` (additive over existing reminders/push/email). In-app inbox (always-available fallback), per-category×channel preference matrix + marketing opt-in consent, priority model (emergency/high/normal/low/marketing), Eligibility Engine (consent, quiet hours, daily frequency caps, 24h dedupe, admin category gate, pause-nonessential, safety override), template composer (versioned, approval-gated for safety/billing/marketing), full delivery tracking + audit + suppression reasons. Public `notify()` helper wired into rewards_funding fulfillment (redemption_completed). Safety always reaches inbox & bypasses quiet hours; marketing needs opt-in; push lock-screen text truncated for non-safety.
- User: `/api/hi/notifications/*` (inbox, unread-count, read/read-all/archive, open w/ entity-access validation, preferences, marketing-consent, test). Screens `app/home-intel/inbox.tsx` + `notification-settings.tsx`. Entry: bell w/ unread badge on HI dashboard header (hi-inbox).
- Admin: `/api/hi/admin/notifications/*` (settings, categories, templates CRUD + approve/activate/archive w/ versioning, dashboard delivery-health + open rate + suppressions, delivery retry). Module `NotifOrchestrationModule.tsx` → /admin key `notiforch` (label "Notification Center"). NOTE: existing key `notifications`="Broadcast" is a SEPARATE marketing-broadcast module — do not confuse.
- Curl-verified: test→inbox delivered, marketing suppressed w/o consent (user_opt_out), safety can't be disabled (400), admin dashboard + 10 seeded templates, demo→403.
- Collections: notif_events, notif_templates, notif_preferences, notif_deliveries, notif_suppressions, notif_inbox, notif_settings.

**B29 Permit, Code Awareness & Regulatory Guidance** — `compliance_engine.py` (additive). Classifies project scope (electrical/plumbing/structural/mechanical/roofing/demolition/exterior/accessory/cosmetic) → assessment level (general_guidance/verify_locally/permit_inquiry_recommended/professional_review_recommended). Retrieves APPROVED+ACTIVE versioned rules (source_reference + source_date + confidence; expired/undated never shown as current). Builds checklist + standard authority questions. Preliminary doc package (labeled NOT permit-ready/code-compliant/engineered). Professional escalation advisory link → B12 job summary. NO legal advice / no guaranteed "no permit required"; missing jurisdiction → "DIYhomie does not have verified local requirements for this location."
- User: `/api/hi/compliance/*` (categories, jurisdiction get/put, assess, assessments/{project}, checklist status, mark verified, package create/get/status, report). Screen `app/home-intel/compliance.tsx`. Entry: project workspace "Permits & Code Check" (proj-compliance).
- Admin: `/api/hi/admin/compliance/*` (settings, categories, rules CRUD + status w/ versioning + source-date gate, dashboard, flags resolve). Module `ComplianceModule.tsx` → /admin key `compliance` (label "Permit & Code"). 10 seeded rules.
- Curl-verified: hazardous project (remove load-bearing wall + electrical) → professional_review_recommended, cats [electrical,structural], 3 rules + 7 checklist, escalation reasons, "no verified local data" summary; jurisdiction set (user_entered); package created w/ preliminary label & address excluded; admin dashboard; demo→403.
- Collections: jurisdiction_profiles, compliance_rules(+versions), project_compliance_assessments, compliance_checklist_items, compliance_doc_packages, compliance_flags, compliance_settings.

Admin nav order: Overview, Homie HQ, Asset Exit & Resale, AR Guidance, Notification Center, Permit & Code, Product Analytics, ...
