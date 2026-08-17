"""
DIYhomie — Project Handoffs: Shopping List & Home Report (additive).

Extends the Continuous Project Intelligence Orchestrator with two owner-facing handoffs:
  - Shopping Handoff: turns a project's material/tool requirements into a ready-to-buy
    list with running cost totals and owned-vs-buy status. (No fake prices — uses the
    project's own estimates; reflects any applied cost-reduction savings.)
  - Home Report: turns a COMPLETED project's Passport into a shareable plain-language
    summary for insurance or resale.

All data is user-scoped (RLS-equivalent enforced at the API). Additive — no existing
functionality is changed.

Namespace: /api/hi/handoff/*
Reuses: orch_projects, orch_requirements, orch_decisions, orch_tasks, fund_events, hi_properties
"""
from datetime import datetime, timezone
from typing import Callable

from fastapi import APIRouter, Depends, HTTPException

_db = None
_logger = None


def _now():
    return datetime.now(timezone.utc).isoformat()


def configure(db, logger):
    global _db, _logger
    _db, _logger = db, logger


def _r2(x):
    return round(float(x or 0) + 1e-9, 2)


async def _owned(pid, uid):
    p = await _db.orch_projects.find_one({"id": pid, "user_id": uid}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found.")
    return p


async def _confirmed_savings(pid) -> float:
    events = await _db.fund_events.find({"project_id": pid, "classification": "confirmed"}, {"_id": 0}).to_list(1000)
    return _r2(sum(e.get("amount") or 0 for e in events))


def build_router(get_current_user: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/hi/handoff")

    @r.get("/shopping/{project_id}")
    async def shopping(project_id: str, user: dict = Depends(get_current_user)):
        await _owned(project_id, user["id"])
        reqs = await _db.orch_requirements.find({"project_id": project_id}, {"_id": 0}).sort("created_at", 1).to_list(300)
        items, to_buy_total, owned_total = [], 0.0, 0.0
        for m in reqs:
            cost = _r2(m.get("cost_estimate"))
            status = m.get("procurement_status") or "need_to_buy"
            owned = status in ("owned", "delivered", "ready_for_pickup", "rental_booked")
            if owned:
                owned_total += cost
            else:
                to_buy_total += cost
            items.append({"id": m["id"], "name": m["name"], "kind": m.get("kind", "material"),
                          "quantity": m.get("quantity"), "unit": m.get("unit"), "estimate": cost,
                          "status": status, "owned": owned})
        return {"project_id": project_id, "items": items, "count": len(items),
                "to_buy_total": _r2(to_buy_total), "owned_total": _r2(owned_total),
                "grand_total": _r2(to_buy_total + owned_total),
                "note": "Totals use your project estimates and reflect any savings you've applied. Verified live pricing arrives with retailer integrations."}

    @r.post("/shopping/{project_id}/items/{item_id}/purchased")
    async def mark_purchased(project_id: str, item_id: str, purchased: bool = True, user: dict = Depends(get_current_user)):
        await _owned(project_id, user["id"])
        m = await _db.orch_requirements.find_one({"id": item_id, "project_id": project_id, "user_id": user["id"]}, {"_id": 0})
        if not m:
            raise HTTPException(status_code=404, detail="Item not found.")
        await _db.orch_requirements.update_one({"id": item_id}, {"$set": {"procurement_status": "owned" if purchased else "need_to_buy"}})
        try:
            import orchestrator_engine
            await orchestrator_engine._emit(project_id, user["id"], "PROCUREMENT_UPDATED",
                                            {"name": m["name"], "status": "owned" if purchased else "need_to_buy"})
        except Exception:
            pass
        return {"ok": True}

    @r.get("/report/{project_id}")
    async def report(project_id: str, user: dict = Depends(get_current_user)):
        p = await _owned(project_id, user["id"])
        passport = p.get("passport")
        completed = p.get("status") == "COMPLETED" and passport
        prop = None
        if p.get("property_id"):
            prop = await _db.hi_properties.find_one({"id": p["property_id"], "user_id": user["id"]}, {"_id": 0})
        reqs = await _db.orch_requirements.find({"project_id": project_id}, {"_id": 0}).to_list(300)
        decisions = await _db.orch_decisions.find({"project_id": project_id, "state": "committed"}, {"_id": 0}).to_list(100)
        tasks = await _db.orch_tasks.find({"project_id": project_id}, {"_id": 0}).to_list(500)
        confirmed_savings = await _confirmed_savings(project_id)
        materials = [m["name"] for m in reqs if m.get("kind") == "material"]
        tools = [m["name"] for m in reqs if m.get("kind") in ("tool", "rental")]
        approx_cost = _r2(sum(m.get("cost_estimate") or 0 for m in reqs)) if not passport else _r2(passport.get("approx_cost"))
        report = {
            "title": p["title"], "status": p["status"], "completed": bool(completed),
            "property_name": (prop.get("nickname") or prop.get("address") or prop.get("home_type")) if prop else None,
            "property_type": prop.get("home_type") if prop else None,
            "project_type": p.get("project_type"), "scope": p.get("scope", []), "goals": p.get("goals", []),
            "committed_decisions": [d["title"] for d in decisions],
            "materials_used": materials, "tools_used": tools,
            "tasks_completed": len([t for t in tasks if t["status"] == "complete"]),
            "approx_cost": approx_cost, "confirmed_savings": confirmed_savings,
            "known_limitations": [rk["description"] for rk in await _db.orch_risks.find({"project_id": project_id, "status": {"$ne": "resolved"}}, {"_id": 0}).to_list(50)],
            "generated_at": _now(),
        }
        # Plain-language shareable text (insurance / resale friendly).
        lines = [f"DIYhomie Project Report — {report['title']}"]
        if report["property_name"]:
            lines.append(f"Property: {report['property_name']}")
        lines.append(f"Status: {'Completed' if completed else p['status'].replace('_', ' ').title()}")
        if materials:
            lines.append(f"Materials: {', '.join(materials)}")
        if tools:
            lines.append(f"Tools: {', '.join(tools)}")
        lines.append(f"Tasks completed: {report['tasks_completed']}")
        lines.append(f"Approximate cost: ${report['approx_cost']:.2f}")
        if confirmed_savings:
            lines.append(f"Confirmed savings: ${confirmed_savings:.2f}")
        lines.append(f"Generated: {report['generated_at'][:10]}")
        lines.append("Note: Homeowner-maintained record. Not a certification of code compliance, permits, or structural condition.")
        report["share_text"] = "\n".join(lines)
        return {"report": report}

    return r


async def seed_handoff():
    return
