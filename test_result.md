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
