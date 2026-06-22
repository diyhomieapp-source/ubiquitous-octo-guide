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
