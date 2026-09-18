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

Test credentials: demo_home@diyhomie.com (password in test_credentials.md) ; admin Diyhomieapp@gmail.com (password in test_credentials.md).

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
- Backend curl-verified end-to-end (invite→register→accept→shared-with-me→scoped perms→403 enforcement). TEST USER: collab_test@diyhomie.com (password in test_credentials.md). Frontend E2E pending testing_agent.

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

Test credentials: demo_home@diyhomie.com (password in test_credentials.md) ; admin Diyhomieapp@gmail.com (password in test_credentials.md).

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

---
## Session update (fork) cont. — Blueprints 30–34 shipped

- **B30 Professional Existing Conditions Workspace** — completed the admin surface: `ProWorkspaceModule.tsx` (dashboard stats, feature/auto-approve toggles, professional approve/suspend) → /admin key `proworkspace`. Added user entry tile `hi-pro-workspace` on HI dashboard → /pro-workspace (user screens + backend `pro_workspace_engine.py` were already built). Verified iter73.

- **B31 Data Governance, Privacy, Retention & Account Portability** — NEW `data_governance_engine.py`. Consent model (12 types, required ones implicitly granted), data-classification map (A–E), retention policies (seeded), step-up **REAUTH** for high-risk actions (POST /api/hi/privacy/reauth → one-time, action-bound, TTL grant consumed via X-Reauth-Token header; OAuth-only users w/o password → 409). Data export (reauth-gated, access-controlled + expiring download token, excludes secrets/other users/blobs). Account deletion (async, 30-day recovery, revokes shares/collab/integrations, queues per-category jobs, records legal retention exceptions, cancelable). Property deletion (impact preview + reauth + revoke + cascade delete, blocks deleting only home). Sharing registry (live from pro_share_links + prop_members) + revoke. AI/analytics opt-in controls. Admin `/api/hi/admin/privacy/*` (dashboard, retention CRUD, deletions queue, privacy incidents). User screen `/home-intel/privacy` (tile `hi-privacy`), admin `DataGovernanceModule` key `datagovernance`. Reauth pattern via integration_expert. Verified iter73 (28/28 backend). `api` helper gained optional `headers`.

- **B32 Home Intelligence Dashboard & Property Health Timeline** — NEW `dashboard_engine.py`. Snapshot aggregates live from existing collections; **attention engine** ranks Urgent/Needs Attention/Upcoming/Suggested (safety from hi_issues emergency/high; maintenance overdue/due-soon; project blockers/active; open pro jobs; doc review; setup suggestions). Overrides collection for snooze/dismiss (safety can't be silently dismissed — requires acknowledge). Live merged **timeline** (projects/assets/docs/measurements/maintenance/pro-jobs + user notes) w/ filters. Homie AI summary (uses only authorized data, safety-first, toggleable). Profile-completion ("Home information coverage", no risk/value score). Screens `/home-intel/dashboard` (tile `hi-dashboard`) + `/home-intel/timeline`. Verified iter73.

- **B33 Mobile Offline, Sync & Conflict Resolution** — NEW `sync_engine.py`. POST /api/hi/sync/push accepts batched offline writes in dependency order; idempotency via `sync_ledger` (unique key); SAFE append ops auto-apply (note/measurement/timeline/photo/step-complete/maintenance-complete); REVIEW ops (room_rename/asset_update/step_edit) with stale base_version → **SyncConflict** (never overwrites); financial/reward/billing ops blocked offline. Conflict resolve (keep_mine/use_latest/save_as_note/discard, audit-logged; permission_conflict blocks keep_mine). Media finalize (checksum dedupe), saved-questions CRUD, bundled offline emergency **safety-content**. Client: `src/utils/offlineQueue.ts` (AsyncStorage queue + flush), `/home-intel/sync` Sync Center (tile `hi-sync`, expo-network connection state). Verified iter74 (23/23 backend).

- **B34 Homie Avatar, Voice & Multimodal Runtime** — NEW `multimodal_engine.py`. UI runtime over same property-aware Homie intelligence + safety. Sessions (text/voice/avatar_future/mixed; avatar_future falls back to text unless flag on). Ask → structured response {spoken, full_text, action_cards, emotion, gesture, clarifying_question, stop_condition}; EMERGENCY keyword short-circuit (urgent/warning, no normal guidance). Speech records (STT via existing /api/hi/transcribe; low-confidence → prompt repeat). Hands-free project commands (repeat/next/prev/tools/stuck/pause/ask/stop; next_step needs confirm; high-risk/professional projects block voice progression). Voice-response + avatar-instruction records. Admin `/api/hi/admin/voice/*` (settings: input/output/avatar/high-risk toggles + free-plan limit; dashboard). Screen `/home-intel/voice` (tile `hi-voice`, accessibility: larger text, mute, always-on captions), admin `VoiceModule` key `voice`. Verified iter74 (frontend + backend); FIXED admin VoiceModule blank (useFocusEffect→useEffect for child admin module).

### Admin nav order now includes: … Permit & Code, Pro Workspace, Data Governance, Voice & Avatar, CFO Dashboard, …
### PENDING QUEUE: B14 Photo Room Design (Gemini Nano Banana); B17 AI Orchestration Gateway (will consolidate AI prompts incl. B32 summary & B34 responses); Twin-from-photos.

---
## Session update (fork) — Blueprints 37–43 shipped

- **B37 Release & QA / B38 Investor Intel / B39 Platform Architecture** — backends (`release_engine.py`, `investor_intel_engine.py`, `platform_engine.py`) all wired into server.py + admin modules mounted: keys `release`, `invintel`, `platform`. B39 exposes domains/api-standards/events. Verified iter77.

- **B40 Design System, Navigation & Accessibility Foundation** — NEW `design_engine.py`. Public read-only tokens/registry: `/api/hi/design/tokens`, `/api/hi/design/foundation` (color/typography/spacing/radius/elevation/motion tokens, 4 safety statuses, AI-response sections, component registry, required states, accessibility requirements, consumer nav Home/Projects/Homie/My Home/Profile). Admin governance `/api/hi/admin/design/*` (DesignComponentVersion CRUD; a11y-review gate: cannot approve before a11y passed; safety_card can't be born approved). Frontend: extended `src/theme.ts` (elevation, motion, typography roles, safety palette, a11y.minTouchTarget). NEW reusable UI lib `src/components/ui/` (Button primary/secondary/danger, SafetyCard 4 levels icon+text non-color, AIResponseCard + ConfidenceLabel, EmptyState/LoadingState/ErrorState/OfflineState — all with a11y labels, disabled/loading, 44pt targets). Showcase screen `/design-system`. Admin `DesignModule` key `design`. Verified iter77.

- **B41 Universal Search, Discovery & Contextual Navigation** — NEW `search_engine.py`. Federated authorization-first search (resolves caller's active hi_property; never returns other users' data) across rooms/assets/documents/projects/maintenance/measurements + approved global templates/expert_guides/community. Ranking: owned > global, exact>startswith>contains; grouped My Home / My Projects / Home Care / Guides / Community Experiences; deep links per entity. **Homie-style summary** (source-aware, exact/likely/general, never fabricates). `POST /select` logs opened result. Admin `/api/hi/admin/search/*` (health, reindex snapshot, config excluded_types + community_in_search + log_retention, synonyms CRUD, logs + no_results). Observability events registered in analytics_engine (search_*). Frontend: global search `/find` (grouped cards, no-result action chips, summary banner), entry points: Home header magnify (home-search), Projects header (projects-search), My Home header (hi-search). Admin `SearchModule` key `searchops`. Verified iter77.

- **B42 Customer Support Intelligence** — NEW `support_engine.py`. Support AI distinct from Homie; **namespaced under `/api/hi/help/*`** (NOT /api/hi/support — legacy admin_ops engine owns that prefix; collision fixed). Approved-KB-scoped deterministic assistant (Dify-pluggable later): intake classifier (category guess + priority rules: critical keywords→critical, privacy_data→critical, billing/access→high, feature request→low), self-service KB retrieval, duplicate detection, known-incident awareness (reads rel_incidents from B37), escalation recommendation, guardrail disclaimer (no billing changes/refund promises/legal advice). Ticket model (sup_tickets/messages/resolutions/feedback/kb/access_log), contextual metadata only (screen/app_version/error_code — never docs/photos/payment/address), cross-user isolation. Admin `/api/hi/admin/help/*` (dashboard, priority-sorted queue, assign/priority/status/link-incident, internal notes vs replies→waiting_user, resolve, KB CRUD w/ versioning, access log). 12 seeded KB articles (published). Frontend: `/help` (categories, assist, self-service, ticket create, My tickets) + `/help/[id]` (thread, reply, star feedback, reopen). Entry: Profile "Support Center" (profile-help-center). Admin `SupportModule` key `supportops`. Verified iter78 (22/22).

- **B43 Property Data Import & Evidence Reconciliation** — NEW `import_engine.py`. Sources upload/photo/manual (external_provider_future stubbed). Import jobs → evidence records → reconciliation issues (new_information/duplicate/conflict). Source reliability priority (user_confirmed highest). **User-confirmed data never auto-overwritten** — conflict issues carry protected=true. Resolve actions accept/edit→writes hi_property_facts (user_confirmed) + syncs address/home_type native cols; keep/ignore→reject; defer. Non-authoritative disclaimer (no permit/boundary/ownership/sqft/structural certification). Admin `/api/hi/admin/import/*` (dashboard, sources CRUD + status). Frontend: `/home-intel/import` (field-chip manual entry, reconciliation review cards Add-to-My-Home/Keep-existing/Ask-Homie). Entry: My Home "Add Property Information" (hi-import). Admin `ImportModule` key `importops`. Observability events registered (property_import_*, reconciliation_*). Verified iter78.

### Admin nav additions: Design System (design), Universal Search (searchops), Support Desk (supportops), Property Import (importops), Release & QA (release), Investor Intel (invintel), Platform Architecture (platform).
### PENDING: Supabase integration (user requested; awaiting scope + credentials — see below). B14 Photo Room Design (Gemini Nano Banana); B17 AI Orchestration Gateway.
### NOTE: Supabase request — user gave only email (hubrandz@gmail.com). Need scope (auth vs DB vs storage) + Project URL + anon key + service_role key. App currently uses protected MongoDB; must clarify before any change.

---
## Continuous Project Intelligence Orchestrator (Foundation Layer) — SHIPPED
Additive coordination layer making DIYhomie behave as one system. Runs on protected MongoDB; **user-scoped authorization = RLS-equivalent** (Supabase deferred by user). NEW `orchestrator_engine.py` @ `/api/hi/orchestrator/*`. Collections: orch_projects, orch_tasks, orch_decisions, orch_events(append-only), orch_risks, orch_requirements.
- **Intent router** (deterministic): NL -> {projectType, goals, scope, unknowns, recommendedEngines}. Creates project + seeds ~9-10 tasks with dependencies + auto code-risk for electrical/plumbing.
- **Lifecycle**: 13 phases DISCOVERY..MAINTAIN + states ACTIVE/PAUSED/BLOCKED/SAFETY_HOLD/PROFESSIONAL_REVIEW_REQUIRED/ARCHIVED/COMPLETED.
- **Health engine** (green/yellow/orange/red) surfaced in Homie voice + can_continue_other_task.
- **Next Best Action** strict priority: safety > code/pro > missing prereq > blocked dep > procurement > execution > verify > complete. Returns action/reason/why/workspace/task_id.
- **Task deps**: completing recomputes availability (pending->available), emits SCHEDULE_RECALCULATED.
- **Decision states** idea/scenario/selected/committed/rejected/superseded; commit -> ripple_recommended.
- **Ripple engine**: measurement/design change recalcs material qty + cost; requires_confirmation for spend/committed/safety; auto-applies low-risk.
- **Safety/code holds** block only affected tasks; resume won't clear an open safety hold; completion blocked until resolved.
- **Completion audit + Project Passport** (materials/tools/approx_cost/tasks). Knowledge consent required.
- **Engine contract** `POST /projects/{id}/engine-submit`: engines submit structured recs (risks/requirements) — never mutate state directly.
- Frontend: My Home 'Guided Projects' (hi-orchestrator) -> `/home-intel/orchestrator` (intent create + list w/ health dot + next action), `/orchestrator/[id]` (phase, health SafetyCard, YOUR NEXT STEP w/ Why? + Start/Done, plan list, pause/resume/complete), `/orchestrator/events/[id]` (activity log).
- Verified iteration 79 (17/17 backend + frontend). Non-blocking: requirements PUT uses raw query param; engine file ~758 lines.

---
## Savings Intelligence & Project Funding Engine — Phase 1 (Project Affordability MVP) SHIPPED
"Fund This Project" — a Project Savings Planner (NOT coupon/financial advice), tied into the Orchestrator. NEW `funding_engine.py` @ `/api/hi/funding/*` + `/api/hi/admin/funding/*`. Collections: fund_goals, fund_events, fund_ledger(immutable), fund_config. NO card/provider dependency — Kard(Phase3)/BenefitHub(Phase4) are inert feature flags in admin config; affiliates(Phase2) flag only. Gated on real provider agreements + server-side keys (none stored).
- **Two-sided affordability**: Reduce Project Cost (owned/ToolShare, best-value alternative, community/used, phase scope — derived from orch_requirements; applying lowers the linked requirement cost) + Log Savings.
- **Strict classifications NEVER conflated**: confirmed (reduces confirmed gap) / pending / expected (reduces likely gap only) / potential (info only, no gap reduction) / opportunistic (never counts toward goal). Two gaps: remaining_confirmed_gap & remaining_likely_gap.
- **Savings Wallet** (month/lifetime confirmed, pending, active goals) — never shows internal revenue.
- **Orchestrator events**: PROJECT_FUNDING_TARGET_SET, SAVINGS_REWARD_CONFIRMED, PROJECT_COST_ALTERNATIVE_FOUND appended to project activity.
- **Admin**: dashboard (confirmed savings, cost-reduction vs offer savings, completion rate, internal_revenue tracked separately=0), config toggles (enabled, conservative_forecast, provider flags, categories, thresholds), ledger view.
- Analytics events registered (fund_this_project_opened, funding_goal_created, savings_scan_*, project_cost_reduced, reward_confirmed, project_funding_goal_reached).
- Frontend: `/home-intel/funding/[id]` (goal, plan w/ 4 separate classifications + 2 gaps, cost-reduction scan/apply, log savings), `/home-intel/savings-wallet`. Entries: orchestrator detail 'Fund This Project' (pd-fund), My Home 'My Savings' (hi-wallet). Admin FundingModule key `fundingops`.
- Verified iteration 80 (16/16 backend + frontend). Non-blocking: ledger status marks expected/potential/opportunistic as 'pending' internally (user-facing plan is correct/separated).
### FUTURE (gated on user): Funding Phases 2-5 (provider adapters, unified offer catalog, merchant identity graph, Kard card-linked, BenefitHub member discounts, forecasting) — need Kard/BenefitHub agreements + keys.

---
## Project Handoffs: Shopping List & Home Report (additive) — SHIPPED
Decision: user said "stop asking, give best recommendation" + build "all" 4 items. Chose to EXTEND existing MongoDB platform (Supabase parked/no keys) — no re-platform, nothing broken. Built the two highest-value, self-contained items first.
NEW `handoff_engine.py` @ `/api/hi/handoff/*` (reads orchestrator + funding data, user-scoped).
- **Shopping Handoff**: GET /shopping/{pid} -> items from orch_requirements with running to_buy/owned/grand totals; POST /shopping/{pid}/items/{id}/purchased toggles owned<->need_to_buy (emits PROCUREMENT_UPDATED). Honest: uses project estimates, no fake live pricing (retailer integration = future).
- **Home Report**: GET /report/{pid} -> shareable summary from Project Passport + property/materials/tools/decisions/tasks/confirmed-savings + plain-language share_text (insurance/resale). Excludes resolved risks. completed flag true only when project COMPLETED.
- Frontend: `/home-intel/orchestrator/shopping/[id]` (totals + tap-to-toggle purchased) & `/orchestrator/report/[id]` (sections + native Share). Entry cards on project detail: pd-shopping, pd-report.
- Verified iteration 81 (8/8 backend + frontend). Non-blocking notes addressed (resolved-risk filter applied).
### STILL QUEUED (user wants all): Homie Talks Money (chat "I need $X" -> open funding plan — needs chat-screen wiring); Kard Rewards (needs Kard provider agreement + server-side keys — inert adapter flag exists). Foundation Sprint households/multi-member sharing + roles + dedicated Issue-Intake flow remain (much already exists via hi_* + orchestrator + emergency safety). Supabase re-platform deferred (no keys).

---

## DIYhomie "Build Documents" Program (Guided Repair → Home OS) — added this session

The user is delivering a sequential program of build docs. Status:

### ✅ Build Doc 2 — Guided Repair & Evidence-to-Plan Engine (DONE, tested 27/27)
- Module: `/app/backend/guided_repair_engine.py`, namespace `/api/hi/repair/*` (+ admin `/api/hi/admin/repair/*`).
- Intake + deterministic static safety triage (hard-stop blocks plan; soft-escalation observation-only), Evidence Workspace, versioned Assessment (ranked causes, confidence, missing info, DIY boundary), progressive questions, repair conversation, repair plan, reality-check/replan, Decision Ledger, Project Position, admin quality queue.
- Frontend: `app/home-intel/repair/{index,new,[id]}.tsx`, `repair/chat/[id].tsx`. HI dashboard card `hi-repair`.

### ✅ Build Doc 3 — Guided Project Execution & Adaptive Coaching (DONE, tested)
- Extended `guided_repair_engine.py`: execution session + briefing (`/start`), progress summary, session-action (pause/resume/archive/professional_handoff), richer task states + **checkpoint gating** (required/stop → awaiting_verification → `/checkpoint`), task audit events (`gr_task_events`), adaptive `/coach`, tools/materials on plan + `/materials`, prerequisite guard, `/verify-start`.
- Frontend: enhanced `repair/[id].tsx` (progress bar, tools chips, coach chips, checkpoint form, pause/pro buttons), `repair/closeout/[id].tsx`.

### ✅ Build Doc 4 — Project Memory, Outcome Intelligence & Property Record (DONE, tested 30/30)
- Module: `/app/backend/property_record_engine.py`, namespace `/api/hi/record/*` (+ public `/shared/{token}`, admin `/api/hi/admin/record/*`).
- Closeout outcome records (5 outcome states; "completed" ≠ "resolved"), property timeline (provenance-tagged, aggregated), follow-ups/monitoring (complete/snooze/dismiss/convert→new issue), room/asset history + link correction, prior-project **context retrieval** during intake, reopen/continuation (history preserved), share/export with disclaimer, admin outcome signals.
- Frontend: `app/home-intel/record/index.tsx` (dashboard/timeline/follow-ups), context banner in `repair/new.tsx`, reopen button in workspace. HI card `hi-record`.

### ✅ Build Doc 5 — Visual Evidence, Measurement & AR Guidance (DONE, tested 34/34 combined w/ Doc 6)
- Module: `/app/backend/visual_engine.py`, namespace `/api/hi/visual/*` (+ admin). Uses gpt-4o vision via EMERGENT_LLM_KEY.
- Purpose-driven capture templates (6), structured measurements w/ **deterministic unit conversion**, versioned annotations w/ author attribution, visual inference with **hard safety rule** (high-risk targets → professional_verification_required + high_risk_blocked, never authorizes action; quality warnings), AR sessions with 2D fallback + native-build flag. Admin visual quality queue.
- Frontend: measurement/AR are largely native-camera; exposed via API. (No dedicated visual UI screen yet — candidate for follow-up.)

### ✅ Build Doc 6 — Proactive Home Maintenance & Priority Intelligence (DONE, tested)
- Module: `/app/backend/home_care_engine.py`, namespace `/api/hi/care/*` (+ admin). Complements pre-existing `/api/hi/maintenance`.
- Deterministic, explainable recommendation engine (reason_trace + priority_category, max 3 primary), seasonal rules, asset maintenance profiles, transparent priority scoring, defer/dismiss/schedule feedback, guided maintenance task execution reusing Doc 3 shape, **abnormal finding → converts to Guided Repair issue**, calendar, notification prefs, admin signals.
- Frontend: `app/home-intel/care/{index,task/[id]}.tsx`. HI card `hi-care`.

### 🟡 QUEUED (documented, NOT yet built) — next session
- **Build Doc 7 — Project Materials, Tools & Cost Intelligence**: readiness checklist, structured BOM (required/optional/unknown + source/confidence), user inventory, transparent budget ranges w/ assumptions, compatibility/substitute guidance → Decision Ledger, procurement prep lists (buy/borrow/rent/verify), cost/readiness replan. Namespace suggestion `/api/hi/readiness/*`. Reuses plan.tools_materials from Doc 3 + measurements from Doc 5.
- **Build Doc 8 — Professional Handoff, Scope & Service Coordination**: escalation decision framework (4 states), handoff brief (user-selected evidence, provenance-tagged), trade/service-type guidance (categories not providers), visit prep, professional findings capture + document uploads, scope comparison, post-handoff continuation (professionally_completed / reopen), revocable sharing, future service-request drafts. Namespace suggestion `/api/hi/handoff-pro/*` (avoid existing `/api/hi/handoff`). Builds on existing escalation/queue signals.
- **Build Doc 9 — Homie Voice, Avatar & Adaptive Communication**: unified conversation context, text/push-to-talk voice/spoken+captions/avatar modes, task-aware voice coaching commands, adaptive explanation levels, avatar demo layer (P1), safety-interrupt rules, conversation→structured outcome events + Decision Ledger, accessibility/communication prefs, comm quality queue. Voice STT/TTS = Emergent OpenAI Whisper/TTS integration (needs integration_expert). Note: mic/voice features require native build to fully validate.

**Testing note:** Docs 2–6 all validated by testing_agent (iterations 82, 83, 84). Backend pytest for Doc 5/6 at `/app/test_reports/pytest/b5_b6_iter84.xml`.


## Session update (fork) — Build Docs 7, 8, 9, 11, 12 + Doc 5 polish SHIPPED (tested 24/24 backend + frontend 100%, iteration_85)

### ✅ Build Doc 7 — Project Materials, Tools & Cost Intelligence (DONE, tested)
- Module: `/app/backend/readiness_engine.py`, namespace `/api/hi/readiness/*` (+ admin `/api/hi/admin/readiness/signals`).
- Versioned BOM (`rd_boms`) grounded in latest gr_plan (AI + deterministic fallback): requirement (required/optional/unknown), honest cost_low/high + cost_assumptions + disclaimer, confidence, rent_candidate, substitute_hint, deterministic toolbox match vs `hi_inventory_items`. Item statuses: have_it/will_buy/will_borrow/will_rent/need_verification/skipped (syncs back to plan material chips). readiness_pct + to-spend range + procurement lists (buy/borrow/rent/verify). Compatibility Q&A (`/ask`) → verdict + what_to_verify + logs `gr_decisions`. Stale-BOM detection on plan version change (rebuild keeps user statuses).
- Frontend: `app/home-intel/repair/readiness/[id].tsx`; entry banner `rw-readiness` in repair workspace.

### ✅ Build Doc 8 — Professional Handoff, Scope & Service Coordination (DONE, tested)
- Module: `/app/backend/pro_handoff_engine.py`, namespace `/api/hi/handoff-pro/*` (+ public `/shared/{token}`, admin signals).
- Deterministic 4-state escalation framework (diy_appropriate/diy_with_caution/professional_recommended/professional_required) from triage/assessment/plan/blockers + trade-category map (categories, never providers). Versioned handoff brief (`ph_briefs`): AI summary + provenance-tagged sections (evidence/what-was-tried/safety flags), questions_to_ask, visit-prep checklist. Share token 30-day expiry + revoke (`ph_shares`). Professional findings capture (`ph_findings`, followup_needed → gr_followups + timeline). Scope comparison (respectful; → gr_decisions). Post-handoff continuation: professionally_completed (→gr_outcomes) / reopen_diy / monitoring (→followup); all → gr_timeline.
- Frontend: `app/home-intel/repair/pro/[id].tsx`; `rw-pro` button in workspace now routes here.

### ✅ Build Doc 9 — Talk to Homie: voice upgrades (DONE, tested; full audio needs native build)
- Extended `/app/backend/multimodal_engine.py`: `POST /api/hi/voice/tts` (OpenAI tts-1 "coral" via Emergent key, sanitized, Mongo-cached `tts_cache`, hashed keys) + public `GET /api/hi/voice/tts/{key}.mp3` (audio/mpeg, cacheable); `POST /sessions/{sid}/simplify` ("say it simpler").
- Frontend `voice.tsx`: push-to-talk via expo-audio (permission contract: check → contextual ask → Open Settings on denial) → upload to `/api/hi/transcribe` (Whisper) → ask; spoken playback via createAudioPlayer (auto after answers, Replay button); "Say it simpler" button. Captions always on. ⚠️ Recording/playback fully testable only on a native device build.
- New dep: `expo-audio@~1.1.1` (yarn expo install).

### ✅ Build Doc 11 — Property Brain / "What Homie Knows" (DONE, tested)
- Module: `/app/backend/property_brain_engine.py`, namespace `/api/hi/brain/*` (+ admin signals). NEW layers only (rooms/assets/docs engines reused, not duplicated).
- Occupancy role (owner/renter/household_member) on hi_properties + renter mode boundary + exportable renter maintenance report (`/renter-report`). Context facts w/ provenance (`pb_facts`: user_entered/user_confirmed/inferred/document; statuses active/outdated/removed; "correct" preserves history). `/summary`: confirmed records (derived counts), known details, unknowns w/ why (Unknown = valid state), completeness % (useful-not-numerous), single next_best_detail. Contextual context-requests during projects (`pb_context_requests`, deterministic category→question map, once per issue, optional, answer also files gr_evidence).
- Frontend: `app/home-intel/brain/index.tsx` (HI card `hi-brain`); `src/components/ContextRequestCard.tsx` embedded in repair workspace.

### ✅ Build Doc 12 — Home Command Center & Project Portfolio (DONE, tested)
- Module: `/app/backend/command_center_engine.py`, namespace `/api/hi/command/*`. 100% deterministic priority engine w/ reason traces (safety rank 1 always; overdue followups/maintenance rank 2; blocked/info-needed projects rank 3; open followups 4; upcoming maintenance 5). One Do-next + max-3 top priorities; multiple urgent items all shown. 7-state portfolio (needs_attention/in_progress/waiting_verification/paused/professional_review/monitoring/completed) w/ current-task resume cards. `/resume/{iid}` context briefing (long-pause refresher w/ safety boundary). defer(7d)/dismiss/restore (`cc_item_actions`; safety → 409). Preferences (`cc_prefs`): focus (never overrides safety), hide_completed, pins. Recent activity from gr_timeline. Calm empty state (no manufactured urgency).
- Frontend: `app/home-intel/command/index.tsx` (HI card `hi-command`, top of dashboard).

### ✅ Doc 5 polish — Guided Capture screen (DONE, tested)
- Frontend: `app/home-intel/repair/capture/[id].tsx`: capture-template picker (visual_engine templates), framing/distance/privacy guidance + will/won't-infer transparency, camera/upload (permission contract via pickImage), annotation note, save→evidence + capture-request, "Analyze with Homie" (visual infer, safety-gated), manual measurement recorder (type/value/unit cycle). Entry `rw-guided-capture` in workspace evidence row.

### 🟡 QUEUED (user pasted docs mid-session — NOT yet built; most extend existing engines)
- **Doc 13 — Project-First Marketplace & Smart Procurement**: builds directly on readiness_engine BOM + product_recommendation/affiliate engines (B23). Project-gated recs, compatibility labels (Confirmed fit/Verify fit/Alternative/Not recommended), project cart synced to readiness, consent-aware attribution + disclosures, admin quality controls.
- **Doc 14 — Household Identity, Permissions, Consent & Collaboration**: EXTEND `collaboration_engine.py` (B22 already has roles/invites/expiring guest access/audit). Add: role templates (co-owner/tenant/property-manager/contractor/designer), granular permission grants, consent center, privacy levels per object, shared links w/ password/expiry, step-up auth, My Access page. KEEP MongoDB (ignore Supabase RLS references — enforce in API layer).
- **Doc 15 — Event, Automation & Notification Engine**: EXTEND `notification_engine.py` (B28) + automation rules (#13). Add: immutable event stream, quiet hours, priority levels (critical bypass), digests, rate limits, household-aware routing, admin automation center.
- **Doc 16 — Knowledge/RAG & Answer Quality**: EXTEND `knowledge_graph_engine.py` (B20). Add: authority tiers, confidence classes (verified/high/conditional/needs_verification/professional_required), "Why?" evidence view, knowledge gaps queue, eval suite.
- **Doc 17 — Mobile Field Companion & AR Evidence**: mostly covered (visual_engine, guided capture screen, ar_guidance_engine, sync_engine offline). Add: guided video capture, wall-scan confidence states (default Unknown), vision observation objects, capture quality coaching.
- **Doc 18 — Home Record, Asset Lifecycle & Maintenance**: mostly covered (assets/maintenance/timeline/doc vault). Add: lifecycle statuses, replacement planning, warranty expiration surfacing, record completeness (reuse brain completeness), Home Transfer Package (future).
- **Doc 19 — Project Planning, Scope, Estimation & Decision Engine**: EXTEND guided_repair + readiness. Add: scope object (included/excluded/unknown/assumptions), multi-option decision engine (A/B/C w/ tradeoffs), estimate categories + contingency %, change orders w/ approval, readiness checklist gate for READY_TO_BUILD.
- Older backlog unchanged: Homie Talks Money (P1), Kard (needs keys), Blueprint 14 photo room design (needs image-gen), BenefitHub, Twin-from-photos, server.py refactor into routers.

**Testing:** iteration_85 — 24/24 backend pytest (`/app/test_reports/pytest/docs_7_12_iter85.xml`) + full frontend E2E pass. No regressions.

## Session update 2 — Build Docs 20 + 13 SHIPPED (18/18 backend pytest + frontend 100%, iteration_86)

### ✅ Build Doc 20 — Tool Inventory, Capability & Project Readiness (DONE, tested)
- Module: `/app/backend/tool_intelligence_engine.py`, namespace `/api/hi/tools/*` (+ admin signals). Reuses Toolbox (hi_inventory_items) + readiness matching.
- AI capability tags w/ limits + safety_notes + power_source per Tool item (`POST /items/{id}/capabilities`, stored on hi_inventory_items). Today's Tool Pack per issue (`GET /pack/{iid}`): tools vs SAFETY GEAR separated; statuses ready / ready_with_alternatives / missing_required / unsafe_tool_gap (safety gaps outrank everything); baseline safety glasses auto-added; checklist state in `tp_packs`. Tool Q&A (`/ask`) capability-grounded verdict (yes/yes_with_care/no/verify_first) → gr_decisions. Buy/rent/borrow advisor (`/procure-advice`) w/ battery-platform detection (regex over brand+name) + honest ranges + disclaimer.
- Frontend: `app/home-intel/repair/toolpack/[id].tsx` (entry `rw-toolpack` in workspace); capabilities section + `invd-caps` button on `inventory/[id].tsx`.

### ✅ Build Doc 13 — Project-First Marketplace & Smart Procurement (DONE, tested)
- Module: `/app/backend/marketplace_engine.py`, namespace `/api/hi/market/*` (+ admin signals/flag). Reuses affiliate_engine retailer config, `_build_link`, DISCLOSURE.
- PROJECT-GATED entry (no BOM → gated:true, no product push). Options per BOM item (cached `mk_options`): compatibility labels confirmed_fit/verify_fit/alternative (not_recommended filtered out), basis + needs_verification, honest ranges, 4 retailer links, budget-pref aware. Fulfillment paths buy/use_owned/borrow/rent/professional_supply → `mk_cart` + syncs rd_boms status; purchased/obtained → have_it (readiness stays truthful). Cart export text. Consent-aware outbound attribution (`mk_attribution`; opt-out keeps links, drops tracking) + visible disclosure before click. Admin: pause category → options 423, resume; signals incl. fulfillment breakdown.
- Frontend: `app/home-intel/repair/market/[id].tsx` (entry `rd-market` banner on readiness screen). Consent checkbox `mk-consent`.

### 🟡 QUEUE additions from this session (user pasted, NOT built)
- **Doc 21 — Local Requirements, Permits & Escalation**: extend pro_handoff + property brain (jurisdiction profile, requirement classification, permit prep pack, utility-locate gate, HOA records, confidence labels).
- **Doc 22 — Professional Network & Collaboration**: heavy overlap w/ Doc 8 (done) + collaboration_engine. New: structured estimate comparison, hybrid DIY/pro work packages, pro workspace, provider status labels.
- **Doc 23 — Community, Sharing & Trust**: extend existing community hub (structured post types, project→post share flow, trust labels, moderation states, reputation).
- **Doc 24 — Subscription, Entitlements & Billing**: extend existing Stripe paywall/upgrade. New: centralized entitlement service (plan_values), grace periods, one-time purchases, refund workflow, admin billing console.
- **Doc 25 — Rewards, Achievements & Impact**: extend existing rewards/achievements. New: verification rules (evidence/review tiers), rewards wallet + transactions, referrals, impact campaigns, fraud controls.
- (Earlier queue Docs 14-19 unchanged — see Session update 1.)

**Testing:** iteration_86 — 18/18 backend (`/app/test_reports/pytest/docs_20_13_iter86.xml`), full frontend E2E pass, regressions clean.

## Session update 3 — Build Doc 26 delta SHIPPED (self-tested: curl + screenshot)
- Doc 26 was ~90% pre-existing (analytics_engine events/consent + homie_hq_engine B25 admin center w/ alerts/insights/experiments/AI costs). Built the missing deltas per user choices (feedback=yes, scorecard=skipped, funnel=agent's recommendation):
- `/app/backend/quality_feedback_engine.py`: `POST /api/hi/feedback/submit` (yes/somewhat/no, context-linked → `qf_feedback` + HOMIE_RESPONSE_RATED event; 400 on invalid rating) + admin `GET /api/hi/admin/quality/funnel` (created→assessed→planned→in_progress→completed by category, completion %, abandonment_stage heuristic, feedback breakdown; 403 non-admin).
- `src/components/FeedbackChips.tsx` wired into voice.tsx ("Did this help?" per answer, context homie_answer/session id) and repair workspace plan section ("Does this plan match what you needed?", context project_plan/plan id).
- Verified: curl (submit ok, invalid 400, funnel totals 29→13→13→6→2, non-admin 403) + screenshot of workspace showing chips.
- Doc 27 (Integration Control Center) QUEUED — mostly governance over existing connector/fallback patterns.

## Session update 4 — Build Doc 28 SHIPPED (12/12 backend pytest + frontend E2E, iteration_87) + edge fix
### ✅ Build Doc 28 — Design Studio, Visualization & Design-to-Build (MVP)
- Module: `/app/backend/design_studio_engine.py`, namespace `/api/hi/design-studio/*`. Collections ds_projects/ds_versions/ds_inspirations.
- Design projects (room_refresh/remodel_concept/exterior/build_to_fit) w/ plain-words goal + feel chips + budget + optional room photo. Inspiration notes → "You seem drawn to…" style summary. Concept generation: written direction (_llm_json) + REAL image via **Gemini Nano Banana** (`gemini-3.1-flash-image-preview` via emergentintegrations LlmChat, EMERGENT_LLM_KEY) — room-photo-aware edits when a photo exists; refine creates new version editing the previous image. Honest disclaimer on every concept. Buildability review separates taste/buildability/safety/budget/permit + measure_first. Approve → convert creates gr_issue (source design_studio) flowing into the existing assessment→plan→readiness (Doc 7) pipeline; idempotent (already:true).
- Frontend: `app/home-intel/design/index.tsx` (create form + list) & `[id].tsx` (concept image, version chips, refine, buildability card, approve/convert). Dashboard card `hi-design-studio`.
- Edge fix post-testing: refine on a converted design now 409s; FE gates "Open the build project" on linked_issue_id; stale demo project status repaired.
- Testing: iteration_87 — 12/12 backend (`/app/test_reports/pytest/design_studio_b28_iter87.xml`) + frontend E2E w/ real image gen.
### 🟡 QUEUE additions: Doc 29 (QA/Safety governance & release mgmt — flags/alerts exist, kill-switches/benchmarks pending), Doc 30 (Accessibility & Localization — voice captions/large-text/simpler-mode exist; localization framework pending).

## Session update 5 — Build Doc 31 + Doc 30 SHIPPED (18/18 backend pytest + full frontend E2E, iteration_88)
### ✅ Build Doc 31 — Onboarding, Activation & First-Project Success (MVP: Phases 1-3)
- Module: `/app/backend/activation_engine.py`, namespaces `/api/hi/start/*`. Collections ob_intents/ob_new_home/ob_activation.
- PUBLIC "Ask Homie" intent capture (POST /intent, no auth): safety triage FIRST (reuses guided_repair _triage; gas/fire → emergency safety panel, NO conversion prompt), else LLM classify → need_type/category + immediate value (likely_diagnosis, safe_immediate_action, ONE next_step, outline, first_questions) + deferred save_prompt. Guest token support; pending intent auto-claimed after login (frontend stores diyhomie_pending_intent).
- AUTH: /claim → creates gr_issue (source=onboarding_intent, feeds existing repair pipeline) + first_project_created event; /checklist → 7-step First Project Success Checklist (derived from gr_evidence/gr_plans/rd_boms/phase); /activation → 6 meaningful-action signals, one-time activation_completed; /new-homeowner (+/toggle) → 8-item first-home pathway (address/shutoff/panel/alarms/HVAC/appliances/inspection/maintenance) w/ auto-derived + manual completion.
- Analytics EVENT_CATALOG += project_intent_captured, first_project_created, activation_completed, new_homeowner_pathway_started, accessibility_settings_updated.
- Frontend: `app/home-intel/start.tsx` (intent input + chips + emergency panel + result card + save CTA + first-project checklist), `app/home-intel/new-home.tsx` (new homeowner checklist), dashboard card hi-ask-homie-start.
### ✅ Build Doc 30 — Accessibility, Localization & Inclusive Guidance (MVP)
- Module: `/app/backend/accessibility_engine.py`, namespace `/api/hi/access/*`. Collection hi_access_settings.
- Per-user settings: language (en/es/fr/de/pt/zh), reading_level (simple/standard/detailed), simplified_mode, text_size, voice_guidance, high_contrast, reduce_motion. get_access_context() prompt block WIRED into conversation_hub_engine + project_planner_engine — verified Homie replies in Spanish/simple when set.
- Frontend: `app/home-intel/account/accessibility.tsx` (chips + switches, optimistic PUT), entry row in account settings.
- Testing: iteration_88 — 18/18 backend (`/app/test_reports/pytest/b30_b31_activation_access_iter88.xml`) + all 6 frontend flows pass, regression clean. NOTE: conversation hub endpoint is /api/hi/chat/conversations.
### 🟡 QUEUE additions from this session (user pasted, NOT built)
- **Doc 32 — Data Governance, Privacy, Backup & Portability**: privacy center, data export (project/home record/account), deletion workflow, document versioning, audit log. Partial overlap w/ existing export_engine + audit_engine + privacy screens — build as extension.
- **Doc 33 — Customer Support, Human Escalation & Trust Recovery**: ticket model w/ context-first attachment, Homie handoff summaries, safety incident workflow, support workspace. Heavy overlap w/ existing support_engine.py (507 lines) — extend, don't rebuild.
- **Doc 34 — Platform Reliability, Performance & Scalability**: async job framework, graceful degradation, offline-first, rate limits/AI cost protection, monitoring. Partial overlap w/ monitoring_engine.py, sync_engine.py, offlineQueue.ts — extend.

## Session update 6 — Doc 34 + Docs 33/35/36 deltas SHIPPED (iterations 89 & 90, ALL GREEN)
### ✅ Build Doc 34 — Platform Reliability MVP
- `/app/backend/reliability_engine.py`: async job framework (rl_jobs: queued/running/waiting_provider/completed/failed/retrying/canceled, progress + friendly messages, run_job() bg task w/ 1 retry); AI cost protection (rl_settings ai_daily_per_user=300 + ai_kill_switch, enforce_ai_budget wired into Homie chat + design studio, 429/503 friendly copy); user GET /api/hi/jobs(+/{id},/cancel), GET /api/hi/system/status (6 tiered services, only 5xx degrade); admin /api/hi/admin/reliability (jobs overview, limits, costs by feature/provider).
- Design Studio concept/refine converted to async jobs (returns job_id, frontend polls w/ progress card testID dsd-job-progress). New `app/home-intel/activity.tsx` (Background Activity, account row account-activity), `SystemStatusBanner` on dashboard (hidden when ok).
### ✅ Docs 33/35/36 deltas (existing engines already covered ~80%: data_governance=Doc32, audit+collaboration=Doc35 core, release_engine=Doc36 core, support_engine=Doc33 core)
- Doc 35 §15 sessions: JWT carries token_version ("tv"); POST /api/auth/logout-all bumps it (old tokens 401) + returns fresh token; privacy screen "Sign out of other devices" (testID privacy-logout-all).
- Doc 35 §8 AI privacy: dg_ai_prefs extended (allow_home_context, allow_project_photos, allow_documents, ai_personalization) + get_ai_privacy() helper; ENFORCED in conversation_hub (home context withheld / personalization stripped); 4 new toggles on /home-intel/privacy.
- Doc 33: support ticket category safety_concern → critical + persisted safety_note + hi_safety_escalations record; project tickets (related_entity_type=gr_issue) auto-attach homie_summary (project/category/phase/evidence_items/plan_version/risk_flags). Namespace reminder: /api/hi/help/*.
- Doc 36 §5: 9-case AI benchmark library seeded (rel_ai_cases source=doc36_benchmark).
- Testing: iteration_89 (Doc 34, 11/11 + frontend) & iteration_90 (7/7 + frontend E2E). Auth regression clean.
### 🟡 QUEUE: Doc 37 — Universal Design System & Experience Standards (pasted 3x — NEXT)
- Largely satisfied (semantic tokens in src/theme.ts, ScreenHeader pattern, status badges, safety states, empty/error states). Planned gap pass: universal "Ask Homie about this" contextual launcher on major screens; consistent status label audit; next-best-action check (command_center already does this).

## Session update 7 — Doc 38 deltas SHIPPED (iteration 91 ALL GREEN) + Doc 39 audit: ALREADY COVERED
### ✅ Build Doc 38 — Identity/Auth deltas (integration_expert playbook followed; MongoDB+JWT, Supabase ignored per standing rule)
- Per-device sessions: JWT "sid" claim (backward compatible — legacy tokens w/o sid stay valid), auth_sessions collection (device_name/platform/created/expires 90d/revoked_at); login/register/google create sessions; Expo client sends Platform-derived device info (src/auth.tsx deviceInfo()).
- Endpoints: GET /api/auth/sessions (devices + is_current + recent_activity), POST /api/auth/sessions/{sid}/revoke (single device, no enumeration), /api/auth/logout-all now revokes all session records + returns fresh sid token.
- Security events (auth_security_events): login_success/login_failure/account_created/session_revoked/sessions_revoked_all.
- Frontend: privacy.tsx "Sessions & devices" card (list, This-device marker, revoke, recent activity). Iter-91 cosmetic fix applied (no dup "This device" label). Remaining cosmetic (optional): distinct testID prefix for session revoke vs share revoke.
- Rest of Doc 38 (households/roles/scoped grants/consent/step-up/deletion) was already covered by collaboration_engine + data_governance_engine + audit_engine. MFA for admins NOT built (future).
- Testing: iteration_91 — 20/20 backend + frontend E2E green.
### ✅ Build Doc 39 — Home Graph audit: NO BUILD NEEDED
- Every acceptance criterion maps to existing engines: onboarding_engine (property), room_intelligence_engine, home_intelligence_engine (assets), document_vault_engine, property_record_engine + home-dashboard timeline (manual notes w/ add/delete on /home-intel/timeline), search_engine (federated authorization-first /api/hi/search — smoke verified), property_brain_engine (pb_facts confidence/provenance + completeness signal + context requests), maintenance_engine, collaboration_engine (scoped sharing). Smoke sweep of endpoints returned 200s.
### 🟡 QUEUE unchanged: Doc 37 gap pass (contextual Ask-Homie launcher audit); backlog Docs 15/19/21/22/24/25 need coverage audit vs existing engines before any build.

## Session update 8 — Doc 40 SHIPPED (iteration 92 ALL GREEN) + Doc 42 audit: ALREADY COVERED
### ✅ Build Doc 40 — Dynamic AR Visual Guidance improvement layer (extends ar_guidance_engine.py, Blueprint 27)
- 32 reusable ACTION_PRIMITIVES (LOOSEN_BOLT, DRIVE_SCREW, CAULK_PATH, CLOSE_SHUTOFF...) with motion/tool/direction/anchor/visuals; 33-tool TOOL_LIBRARY w/ grip/interaction/rotation metadata; 8 anchor types; 22 visual objects.
- 4 ACTION_PACKAGES (painting 6, toilet_replacement 11, drywall_repair 9, flooring 7) — reusable sequences, not one-off animations.
- compose_action(): deterministic step-text → structured Visual Instruction payload (action_id/motion/tool/direction/anchor{type,tracking_required}/visuals/voice/verification/safety_level) attached to every project-step AR instruction.
- Endpoints: GET /api/hi/ar/meta/actions, /meta/packages, /meta/packages/{pid}; POST /sessions/{sid}/instructions/{iid}/target (confidence tiers: >=0.85 anchor_and_guide, >=0.5 request_confirmation, else request_rescan; user_confirmed override; target_state persisted).
- Frontend: AR screen shows action chips + overlay list (testID ar-action-payload) for project-step instructions.
- NOTE: true spatial AR (Unity/ARKit anchoring, avatar/tool 3D animation) requires a NATIVE BUILD + Unity/Reallusion professionals per Doc 40 §15 — this layer is the "DIYHomie Intelligence Layer" contract those pros consume. Expo preview shows 2D guided view only.
- Testing: iteration_92 — 20/20 backend pytest + frontend smoke, zero residual fixtures.
### ✅ Build Doc 42 — Project Workspace & Decision Ledger audit: NO BUILD NEEDED
- Fully covered: gr_issues phases w/ backward movement, gr_positions (Project Position incl. alternatives_considered/rejected_approaches), gr_decisions + pi_decisions (Decision Ledger), pi_blockers/pi_change_events (problem & change management w/ impact review), project_intelligence next-best-action + workspace endpoint, pi_budget_snapshots, evidence/measurements attachment, completion → gr_timeline, collaboration permissions. Smoke verified position data on live issue.
### Queue note: user skipped Doc 41 (never pasted). Docs 33/35/36/37/39/42 confirmed covered or delta-shipped.

## Session update 9 — Docs 43 & 44-delta SHIPPED (iters 93-94 GREEN); Docs 44/45/46 audited COVERED
### ✅ Build Doc 43 — Safety, Risk & Professional Boundary Foundation
- NEW /app/backend/safety_engine.py (/api/hi/safety): deterministic evaluate_action() → 6 verdicts (allow → escalate_to_professional), risk levels 0-5, 14-rule PPE table (action-relevant only), block rules (gas/panel/structural/fire-rated/asbestos/sewer), verify rules (hidden utility, de-energization, lead, mold, height, moisture), warnings, planning-intent short-circuit (choose/pick/compare → allow risk 0, fixed in iter 94). sf_events ledger (non-allow only) + escalations feed admin_ops hi_safety_escalations. Endpoints: /meta, /evaluate, /events (+ admin /api/hi/admin/safety/events w/ by_verdict). PPE wired into AR compose_action + amber chips on AR screen.
### ✅ Build Doc 44 delta — "I'm stuck" recovery flow (§15); rest of Doc 44 pre-covered
- project_intelligence_engine: GET /api/hi/pi/stuck/options (8 reasons) + POST /api/hi/pi/projects/{pid}/stuck → routes marketplace/measurement/replan/product/guidance/safety/homie; safety-routed reasons run real safety evaluation (sf_events source=stuck_flow) + set project blocked; pi_stuck_reports ledger. Frontend: "I'm stuck" button + options + result card on /home-intel/projects/intelligence (testIDs pi-stuck, pi-stuck-{code}, pi-stuck-result).
- Doc 44 remainder AUDITED COVERED: lifecycle/gr phases, next-best-action (pi + command_center), resume briefings (command_center /resume), decisions, change-impact previews, event logs, context assembler (conversation_hub + brain).
### ✅ Docs 45 & 46 audits — NO BUILD NEEDED
- Doc 45 Digital Twin: digital_twin_engine + property_brain (pb_facts source/confidence) + room_intelligence + home_intelligence assets (label vision extraction incl. brand/model/serial) + document_vault + gr_timeline + collaboration sharing. Future (noted): explicit RoomSurface/RoomOpening models, PropertyRiskMarker collection (risks currently live in pb_facts/triage flags).
- Doc 46 Capture/Measurement/Evidence: visual_engine (guided capture templates, capture requests, annotations, inference + user correction, AR sessions), measurement_engine (sources/confidence/verification gates), multimodal engine, offlineQueue, privacy controls. Product-label OCR exists via asset photo capture.
- Testing: iteration_93 (16 tests, 1 bug → fixed) + iteration_94 (11/11 + frontend E2E ALL GREEN).
### User note in Doc 46: ~18-24 more build docs incoming — keep audit-first approach; most core systems already exist.

## Session: Build Docs 47-54 (June 2026 fork)
### ✅ Doc 47 — Unified Spatial + Fine-Motor Visual Guidance Engine
- /app/backend/guidance_runtime_engine.py (/api/hi/guide): 5 guidance modes (SPATIAL_AR/SURFACE_PATH/FINE_MOTOR/ASSEMBLY/MEASUREMENT_LAYOUT) + auto mode selector; 12 fine-motor primitives (TWIST, PINCH, TIE, INFLATE...); 3 seeded MVP procedure packs (paint_wall_v1, toilet_replace_v1, balloon_dog_v1) as structured instruction objects w/ skill-level voice variants; confidence-aware verification states (VERIFIED/LIKELY_COMPLETE/USER_CONFIRMED/NEEDS_REVIEW/CANNOT_VERIFY/STOP_FOR_SAFETY); safety gate before every action; session resume w/ welcome-back; step controls (show_again/slow/angle/why/tool/im_stuck/target events); prefs (skill, color scheme, speed).
- Frontend: /home-intel/guide (library + resume), /home-intel/guide/[id] (player w/ TTS speak, controls, verification), dash card "Show Me How". Doc 47 analytics registered in analytics_engine catalog.
### ✅ Doc 48 — Procedure Packs, Creator Content & Bring in a Pro
- /app/backend/pro_connect_engine.py (/api/hi/proconnect): 4 seeded creators w/ honest status labels; step-indexed "Watch a Pro" demos (clip_url MOCKED placeholders); professional insight attribution cards; auto project-brief generation from guide session (never re-explain); assistance requests (6 types) w/ status flow + admin status router; DIY+Pro scope splitting via safety engine; source-hierarchy metadata (levels 1-7) + versioning added to procedure packs.
- Frontend: WatchAProDrawer + BringInProModal components in guide player; /guide/assist (requests + saved demos), /guide/creator/[cid], /guide/scope. ApiError extended w/ `detail` field (additive).
- Tested green iteration_95.
### ✅ Doc 49 + 51 — Active Project Workspace, State Machines & NBA
- /app/backend/project_workspace_engine.py (/api/hi/workspace): daily briefing (quick/standard/detailed) w/ derived Doc 49 project state (can move backward); time-aware whats-next (5 min → prep micro-task); materials readiness (+use_alternative/ordered statuses); 9-type "Something Changed" problem flow w/ photo + safety routing; unified evidence timeline; offline bundle; Doc 51 structured NOW card (/projects/{pid}/now w/ GREEN-RED safety colors, tools, nextTaskPreview, progress counts); now-summaries for list cards; skip-override w/ 6 recorded reasons; 'waiting' step status.
- Frontend: [id].tsx (briefing card, time chips, NOW card, override modal, offline cache+queue via existing sync engine), evidence.tsx timeline, index.tsx rewritten (tabs, Next: preview, empty state w/ 3 CTAs), ReportProblemModal component.
- Tested green iteration_96 (22/22 backend).
### ✅ Doc 52 — Guided Task Execution & Hands-Free Work Mode
- /app/backend/guided_execution_engine.py (/api/hi/guided): guided sessions over hi_project_steps; GuidedStep objects; work states incl. SAFETY_STOP; step events (repeat/slow/angle/why/tool/whats_next/help/mode_changed); LLM micro-steps (cached on step); deterministic voice-command parser (never bypasses safety confirmations); done flow w/ completion transitions; pause w/ before-you-return note + welcome-back.
- Frontend: /home-intel/projects/guided.tsx (full work-mode screen w/ mic voice commands via /hi/transcribe, TTS, tiny-steps, problem modal); "Start Guided Mode" on NOW card.
### ✅ Doc 53 — AR Scan/Measurement/Spatial Targeting (deltas; twin+AR engines cover the rest)
- /app/backend/spatial_targeting_engine.py (/api/hi/spatial): SpatialTarget CRUD (20 types/8 anchors) w/ honest confidence + hidden-condition cautions (stud/pipe/valve never auto-verified); measurement confirm storing captured vs user-confirmed value (dimension-field aware); ar-preflight checklist w/ standard-guidance fallback; scan-guidance meta ("smallest useful scan" ladder).
### ✅ Doc 54 — Homie Conversation & Contextual Assistant (deltas; multimodal/voice covered the rest)
- multimodal_engine upgraded: Doc 54 context hierarchy (guided step > project state/blockers/materials > room > skill); intent classification (18 intents) + confidence_level + safety_level (red = stop, no unsafe detail) in every response; action chips w/ whitelisted action codes; mm_exchanges history + GET /hi/voice/history?project_id. Frontend voice.tsx: pressable action chips (route mapping), confidence/safety chips (voice-confidence-chip / voice-safety-chip testIDs).
- Docs 52/53/54 tested green iteration_97 (34/34 backend + frontend Playwright). Post-test fixes: measurement value-field mapping, chip testIDs (both verified).
### Queue note: user skipped Doc 50 (never pasted). Doc 54 was pasted twice (duplicate ignored).
### ✅ Doc 56 — Safety, Confidence, Stop-Work & Professional Escalation
- /app/backend/safety_escalation_engine.py (/api/hi/safetysys): persistent SafetyAssessments (risk color + separate confidence + ack tiers informational/caution_confirmation/critical_confirmation/hard_stop); safety checkpoints (electrical/plumbing/drilling/ladder) gate continuation; overrides recorded for YELLOW/ORANGE only w/ mandatory reason — RED returns 409 (never dismissible); project safety history; urgent-language detection (gas/fire/electrical/water/structural) w/ emergency guidance, no DIY diagnosis. Doc 56 analytics registered.
- Frontend guided.tsx: auto-assesses each step; checkpoint checklist / acknowledgment card disables "I'm Done" ("Complete Safety Check First") until cleared; voice "done" cannot bypass the gate.
- Tested green iteration_98 (17/17 backend + live frontend gate on drilling step).
### Backlog/user notes: user will paste Docs 50 & 55 next; Doc 32 (Data Governance/Backup/Export) just needs to be pasted — nothing else required from user. Celebration Engine added to future shared-platform backlog (reusable asset-driven completion event, NOT per-project AI generation).

## Session: Build Docs 50/55/57/58/59/61/63 + audits 60/62 (June 2026 fork, iterations 99-100 ALL GREEN)
### ✅ Doc 50 — Home Passport (delta over existing rooms/assets/docs engines)
- NEW /app/backend/home_passport_engine.py (/api/hi/passport): GET passport summary (property profile + counts rooms/assets/documents/projects/measurements/tools + active projects + recent events); PUT /profile (name/address/type/year_built/square_footage/stories); GET /timeline — derived unified Home Timeline (projects started/completed, assets added, rooms captured, documents, measurements, confirmed receipts, maintenance completed, gr_timeline) grouped by month. No write hooks — aggregation-based.
- Frontend: /home-intel/passport/index.tsx (profile card + edit modal, 6 count tiles testID passport-tile-{rooms,assets,documents,projects,measurements,tools}, active projects, month-grouped timeline). Entry: hi-passport on dashboard.
### ✅ Doc 55 — Material Intelligence (delta over planner materials + inventory)
- NEW /app/backend/material_intelligence_engine.py (/api/hi/materials): workspace (tabs needed/owned/purchased/tools/receipts + ready X/Y + est vs actual budget); extended statuses (need_to_rent/need_to_borrow/not_required + purchase_status purchased/delivered/used/returned/unavailable/substituted) + prices; quantity-calc (paint/area/linear) w/ honest basis (measured from hi_measurements / user_entered / estimated+requires_confirmation) — doc example 420sqft/2coats/350cov/10% ⇒ 3 gallons verified; substitution-check (LLM + deterministic PROHIBITED_KEYWORDS gas line/panel/etc; safety items never safe_substitute; use-anyway 409 on prohibited; mi_substitution_checks); purchase-readiness (5 checks, safety_equipment NON-overridable 409, others override w/ reason in mi_overrides); in-store shopping (remaining/purchased/out-of-stock); receipts (gpt-4o OCR → hi_receipts pending_review w/ item→material suggestions → confirm updates actual prices); project tools checklist + mark-owned (adds to hi_inventory_items, reusable).
- Frontend: materials.tsx REWRITTEN (tabs, readiness card, calc modal, substitution modal, Shopping Mode btn); NEW shopping.tsx (in-store checklist, price capture, out-of-stock, receipt upload via expo-image-picker + review/confirm modal).
### ✅ Doc 57 — Bring in a Pro / Hybrid Collaboration (delta over pro_connect + pro_handoff)
- NEW /app/backend/pro_collab_engine.py (/api/hi/procollab + admin): pcx_handoffs — 8 help types, snapshot (photos count/measurements/materials/safety flags/history), minimum-share sharing_permissions (notes OFF default; address/other-rooms/account NEVER shared), sharing review + edit (only draft), submit/cancel, 10 Doc-57 statuses w/ history; admin status router + verbatim professional response (credentials_verified flag); user accept → pi_change_events + hi_project_notes, reject; hybrid: step ownership diy/professional (professional → status waiting), GET hybrid (diy/pro tasks + next_diy_task + pending flag).
- Frontend: NEW projects/pro-help.tsx (help picker, question, Review What You're Sharing switches, requests w/ status + response card accept/reject, hybrid DIY/Pro chips). Entry: proj-pro-help button + complete-screen next-pro.
### ✅ Doc 58 — Maintenance deltas (maintenance_engine)
- Skip w/ 5 reasons (do_later/no_materials/need_professional/not_applicable/other) + helpful next_action routing (no punishment); not_applicable pauses task; GET /skip-reasons; POST /followup/from-project/{pid} idempotent one-time task due +7d (source post_project, uses project maintenance_followup hint). Frontend: maintenance/[id].tsx reason picker; complete.tsx wires next-maintenance to followup endpoint.
### ✅ Doc 59 — Budget/Change deltas (project_intelligence_engine)
- pi_expenses (10 Doc-59 categories) POST/GET; GET /budget-workspace (estimated vs purchased=materials actual+expenses, remaining, target status on_track/at_risk/over_budget/no_target, honest confidence high/medium/low + reason from confirmed measurements/quantity bases); change apply now records user_decision=approved + event, NEW reject endpoint (409 if applied). Frontend: NEW projects/budget.tsx (summary, target modal, expense modal w/ categories, change approve/reject). Entry: proj-budget.
- Also fixed iter99 HIGH bug: projects/[id].tsx cleanup_disposal/stop_conditions now Array.isArray-guarded (string data crashed .map).
### ✅ Doc 61 — Notifications deltas (notification_engine)
- POST /inbox/{iid}/snooze (tonight/tomorrow/weekend/next_week/custom; safety 409; inbox hides until snoozed_until); GET /briefing "Today with Homie" (greeting + prioritized items: safety > professional response > maintenance due > active project continuation > ordered deliveries; empty_message). Frontend: inbox.tsx briefing card (inbox-briefing) + snooze buttons. Quiet hours/deep links/prefs already existed.
### ✅ Doc 63 — Celebration Engine
- NEW /app/backend/celebration_engine.py (/api/hi/celebration + admin): seeded asset-driven HOMIE_VICTORY_01 package (voice line, confetti colors, 7s, synchronized events CELEBRATION_START→END); cel_prefs (celebrations/music/voice/effects/reduced_motion/achievements_visible — reduced_motion ⇒ 2s + no effects); POST /projects/{pid}/completed (409 if not completed; idempotent already_recorded) → hi_project_completions (actual cost from materials, estimated_pro_cost 2.4x heuristic + savings_note "estimated not guaranteed"), achievements (first/5/10 projects, first paint/plumbing → hi_user_achievements), maintenance follow-up creation, celebration selection honoring prefs; skip/completed event tracking; admin packages list/toggle. Seeded at startup.
- Frontend complete.tsx: celebration overlay (confetti cannon + "Boom! You did it!" + tap-to-skip, auto-end), completion summary (savings + note + achievement chips).
### ✅ Audits — NO BUILD NEEDED
- Doc 60 (Identity/Household/Permissions): covered by collaboration_engine (invites/roles/members/activity/audit/assignments), Doc 38 sessions/devices, data_governance, notification prefs. Future: admin MFA, minor profiles.
- Doc 62 (Design Studio/Inspiration): covered by design_studio_engine (inspiration→concept→refine→buildability→approve→convert). Future: AR preview, mood boards.
### 🧪 Testing: iteration_99 (37/37 backend + frontend, 1 HIGH bug found→fixed→retested) + iteration_100 (11/11 + frontend E2E incl. celebration overlay) — ALL GREEN.
### 📄 NEW: /app/memory/IMPLEMENTATION_INVENTORY.md — full Phase-1 source-of-truth inventory (user requested; no GitHub remote connected; workspace is source of truth).
### Queue: Doc 32 full text still pending from user. server.py routes/ refactor remains top tech-debt item.

## Session addendum: Doc 32 completion + security assessment + new Homie avatar (Sept 2026)
### ✅ Doc 32 — Data Governance completion deltas (audit-first; existing privacy/export/deletion/audit engines preserved untouched)
- NEW /app/backend/governance_ops_engine.py (/api/hi/admin/govops, admin-only, audited to hi_admin_audit):
  - Backups: POST /backups (gzip JSON snapshot per collection → backend/backups/<id>.json.gz, background task, excludes ig_secrets/dg_reauth_grants/dg_backups), GET list/detail (file_present), POST /{bid}/verify (manifest count integrity), POST /{bid}/restore (single collection, merge upsert-by-id or replace, confirm=true required), DELETE.
  - Deletion execution: POST /deletions/execute (dry_run default; optional user_id + ignore_schedule override) — purges class-C collections per DATA_MAP, anonymizes users doc (email deleted-*@deleted.invalid, random hash, token_version bump), marks dg_deletion_jobs done + account state deleted.
  - Retention enforcement: POST /retention/enforce (dry_run default) — prunes error_events/error_incidents >90d, expires stale pro_share_links, drops expired dg_exports payloads, deletes expired reauth grants.
- Tested iteration_101: 21/21 backend green + landing smoke. Demo/admin accounts unaffected.
### 🔐 Security assessment (read-only, user-requested "DIYHOMIE-EM-02"; attachment was never actually present — assessed from repo)
- Findings: test+admin credentials exist in ~90 backend/tests files, 101 test_reports JSONs, and memory/*.md; preview URL hardcoded in ~40 test files; both accounts live in shared preview DB; /app git has NO remote (creds never left workspace); admin password sourced from .env (no hardcoded server creds).
- Proposed 6-step remediation (env-var test creds via conftest.py, localhost default TEST_BASE_URL, synthetic per-run fixtures, remote-test guard, secret scanning + .gitignore, then rotate+token_version revoke) — AWAITING USER GO-AHEAD, nothing executed.
### 🎨 Landing avatar swap
- User-uploaded headshot → trimmed/resized 640x640 → /app/frontend/assets/homie-avatar.png; Logo.tsx MASCOT_AR=1, mW=1.35*dim, bottom -0.06*dim (animations untouched: rings/float/spring). landing.tsx Logo width prop fixed → size="lg". Old homie-mascot.png left in assets (unused by Logo now).

## Session addendum: EM-03-MIN + post-fork environment repair (June 2026 fork)
### ✅ EM-03-MIN — Canonical Foundation Bootstrap (owner-authorized; commit 457b5c8, single revertible)
- NEW isolated `supabase/` dir: migrations/0001_foundation_bootstrap.sql (schema `canon`; conventions: uuid id, timestamptz created_at/updated_at via set_updated_at trigger, soft-delete deleted_at, snake_case; shared append-only `canon.audit_event` w/ forbid_mutation trigger; durable `canon.outbox` w/ dispatch contract FOR UPDATE SKIP LOCKED — no consumers; RLS enabled deny-by-default, zero policies, anon/authenticated revoked) + README.md (conventions + env NAMES: SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY/DB_URL — values never tracked).
- NEW memory/EM-03-MIN_DESIGN_RECORD.md + backend/tests/test_em03_min_foundation.py (11 static contract tests green; live-apply test gated on SUPABASE_DB_URL — SKIPPED until user provides Supabase non-prod credentials). Zero domain tables; zero legacy edits. B0/FIN-4A/W0-4B/AFF-R0 remain OPEN.
- ⏳ PENDING: user to paste Supabase non-prod URL + keys for the live apply step; then EM-02 (identity/tenancy on this foundation) needs separate authorization.
### ✅ Post-fork environment repair + legacy bug fixes (commit 5d0785e) — FIRST fully-green FULL suite run: 1583 passed / 0 failed / 0 errors / 18 skipped
- Real bugs fixed: dashboard timeline 502 (float value concat); hi_admin_audit hash-chain broken by 5 raw-insert writers → shared admin_ops_engine.append_audit_raw() + full chain backfill; project status endpoint rejected "archived" (cleanup silently failed) → allowed + default /hi/projects excludes archived; /projects/{id}/supplies lost legacy "items" shape used by Supplies tab → restored; notification /test suppressed by 24h dedupe → unique entity id; balloon-dog inflate confidenceRequired 0.7→0.6 (test contract).
- Env repairs (untracked/data only): rotated collab_test + pat_pro_test DB passwords to TEST_USER_PASSWORD; restored demo pro trial (+365d), demo seed data (3 My Home projects incl. recreated b07 Fix Leaky Faucet w/ materials, hazard project 81b05bdd for compliance, /tmp/dsid.txt design pid), purged TEST_ leftovers, reset pat_pro pro_profile to verified, deleted drift demo pro_profile.
- ⚠️ STRIPE: backend/.env had a LIVE key (tests were creating cs_live_ sessions!). Moved to STRIPE_LIVE_SECRET_KEY_BACKUP (untracked .env, preserved); dev now uses Emergent placeholder test key. Customers/Connect/Billing-portal tests auto-skip (conftest.skip_unless_real_stripe) until user provides real sk_test_ key. Restore live key only at production deploy.
- Test repeat-safety: campaigns reward/design refine tolerate one-shot state; webhook missing-sig test unique event id; ROI excludes TEST_ rows; support categories 10→11.
