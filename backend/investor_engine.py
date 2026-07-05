"""
DIYhomie Investor / Stakeholder Reporting Suite (Info Sheet #68).

Founder/admin-facing tooling to communicate traction to investors & stakeholders:
  - Live KPI snapshot pulled from real platform collections (users, revenue,
    engagement, retention proxy) — no vanity mocks.
  - AI-generated narrative investor updates (period selectable) grounded on the
    live KPIs, saved to `investor_reports` for a shareable paper-trail.
  - Investor Q&A chatbot: answers stakeholder questions grounded ONLY on the
    real KPI snapshot (uses the shared `_llm_json` helper -> Emergent LLM key).

All numbers are computed on-read so a report always reflects live data at the
moment it was generated (the snapshot is frozen into each saved report).
"""
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, Callable, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

_db = None
_logger = None
_llm_json = None
_plan_tiers: dict = {}


def configure(db, logger, llm_json: Callable, plan_tiers: dict):
    global _db, _logger, _llm_json, _plan_tiers
    _db = db
    _logger = logger
    _llm_json = llm_json
    _plan_tiers = plan_tiers or {}


def _now():
    return datetime.now(timezone.utc)


def _iso(dt) -> str:
    return dt.isoformat()


def _new_id():
    return str(uuid.uuid4())


def _pct_change(curr: float, prev: float) -> Optional[float]:
    if not prev:
        return None if not curr else 100.0
    return round((curr - prev) / prev * 100, 1)


async def compute_kpis() -> dict:
    """Compute a live KPI snapshot from real platform collections."""
    now = _now()
    d30 = _iso(now - timedelta(days=30))
    d60 = _iso(now - timedelta(days=60))

    # ---- Users & growth
    total_users = await _db.users.count_documents({})
    new_30 = await _db.users.count_documents({"created_at": {"$gte": d30}})
    new_prev_30 = await _db.users.count_documents({"created_at": {"$gte": d60, "$lt": d30}})
    active_30 = await _db.users.count_documents({"last_login": {"$gte": d30}})

    # ---- Revenue (mirror /admin/finance/summary logic)
    mrr = 0
    tier_counts: dict = {}
    async for u in _db.users.find({"subscription_status": "active"}, {"subscription_tier": 1}):
        p = _plan_tiers.get(u.get("subscription_tier"))
        if p and p.get("amount"):
            mrr += p["amount"]
            tier_counts[u["subscription_tier"]] = tier_counts.get(u["subscription_tier"], 0) + 1
    paying = sum(tier_counts.values())
    month_start = _iso(now.replace(day=1, hour=0, minute=0, second=0, microsecond=0))
    rev_month = 0
    async for tx in _db.payment_transactions.find(
        {"fulfilled": True, "created_at": {"$gte": month_start}}, {"amount": 1}):
        rev_month += tx.get("amount", 0) or 0
    exps = await _db.finance_expenses.find({}, {"_id": 0}).to_list(500)
    monthly_exp = sum(e.get("amount_cents", 0) for e in exps if e.get("cadence") == "monthly")
    net = mrr - monthly_exp
    cfg = await _db.finance_config.find_one({"id": "singleton"}, {"_id": 0}) or {}
    cash = cfg.get("cash_on_hand_cents", 0)
    runway = round(cash / abs(net), 1) if net < 0 and cash > 0 else None

    # ---- Engagement / traction
    projects_total = await _db.projects.count_documents({})
    projects_completed = await _db.projects.count_documents({"status": "completed"})
    projects_30 = await _db.projects.count_documents({"created_at": {"$gte": d30}})
    blog_published = await _db.blog_posts.count_documents({"published": True})
    communities = await _db.community_projects.count_documents({})
    certs_issued = await _db.certificates.count_documents({})
    edu_lessons = await _db.edu_lessons.count_documents({})
    pro_partners = await _db.pro_profiles.count_documents({})
    referrals = await _db.referrals.count_documents({})

    # ---- Retention / churn proxy
    canceled = await _db.users.count_documents({"subscription_status": "canceled"})
    ever_paid = paying + canceled
    churn_pct = round(canceled / ever_paid * 100, 1) if ever_paid else 0.0
    conversion_pct = round(paying / total_users * 100, 1) if total_users else 0.0
    completion_rate = round(projects_completed / projects_total * 100, 1) if projects_total else 0.0

    return {
        "generated_at": _iso(now),
        "users": {
            "total": total_users,
            "active_30d": active_30,
            "new_30d": new_30,
            "new_prev_30d": new_prev_30,
            "growth_pct_mom": _pct_change(new_30, new_prev_30),
        },
        "revenue": {
            "mrr_cents": mrr,
            "arr_cents": mrr * 12,
            "arpu_cents": round(mrr / paying) if paying else 0,
            "revenue_month_cents": rev_month,
            "monthly_expenses_cents": monthly_exp,
            "net_monthly_cents": net,
            "cash_on_hand_cents": cash,
            "runway_months": runway,
            "paying_users": paying,
            "tier_counts": tier_counts,
        },
        "engagement": {
            "projects_total": projects_total,
            "projects_completed": projects_completed,
            "projects_new_30d": projects_30,
            "completion_rate_pct": completion_rate,
            "blog_posts_published": blog_published,
            "community_projects": communities,
            "certificates_issued": certs_issued,
            "education_lessons": edu_lessons,
            "pro_partners": pro_partners,
            "referrals": referrals,
        },
        "conversion": {
            "free_to_paid_pct": conversion_pct,
            "churn_pct": churn_pct,
        },
    }


def _fmt_usd(cents) -> str:
    return f"${(cents or 0) / 100:,.0f}"


def _kpi_brief(k: dict) -> str:
    """Human-readable brief handed to the LLM as grounding context."""
    u, r, e, c = k["users"], k["revenue"], k["engagement"], k["conversion"]
    return (
        f"DIYhomie live KPI snapshot ({k['generated_at'][:10]}):\n"
        f"USERS: total={u['total']}, active(30d)={u['active_30d']}, "
        f"new(30d)={u['new_30d']} vs prev 30d={u['new_prev_30d']} "
        f"(MoM growth {u['growth_pct_mom']}%).\n"
        f"REVENUE: MRR={_fmt_usd(r['mrr_cents'])}, ARR={_fmt_usd(r['arr_cents'])}, "
        f"ARPU={_fmt_usd(r['arpu_cents'])}, this-month revenue={_fmt_usd(r['revenue_month_cents'])}, "
        f"monthly expenses={_fmt_usd(r['monthly_expenses_cents'])}, "
        f"net/mo={_fmt_usd(r['net_monthly_cents'])}, cash={_fmt_usd(r['cash_on_hand_cents'])}, "
        f"runway={r['runway_months']} months, paying users={r['paying_users']}, "
        f"tier breakdown={r['tier_counts']}.\n"
        f"ENGAGEMENT: projects={e['projects_total']} ({e['projects_completed']} completed, "
        f"{e['completion_rate_pct']}% completion), new projects(30d)={e['projects_new_30d']}, "
        f"blog posts={e['blog_posts_published']}, community projects={e['community_projects']}, "
        f"certificates={e['certificates_issued']}, education lessons={e['education_lessons']}, "
        f"pro partners={e['pro_partners']}, referrals={e['referrals']}.\n"
        f"CONVERSION: free->paid={c['free_to_paid_pct']}%, churn(proxy)={c['churn_pct']}%."
    )


# ---------------------------------------------------------------- admin router
class ReportReq(BaseModel):
    period: str = "monthly"          # monthly | quarterly | annual | custom
    highlights: Optional[str] = None  # optional founder notes to weave in
    audience: str = "investors"      # investors | board | team


class AskReq(BaseModel):
    question: str


def build_admin_router(require_admin: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/admin/investor", dependencies=[Depends(require_admin)])

    @r.get("/kpis")
    async def kpis():
        return await compute_kpis()

    @r.post("/reports")
    async def generate_report(req: ReportReq, admin: dict = Depends(require_admin)):
        k = await compute_kpis()
        brief = _kpi_brief(k)
        notes = f"\nFounder highlights to weave in (only if credible): {req.highlights}" if req.highlights else ""
        system = (
            "You are the finance & strategy lead at DIYhomie, an AI-powered DIY home-improvement "
            "platform. Write a concise, credible investor/stakeholder update using ONLY the KPI "
            "snapshot provided. Never invent numbers not present in the data. Be honest about "
            "early-stage weaknesses while framing momentum. Return STRICT JSON with keys: "
            "\"title\" (string), \"tldr\" (string, 1-2 sentences), "
            "\"sections\" (array of {\"heading\": string, \"body\": string}), "
            "\"metrics_table\" (array of {\"label\": string, \"value\": string}), "
            "\"asks\" (array of strings - what we need from investors/stakeholders), "
            "\"risks\" (array of strings)."
        )
        user_text = (
            f"Write a {req.period} update for our {req.audience}. Use this data:\n{brief}{notes}\n"
            "Highlight growth, revenue quality, engagement and retention. Keep each section body "
            "under ~90 words. metrics_table should surface the 5-6 most investor-relevant numbers."
        )
        try:
            data = await _llm_json(system, user_text, max_tokens=1600)
        except Exception as ex:
            _logger.warning(f"investor report LLM failed: {ex}")
            raise HTTPException(status_code=502, detail="Could not generate the report. Try again.")
        if not isinstance(data, dict) or not data.get("sections"):
            raise HTTPException(status_code=502, detail="Report generation returned no content.")
        doc = {
            "id": _new_id(),
            "created_at": _iso(_now()),
            "created_by": admin.get("email"),
            "period": req.period,
            "audience": req.audience,
            "title": data.get("title") or f"DIYhomie {req.period.title()} Update",
            "tldr": data.get("tldr", ""),
            "sections": data.get("sections", []),
            "metrics_table": data.get("metrics_table", []),
            "asks": data.get("asks", []),
            "risks": data.get("risks", []),
            "kpi_snapshot": k,
        }
        await _db.investor_reports.insert_one(dict(doc))
        doc.pop("_id", None)
        return doc

    @r.get("/reports")
    async def list_reports(limit: int = 50):
        rows = await _db.investor_reports.find(
            {}, {"_id": 0, "sections": 0, "kpi_snapshot": 0}).sort("created_at", -1).limit(min(limit, 100)).to_list(100)
        return {"reports": rows, "total": await _db.investor_reports.count_documents({})}

    @r.get("/reports/{report_id}")
    async def get_report(report_id: str):
        doc = await _db.investor_reports.find_one({"id": report_id}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Report not found")
        return doc

    @r.delete("/reports/{report_id}")
    async def delete_report(report_id: str):
        res = await _db.investor_reports.delete_one({"id": report_id})
        if not res.deleted_count:
            raise HTTPException(status_code=404, detail="Report not found")
        return {"ok": True}

    @r.post("/ask")
    async def ask(req: AskReq):
        q = (req.question or "").strip()
        if not q:
            raise HTTPException(status_code=400, detail="Ask a question.")
        k = await compute_kpis()
        brief = _kpi_brief(k)
        system = (
            "You are DIYhomie's investor-relations analyst. Answer the stakeholder's question "
            "using ONLY the KPI snapshot provided. If the data does not contain the answer, say so "
            "plainly and suggest what metric would be needed — do NOT fabricate numbers. Be concise, "
            "factual and founder-honest. Return STRICT JSON with keys: \"answer\" (string), "
            "\"supporting_metrics\" (array of {\"label\": string, \"value\": string})."
        )
        try:
            data = await _llm_json(system, f"KPI data:\n{brief}\n\nQuestion: {q}", max_tokens=700)
        except Exception as ex:
            _logger.warning(f"investor ask LLM failed: {ex}")
            raise HTTPException(status_code=502, detail="Could not answer right now. Try again.")
        return {
            "answer": data.get("answer", "") if isinstance(data, dict) else str(data),
            "supporting_metrics": data.get("supporting_metrics", []) if isinstance(data, dict) else [],
        }

    return r
