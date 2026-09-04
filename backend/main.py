from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from copy import deepcopy

app = FastAPI(
    title="RazorRecover API",
    version="1.0.0"
)

# React frontend ko backend access karne dena
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
# DEMO PAYMENT DATABASE
# -----------------------------
# NOTE: kept as "failed" with an initial score/action so the dashboard
# looks correct even before "Run AI Agent" is clicked the first time.
# ORIGINAL_PAYMENTS below is the untouched seed used by /api/reset.

ORIGINAL_PAYMENTS = [
    {
        "id": "pay_9K82LX", "customer": "Rahul Sharma", "amount": 75000,
        "failure_reason": "BANK_TIMEOUT", "attempts": 0, "score": 84,
        "action": "RETRY NOW", "status": "failed",
        "explanation": "Bank timeout appears transient. A retry is safe."
    },
    {
        "id": "pay_4P21AB", "customer": "Priya Mehta", "amount": 25000,
        "failure_reason": "NETWORK_ERROR", "attempts": 0, "score": 91,
        "action": "RETRY NOW", "status": "failed",
        "explanation": "Network error is usually temporary."
    },
    {
        "id": "pay_7M43QZ", "customer": "Arjun Kapoor", "amount": 8500,
        "failure_reason": "BANK_DECLINED", "attempts": 0, "score": 72,
        "action": "RETRY LATER", "status": "failed",
        "explanation": "A delayed retry is safer after a bank decline."
    },
    {
        "id": "pay_2F91KD", "customer": "Ananya Singh", "amount": 5200,
        "failure_reason": "WRONG_OTP", "attempts": 1, "score": 55,
        "action": "REMINDER", "status": "failed",
        "explanation": "Customer needs to complete OTP verification."
    },
    {
        "id": "pay_8R62PL", "customer": "Vikram Rao", "amount": 15000,
        "failure_reason": "INSUFFICIENT_FUNDS", "attempts": 2, "score": 35,
        "action": "HUMAN REVIEW", "status": "failed",
        "explanation": "Automated retry is unlikely to recover this payment."
    },
    {
        "id": "pay_3Q75TN", "customer": "Karan Malhotra", "amount": 42000,
        "failure_reason": "NETWORK_ERROR", "attempts": 0, "score": 91,
        "action": "RETRY NOW", "status": "failed",
        "explanation": "Network error is usually temporary."
    },
    {
        "id": "pay_6W18YU", "customer": "Sneha Reddy", "amount": 3100,
        "failure_reason": "BANK_TIMEOUT", "attempts": 1, "score": 84,
        "action": "RETRY NOW", "status": "failed",
        "explanation": "Bank timeout appears transient. A retry is safe."
    },
    {
        "id": "pay_1E29HK", "customer": "Rohit Bansal", "amount": 60500,
        "failure_reason": "BANK_DECLINED", "attempts": 0, "score": 72,
        "action": "RETRY LATER", "status": "failed",
        "explanation": "A delayed retry is safer after a bank decline."
    },
    {
        "id": "pay_5D84MC", "customer": "Isha Kapoor", "amount": 9800,
        "failure_reason": "WRONG_OTP", "attempts": 1, "score": 55,
        "action": "REMINDER", "status": "failed",
        "explanation": "Customer needs to complete OTP verification."
    },
    {
        "id": "pay_9J63FZ", "customer": "Manish Yadav", "amount": 21000,
        "failure_reason": "INSUFFICIENT_FUNDS", "attempts": 2, "score": 35,
        "action": "HUMAN REVIEW", "status": "failed",
        "explanation": "Automated retry is unlikely to recover this payment."
    },
    {
        "id": "pay_2K57RB", "customer": "Divya Nair", "amount": 4700,
        "failure_reason": "NETWORK_ERROR", "attempts": 1, "score": 91,
        "action": "RETRY NOW", "status": "failed",
        "explanation": "Network error is usually temporary."
    },
    {
        "id": "pay_8T31XW", "customer": "Aditya Rao", "amount": 55000,
        "failure_reason": "INSUFFICIENT_FUNDS", "attempts": 3, "score": 20,
        "action": "HUMAN REVIEW", "status": "failed",
        "explanation": "Multiple failed attempts — needs manual review."
    },
]

payments = deepcopy(ORIGINAL_PAYMENTS)
audit_log = []


# -----------------------------
# AI DECISION ENGINE
# -----------------------------

def ai_decision(payment):

    reason = payment["failure_reason"]
    attempts = payment["attempts"]
    amount = payment["amount"]

    if reason == "NETWORK_ERROR" and attempts < 2:
        return (
            91,
            "RETRY NOW",
            "Network error is transient and the retry limit has not been reached."
        )

    if reason == "BANK_TIMEOUT" and attempts < 2:
        return (
            84,
            "RETRY NOW",
            "Bank timeout appears temporary, so an immediate retry is recommended."
        )

    if reason == "BANK_DECLINED" and attempts == 0:
        return (
            72,
            "RETRY LATER",
            "A delayed retry reduces the chance of repeated bank declines."
        )

    if reason == "WRONG_OTP":
        return (
            55,
            "REMINDER",
            "Customer action is required before another payment attempt."
        )

    if amount >= 50000:
        return (
            35,
            "HUMAN REVIEW",
            "High-value payment requires additional review before automation."
        )

    return (
        40,
        "HUMAN REVIEW",
        "AI confidence is not high enough for automatic recovery."
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
        "attempts": data.attempts,
        "score": 0,
        "action": "UNANALYZED",
        "status": "failed",
        "explanation": "Payment has not been analyzed yet."
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
    """Restores the original demo payments and clears the audit log.
    Lets you re-run the same demo (e.g. while recording a pitch video)
    without restarting the server."""

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

    score, action, explanation = ai_decision(payment)

    payment["score"] = score
    payment["action"] = action
    payment["explanation"] = explanation

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

            score, action, explanation = ai_decision(payment)

            payment["score"] = score
            payment["action"] = action
            payment["explanation"] = explanation

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
# EXECUTE RECOVERY
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

    allowed_actions = [
        "RETRY NOW",
        "RETRY LATER"
    ]

    if payment["action"] not in allowed_actions:

        return {
            "success": False,
            "message": (
                "Safety layer blocked automated recovery. "
                "Human review is required."
            )
        }

    # Simulation only
    payment["status"] = "recovered"

    audit_log.append({
        "event": "RECOVERY_EXECUTED",
        "payment_id": payment_id,
        "action": payment["action"]
    })

    return {
        "success": True,
        "message": (
            f"Recovery executed successfully for {payment_id} "
            "(simulation mode)."
        )
    }


# -----------------------------
# METRICS
# -----------------------------

@app.get("/api/metrics")
def get_metrics():

    revenue_at_risk = sum(
        p["amount"]
        for p in payments
        if p["status"] == "failed"
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