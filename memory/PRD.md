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

## ⚠️ BLOCKER/ACTION: backend/.env PERPLEXITY_API_KEY is EMPTY. Perplexity is NOT active — guide generation has been silently using the Emergent fallback (gpt-4o-mini, no web search), and Code Check returns 503. User must paste a real Perplexity API key into backend/.env PERPLEXITY_API_KEY to activate both accurate guides and local code lookup.
