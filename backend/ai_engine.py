def analyze_payment(payment):

    reason = payment["failure_reason"]
    attempts = payment["attempts"]

    if reason == "NETWORK_ERROR" and attempts < 2:
        return {
            "score": 91,
            "action": "RETRY NOW",
            "reason": "Transient network failure"
        }

    if reason == "BANK_TIMEOUT" and attempts < 2:
        return {
            "score": 84,
            "action": "RETRY NOW",
            "reason": "Temporary bank timeout"
        }

    if reason == "BANK_DECLINED" and attempts == 0:
        return {
            "score": 72,
            "action": "RETRY LATER",
            "reason": "Bank decline may succeed after delay"
        }

    if reason == "WRONG_OTP":
        return {
            "score": 55,
            "action": "REMINDER",
            "reason": "Customer action required"
        }

    return {
        "score": 40,
        "action": "HUMAN REVIEW",
        "reason": "Low confidence automated recovery"
    }