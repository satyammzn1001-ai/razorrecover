import random
from datetime import date
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from copy import deepcopy

app = FastAPI(
    title="RazorRecover API",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -----------------------------
# STOPPING RULE CONFIG
# -----------------------------
# After this many failed automated attempts, the agent stops retrying
# on its own and hands the payment to a human — it never loops forever.
MAX_ATTEMPTS = 3

# Reason-based retry success probabilities, used to simulate a realistic
# outcome instead of every "Execute" click always succeeding.
SUCCESS_PROBABILITY = {
    "NETWORK_ERROR": 0.75,
    "BANK_TIMEOUT": 0.70,
    "BANK_DECLINED": 0.45,
    "INSUFFICIENT_FUNDS": 0.35,
    # Demo-only: always fails, so a pitch/demo video can show the
    # 3-attempt stopping rule deterministically, with zero luck factor.
    "DEMO_GUARANTEED_FAIL": 0.0,
    # Other revenue-leak types (not just card payment failures)
    "CART_ABANDONED": 0.55,
    "SUBSCRIPTION_RENEWAL_FAILED": 0.60,
    "INVOICE_OVERDUE": 0.50,
}

ALLOWED_AUTOMATED_ACTIONS = ["RETRY NOW", "RETRY LATER"]

# Amount above which a payment is treated as "high value" and gets
# extra scrutiny in the reasoning trace / fallback decision branch.
HIGH_VALUE_THRESHOLD = 50000


# -----------------------------
# DEMO PAYMENT DATABASE
# -----------------------------

ORIGINAL_PAYMENTS = [
    {
        "id": "pay_9K82LX", "customer": "Rahul Sharma", "amount": 75000,
        "failure_reason": "BANK_TIMEOUT", "type": "PAYMENT_FAILURE", "attempts": 0, "score": 84,
        "action": "RETRY NOW", "status": "failed",
        "explanation": "Bank timeout appears transient. A retry is safe.",
        "reasoning": []
    },
    {
        "id": "pay_4P21AB", "customer": "Priya Mehta", "amount": 25000,
        "failure_reason": "NETWORK_ERROR", "type": "PAYMENT_FAILURE", "attempts": 0, "score": 91,
        "action": "RETRY NOW", "status": "failed",
        "explanation": "Network error is usually temporary.",
        "reasoning": []
    },
    {
        "id": "pay_7M43QZ", "customer": "Arjun Kapoor", "amount": 8500,
        "failure_reason": "BANK_DECLINED", "type": "PAYMENT_FAILURE", "attempts": 0, "score": 72,
        "action": "RETRY LATER", "status": "failed",
        "explanation": "A delayed retry is safer after a bank decline.",
        "reasoning": []
    },
    {
        "id": "pay_2F91KD", "customer": "Ananya Singh", "amount": 5200,
        "failure_reason": "WRONG_OTP", "type": "PAYMENT_FAILURE", "attempts": 1, "score": 55,
        "action": "REMINDER", "status": "failed",
        "explanation": "Customer needs to complete OTP verification.",
        "reasoning": []
    },
    {
        "id": "pay_8R62PL", "customer": "Vikram Rao", "amount": 15000,
        "failure_reason": "INSUFFICIENT_FUNDS", "type": "PAYMENT_FAILURE", "attempts": 2, "score": 35,
        "action": "HUMAN REVIEW", "status": "failed",
        "explanation": "Automated retry is unlikely to recover this payment.",
        "reasoning": []
    },
    {
        "id": "pay_3Q75TN", "customer": "Karan Malhotra", "amount": 42000,
        "failure_reason": "NETWORK_ERROR", "type": "PAYMENT_FAILURE", "attempts": 0, "score": 91,
        "action": "RETRY NOW", "status": "failed",
        "explanation": "Network error is usually temporary.",
        "reasoning": []
    },
    {
        "id": "pay_6W18YU", "customer": "Sneha Reddy", "amount": 3100,
        "failure_reason": "BANK_TIMEOUT", "type": "PAYMENT_FAILURE", "attempts": 1, "score": 84,
        "action": "RETRY NOW", "status": "failed",
        "explanation": "Bank timeout appears transient. A retry is safe.",
        "reasoning": []
    },
    {
        "id": "pay_1E29HK", "customer": "Rohit Bansal", "amount": 60500,
        "failure_reason": "BANK_DECLINED", "type": "PAYMENT_FAILURE", "attempts": 0, "score": 72,
        "action": "RETRY LATER", "status": "failed",
        "explanation": "A delayed retry is safer after a bank decline.",
        "reasoning": []
    },
    {
        "id": "pay_5D84MC", "customer": "Isha Kapoor", "amount": 9800,
        "failure_reason": "WRONG_OTP", "type": "PAYMENT_FAILURE", "attempts": 1, "score": 55,
        "action": "REMINDER", "status": "failed",
        "explanation": "Customer needs to complete OTP verification.",
        "reasoning": []
    },
    {
        "id": "pay_9J63FZ", "customer": "Manish Yadav", "amount": 21000,
        "failure_reason": "INSUFFICIENT_FUNDS", "type": "PAYMENT_FAILURE", "attempts": 2, "score": 35,
        "action": "HUMAN REVIEW", "status": "failed",
        "explanation": "Automated retry is unlikely to recover this payment.",
        "reasoning": []
    },
    {
        "id": "pay_2K57RB", "customer": "Divya Nair", "amount": 4700,
        "failure_reason": "NETWORK_ERROR", "type": "PAYMENT_FAILURE", "attempts": 1, "score": 91,
        "action": "RETRY NOW", "status": "failed",
        "explanation": "Network error is usually temporary.",
        "reasoning": []
    },
    {
        "id": "pay_8T31XW", "customer": "Aditya Rao", "amount": 55000,
        "failure_reason": "INSUFFICIENT_FUNDS", "type": "PAYMENT_FAILURE", "attempts": 3, "score": 20,
        "action": "HUMAN REVIEW", "status": "failed",
        "explanation": "Multiple failed attempts — needs manual review.",
        "reasoning": []
    },
    {
        "id": "pay_0F00F0", "customer": "Demo Test Payment", "amount": 12000,
        "failure_reason": "DEMO_GUARANTEED_FAIL", "type": "PAYMENT_FAILURE", "attempts": 0, "score": 88,
        "action": "RETRY NOW", "status": "failed",
        "explanation": (
            "Demo-only payment: retry always fails on purpose so the "
            "3-attempt stopping rule can be shown deterministically."
        ),
        "reasoning": []
    },
    {
        "id": "chk_5A11QW", "customer": "Neha Gupta", "amount": 3499,
        "failure_reason": "CART_ABANDONED", "type": "CHECKOUT_ABANDONED",
        "attempts": 0, "score": 62,
        "action": "REMINDER", "status": "failed",
        "explanation": "Checkout was started but not completed — a nudge can bring the customer back.",
        "reasoning": []
    },
    {
        "id": "sub_7C29LM", "customer": "Rajesh Kumar", "amount": 999,
        "failure_reason": "SUBSCRIPTION_RENEWAL_FAILED", "type": "SUBSCRIPTION_FAILED",
        "attempts": 0, "score": 78,
        "action": "RETRY NOW", "status": "failed",
        "explanation": "Subscription renewal failed — an immediate mandate retry is likely to succeed.",
        "reasoning": []
    },
    {
        "id": "inv_3B84XP", "customer": "Meera Enterprises", "amount": 185000,
        "failure_reason": "INVOICE_OVERDUE", "type": "RECEIVABLE_OVERDUE",
        "attempts": 0, "score": 48,
        "action": "REMINDER", "status": "failed",
        "explanation": "B2B invoice is overdue — a payment reminder with a promise-to-pay ask is recommended.",
        "reasoning": []
    },
]

payments = deepcopy(ORIGINAL_PAYMENTS)
audit_log = []


# -----------------------------
# AI DECISION ENGINE
# -----------------------------

def ai_decision(payment):
    """Decides the recovery action for a payment, and returns a
    human-readable reasoning trace alongside it — so the recommendation
    is explainable instead of a black box.

    The stopping rule lives here too: once a payment has hit
    MAX_ATTEMPTS failed automated tries, the agent always returns
    HUMAN REVIEW from here on — no further automated retries are ever
    recommended for it, regardless of the original failure reason.

    Returns: (score, action, explanation, reasoning_trace)
    """

    reason = payment["failure_reason"]
    attempts = payment["attempts"]
    amount = payment["amount"]

    reasoning = [
        f"Attempts so far: {attempts}/{MAX_ATTEMPTS} automated retries used"
    ]

    if attempts >= MAX_ATTEMPTS:
        reasoning.append(
            "Attempt budget exhausted — stopping rule engaged, "
            "no further automated retries will be suggested"
        )
        return (
            10,
            "HUMAN REVIEW",
            f"Stopping rule triggered — {attempts} automated attempts made with no success. "
            "No further automated retries; this payment is handed to a human.",
            reasoning,
        )

    success_probability = SUCCESS_PROBABILITY.get(reason)
    if success_probability is not None:
        reasoning.append(
            f"Failure reason '{reason}' has a historical retry success "
            f"rate of ~{int(success_probability * 100)}%"
        )

    high_value = amount >= HIGH_VALUE_THRESHOLD
    reasoning.append(
        f"Payment amount ₹{amount:,.0f} is "
        f"{'above' if high_value else 'below'} the ₹{HIGH_VALUE_THRESHOLD:,} "
        "high-value review threshold"
    )

    if reason == "NETWORK_ERROR":
        reasoning.append("Network errors are transient by nature — safe for immediate automated retry")
        return (
            91,
            "RETRY NOW",
            "Network error is transient — safe to retry automatically.",
            reasoning,
        )

    if reason == "BANK_TIMEOUT":
        reasoning.append("Bank timeouts usually clear up on their own within minutes")
        return (
            84,
            "RETRY NOW",
            "Bank timeout appears temporary, so an immediate retry is recommended.",
            reasoning,
        )

    if reason == "BANK_DECLINED":
        reasoning.append("An immediate retry after a decline often repeats the same failure — a delay improves odds")
        return (
            72,
            "RETRY LATER",
            "A delayed retry reduces the chance of repeated bank declines.",
            reasoning,
        )

    if reason == "WRONG_OTP":
        reasoning.append("This failure needs customer action, not a system retry")
        return (
            55,
            "REMINDER",
            "Customer action is required before another payment attempt.",
            reasoning,
        )

    if reason == "DEMO_GUARANTEED_FAIL":
        reasoning.append("Demo-only reason — engineered to always fail so the stopping rule can be shown live")
        return (
            88,
            "RETRY NOW",
            "Demo-only payment used to showcase the 3-attempt stopping "
            "rule with a deterministic outcome (retry always fails).",
            reasoning,
        )

    if reason == "CART_ABANDONED":
        reasoning.append("No payment was actually attempted — a nudge, not a retry, is the right move")
        return (
            62,
            "REMINDER",
            "Checkout was abandoned — a reminder nudge can recover the sale.",
            reasoning,
        )

    if reason == "SUBSCRIPTION_RENEWAL_FAILED":
        reasoning.append("Mandate-based renewals are usually safe to retry right away")
        return (
            78,
            "RETRY NOW",
            "Subscription mandate retry is safe to attempt immediately.",
            reasoning,
        )

    if reason == "INVOICE_OVERDUE":
        reasoning.append("B2B receivables are better handled with a reminder + commitment date than a silent retry")
        return (
            48,
            "REMINDER",
            "Overdue B2B invoice — send a payment reminder and request a promise-to-pay date.",
            reasoning,
        )

    if high_value:
        reasoning.append("High-value payments are routed to a human rather than fully automated")
        return (
            35,
            "HUMAN REVIEW",
            "High-value payment requires additional review before automation.",
            reasoning,
        )

    reasoning.append("Failure reason is unrecognised — AI confidence is too low to automate safely")
    return (
        40,
        "HUMAN REVIEW",
        "AI confidence is not high enough for automatic recovery.",
        reasoning,
    )


# -----------------------------
# MODELS
# -----------------------------

class PaymentCreate(BaseModel):
    customer: str
    amount: float = Field(gt=0)
    failure_reason: str
    attempts: int = Field(default=0, ge=0)


class PaymentUpdate(BaseModel):
    customer: str | None = None
    amount: float | None = Field(default=None, gt=0)
    failure_reason: str | None = None
    attempts: int | None = Field(default=None, ge=0)


# -----------------------------
# GET
# -----------------------------

@app.get("/")
def home():
    return {
        "service": "RazorRecover",
        "status": "running"
    }


@app.get("/api/health")
def health():
    return {
        "status": "healthy",
        "ai_engine": "online"
    }


@app.get("/api/payments")
def get_payments():
    return deepcopy(payments)


@app.get("/api/payments/{payment_id}")
def get_payment(payment_id: str):

    payment = next(
        (p for p in payments if p["id"] == payment_id),
        None
    )

    if not payment:
        raise HTTPException(
            status_code=404,
            detail="Payment not found"
        )

    return deepcopy(payment)


# -----------------------------
# POST
# -----------------------------

@app.post("/api/payments", status_code=201)
def create_payment(data: PaymentCreate):

    payment_id = f"pay_{len(payments) + 1000}"

    payment = {
        "id": payment_id,
        "customer": data.customer,
        "amount": data.amount,
        "failure_reason": data.failure_reason,
        "type": "PAYMENT_FAILURE",
        "attempts": data.attempts,
        "score": 0,
        "action": "UNANALYZED",
        "status": "failed",
        "explanation": "Payment has not been analyzed yet.",
        "reasoning": []
    }

    payments.append(payment)

    audit_log.append({
        "event": "PAYMENT_CREATED",
        "payment_id": payment_id
    })

    return payment


# -----------------------------
# PUT
# -----------------------------

@app.put("/api/payments/{payment_id}")
def update_payment(
    payment_id: str,
    data: PaymentUpdate
):

    payment = next(
        (p for p in payments if p["id"] == payment_id),
        None
    )

    if not payment:
        raise HTTPException(
            status_code=404,
            detail="Payment not found"
        )

    updates = data.model_dump(exclude_none=True)

    for key, value in updates.items():
        payment[key] = value

    audit_log.append({
        "event": "PAYMENT_UPDATED",
        "payment_id": payment_id
    })

    return deepcopy(payment)


# -----------------------------
# DELETE
# -----------------------------

@app.delete("/api/payments/{payment_id}")
def delete_payment(payment_id: str):

    global payments

    exists = any(
        p["id"] == payment_id
        for p in payments
    )

    if not exists:
        raise HTTPException(
            status_code=404,
            detail="Payment not found"
        )

    payments = [
        p for p in payments
        if p["id"] != payment_id
    ]

    audit_log.append({
        "event": "PAYMENT_DELETED",
        "payment_id": payment_id
    })

    return {
        "success": True,
        "deleted": payment_id
    }


# -----------------------------
# RESET (for repeatable demos)
# -----------------------------

@app.post("/api/reset")
def reset_demo():
    global payments, audit_log

    payments = deepcopy(ORIGINAL_PAYMENTS)
    audit_log = []

    return {
        "success": True,
        "message": "Demo data reset to original state.",
        "count": len(payments)
    }


# -----------------------------
# AI ANALYSIS
# -----------------------------

@app.post("/api/payments/{payment_id}/decision")
def analyze_payment(payment_id: str):

    payment = next(
        (p for p in payments if p["id"] == payment_id),
        None
    )

    if not payment:
        raise HTTPException(
            status_code=404,
            detail="Payment not found"
        )

    score, action, explanation, reasoning = ai_decision(payment)

    payment["score"] = score
    payment["action"] = action
    payment["explanation"] = explanation
    payment["reasoning"] = reasoning

    audit_log.append({
        "event": "AI_DECISION",
        "payment_id": payment_id,
        "score": score,
        "action": action
    })

    return {
        "payment": deepcopy(payment)
    }


# -----------------------------
# RUN AI AGENT
# -----------------------------

@app.post("/api/agent/run")
def run_ai_agent():

    analyzed = 0

    for payment in payments:

        if payment["status"] == "failed":

            score, action, explanation, reasoning = ai_decision(payment)

            payment["score"] = score
            payment["action"] = action
            payment["explanation"] = explanation
            payment["reasoning"] = reasoning

            analyzed += 1

            audit_log.append({
                "event": "AI_AGENT_RUN",
                "payment_id": payment["id"],
                "action": action
            })

    return {
        "success": True,
        "analyzed": analyzed
    }


# -----------------------------
# EXECUTE RECOVERY (with stopping rule + compliant escalation)
# -----------------------------

@app.post("/api/payments/{payment_id}/recover")
def recover_payment(payment_id: str):

    payment = next(
        (p for p in payments if p["id"] == payment_id),
        None
    )

    if not payment:
        raise HTTPException(
            status_code=404,
            detail="Payment not found"
        )

    if payment["status"] == "recovered":
        return {
            "success": False,
            "message": f"{payment_id} is already recovered — no action taken."
        }

    if payment["status"] == "promised":
        return {
            "success": False,
            "message": (
                f"{payment_id} has an active promise-to-pay "
                f"(due {payment.get('promise_date')}) — use the promise "
                "fulfill/check endpoints instead of an automated retry."
            )
        }

    # Always re-check the decision right before acting — this is what
    # makes the stopping rule actually enforce itself: if a previous
    # failed attempt already pushed this payment over MAX_ATTEMPTS,
    # ai_decision() will now return HUMAN REVIEW and block execution
    # below, even if the UI still shows a stale action.
    score, action, explanation, reasoning = ai_decision(payment)
    payment["score"] = score
    payment["action"] = action
    payment["explanation"] = explanation
    payment["reasoning"] = reasoning

    if action not in ALLOWED_AUTOMATED_ACTIONS:
        audit_log.append({
            "event": "ESCALATION_BLOCKED",
            "payment_id": payment_id,
            "action": action
        })
        return {
            "success": False,
            "message": (
                "Safety layer blocked automated recovery. "
                "Human review is required."
            )
        }

    # Simulate a realistic retry outcome instead of always succeeding.
    success_probability = SUCCESS_PROBABILITY.get(payment["failure_reason"], 0.5)

    if random.random() < success_probability:
        payment["status"] = "recovered"

        audit_log.append({
            "event": "RECOVERY_EXECUTED",
            "payment_id": payment_id,
            "action": action
        })

        return {
            "success": True,
            "message": (
                f"Recovery executed successfully for {payment_id} "
                "(simulation mode)."
            )
        }

    # Retry failed — count the attempt and re-run the decision, which
    # applies the stopping rule if this was the last allowed try.
    payment["attempts"] += 1
    new_score, new_action, new_explanation, new_reasoning = ai_decision(payment)
    payment["score"] = new_score
    payment["action"] = new_action
    payment["explanation"] = new_explanation
    payment["reasoning"] = new_reasoning

    audit_log.append({
        "event": "RETRY_FAILED",
        "payment_id": payment_id,
        "action": action,
        "attempts": payment["attempts"]
    })

    if new_action == "HUMAN REVIEW" and action != "HUMAN REVIEW":
        # the stopping rule just fired for the first time on this payment
        audit_log.append({
            "event": "STOPPING_RULE_TRIGGERED",
            "payment_id": payment_id,
            "attempts": payment["attempts"]
        })
        return {
            "success": False,
            "message": (
                f"Retry failed. Stopping rule triggered after {payment['attempts']} "
                "attempts — escalated to human review."
            )
        }

    return {
        "success": False,
        "message": f"Retry failed for {payment_id}. Will retry later (attempt {payment['attempts']})."
    }


# -----------------------------
# PROMISE-TO-PAY TRACKER
# -----------------------------
# For B2B receivables (and any other case), a customer can commit to a
# payment date instead of an immediate automated retry. This tracks
# that commitment and escalates it automatically if it's broken.

class PromiseCreate(BaseModel):
    # Expected format: "YYYY-MM-DD"
    promise_date: str


@app.post("/api/payments/{payment_id}/promise")
def make_promise(payment_id: str, data: PromiseCreate):

    payment = next(
        (p for p in payments if p["id"] == payment_id),
        None
    )

    if not payment:
        raise HTTPException(
            status_code=404,
            detail="Payment not found"
        )

    try:
        parsed_date = date.fromisoformat(data.promise_date)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="promise_date must be in YYYY-MM-DD format"
        )

    if parsed_date < date.today():
        raise HTTPException(
            status_code=400,
            detail="promise_date cannot be in the past"
        )

    payment["status"] = "promised"
    payment["promise_date"] = data.promise_date
    payment["action"] = "PROMISED"
    payment["explanation"] = (
        f"Customer committed to pay by {data.promise_date}. "
        "Tracking this promise instead of an automated retry."
    )
    payment["reasoning"] = [
        "Customer explicitly committed to a payment date",
        "Tracked instead of an automated retry — broken promises escalate automatically"
    ]

    audit_log.append({
        "event": "PROMISE_MADE",
        "payment_id": payment_id,
        "promise_date": data.promise_date
    })

    return deepcopy(payment)


@app.post("/api/payments/{payment_id}/promise/fulfill")
def fulfill_promise(payment_id: str):

    payment = next(
        (p for p in payments if p["id"] == payment_id),
        None
    )

    if not payment:
        raise HTTPException(
            status_code=404,
            detail="Payment not found"
        )

    if payment["status"] != "promised":
        return {
            "success": False,
            "message": f"{payment_id} has no active promise to fulfill."
        }

    payment["status"] = "recovered"
    payment["action"] = "RETRY NOW"
    payment["explanation"] = "Customer paid — promise kept."
    payment["reasoning"] = ["Customer fulfilled their promise-to-pay commitment"]

    audit_log.append({
        "event": "PROMISE_KEPT",
        "payment_id": payment_id
    })

    return {
        "success": True,
        "message": f"{payment_id} marked as paid — promise kept."
    }


@app.post("/api/promises/check")
def check_promises():
    """Scans every payment that is currently in the 'promised' state
    and, if today is past its promised date, treats the promise as
    broken: it's escalated straight to HUMAN REVIEW rather than being
    silently retried or forgotten. This is the bounded part of the
    workflow — a broken promise never lingers unnoticed."""

    broken = []
    today = date.today()

    for payment in payments:
        if payment.get("status") != "promised":
            continue

        promise_date_str = payment.get("promise_date")
        if not promise_date_str:
            continue

        try:
            promise_date = date.fromisoformat(promise_date_str)
        except ValueError:
            continue

        if today > promise_date:
            payment["status"] = "failed"
            payment["action"] = "HUMAN REVIEW"
            payment["explanation"] = (
                f"Promise-to-pay broken — customer committed to {promise_date_str} "
                "and did not pay. Escalated for manual follow-up."
            )
            payment["reasoning"] = [
                f"Promise date {promise_date_str} has passed without payment",
                "Broken promises are escalated automatically, never left silent"
            ]

            audit_log.append({
                "event": "PROMISE_BROKEN",
                "payment_id": payment["id"],
                "promise_date": promise_date_str
            })

            broken.append(payment["id"])

    return {
        "success": True,
        "broken_promises": broken,
        "checked": len([p for p in payments if p.get("promise_date")])
    }


# -----------------------------
# METRICS
# -----------------------------

@app.get("/api/metrics")
def get_metrics():

    revenue_at_risk = sum(
        p["amount"]
        for p in payments
        if p["status"] in ("failed", "promised")
    )

    revenue_recovered = sum(
        p["amount"]
        for p in payments
        if p["status"] == "recovered"
    )

    potentially_recoverable = sum(
        p["amount"]
        for p in payments
        if p["action"] in [
            "RETRY NOW",
            "RETRY LATER",
            "REMINDER"
        ]
    )

    total = revenue_at_risk + revenue_recovered

    recovery_rate = (
        round(
            (revenue_recovered / total) * 100,
            1
        )
        if total > 0
        else 0
    )

    return {
        "revenue_at_risk": revenue_at_risk,
        "potentially_recoverable": potentially_recoverable,
        "revenue_recovered": revenue_recovered,
        "recovery_rate": recovery_rate
    }


# -----------------------------
# AUDIT TRAIL
# -----------------------------

@app.get("/api/audit")
def get_audit():

    return deepcopy(audit_log)


@app.get("/api/payments/{payment_id}/timeline")
def get_payment_timeline(payment_id: str):
    """Returns just this payment's slice of the audit log, in
    chronological order — the story of what the agent did, step by
    step, for a single payment."""

    exists = any(p["id"] == payment_id for p in payments)
    if not exists:
        raise HTTPException(
            status_code=404,
            detail="Payment not found"
        )

    return [
        deepcopy(event)
        for event in audit_log
        if event.get("payment_id") == payment_id
    ]