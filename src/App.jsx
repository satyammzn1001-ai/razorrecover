import { useEffect, useMemo, useState, useRef } from "react";
import "./App.css";

const API = "https://razorrecover.onrender.com";

const ACTION_COLORS = {
  "RETRY NOW": "#3f6b4f",
  "RETRY LATER": "#35566e",
  "REMINDER": "#a67526",
  "HUMAN REVIEW": "#a13f3a",
  "UNANALYZED": "#6b6455",
  "PROMISED": "#6a4c93",
};

const EXECUTABLE_ACTIONS = ["RETRY NOW", "RETRY LATER"];

// Friendly labels for audit events, used to build the per-payment
// recovery timeline (Detected → Decision → Retry Failed → ...).
const EVENT_LABELS = {
  PAYMENT_CREATED: "Detected",
  AI_DECISION: "AI Decision",
  AI_AGENT_RUN: "AI Decision",
  RETRY_FAILED: "Retry Failed",
  RETRY_BLOCKED_SCHEDULE: "Waiting (Scheduled)",
  TIME_ADVANCED: "Time Advanced (Demo)",
  STOPPING_RULE_TRIGGERED: "Stopping Rule",
  RECOVERY_EXECUTED: "Recovered",
  ESCALATION_BLOCKED: "Blocked",
  PROMISE_MADE: "Promise Made",
  PROMISE_KEPT: "Promise Kept",
  PROMISE_BROKEN: "Promise Broken",
  PAYMENT_UPDATED: "Updated",
  PAYMENT_DELETED: "Deleted",
};

const formatScheduledTime = (isoString) =>
  new Date(isoString).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

// Animates a number from its previous value to a new target whenever
// the target changes — used on the metric cards so numbers visibly
// count up/down instead of jumping.
function useAnimatedNumber(target, duration = 700) {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef(null);

  useEffect(() => {
    const from = fromRef.current;
    const to = target;
    if (from === to) return;

    const start = performance.now();

    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = from + (to - from) * eased;
      setValue(current);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}

const money = (amount) => `₹${Number(amount || 0).toLocaleString("en-IN")}`;

const scoreColor = (score) => {
  if (score >= 70) return "#3f6b4f";
  if (score >= 45) return "#a67526";
  return "#a13f3a";
};

// ---------------------------------------------------------------------
// All of the following components live at module scope, not inside App.
// Defining them inside App's render body would give React a brand new
// component identity on every render, forcing it to unmount/remount the
// whole subtree — which is what was resetting the search input's focus
// after every keystroke, and previously broke the counter animation too.
// ---------------------------------------------------------------------

function ActionBadge({ action }) {
  return (
    <span
      className="action-badge"
      style={{ color: ACTION_COLORS[action] || "#6b6455", borderColor: ACTION_COLORS[action] || "#6b6455" }}
    >
      {action}
    </span>
  );
}

function PaymentRow({ payment, selected, onSelect }) {
  return (
    <button
      className={`payment-row ${selected?.id === payment.id ? "selected-row" : ""}`}
      onClick={() => onSelect(payment)}
    >
      <span>
        <strong>{payment.id}</strong>
        <small>{payment.customer}</small>
      </span>
      <strong>{money(payment.amount)}</strong>
      <strong className="score" style={{ color: scoreColor(payment.score) }}>{payment.score}%</strong>
      <ActionBadge action={payment.action} />
    </button>
  );
}

function RecoveryChart({ metrics }) {
  const recovered = metrics.revenue_recovered;
  const atRisk = metrics.revenue_at_risk;
  const total = recovered + atRisk || 1;
  const recoveredPct = Math.round((recovered / total) * 100);

  return (
    <div className="chart-bar-wrap">
      <div className="chart-bar">
        <div className="chart-bar-fill" style={{ width: `${recoveredPct}%` }} />
      </div>
      <div className="chart-bar-labels">
        <span className="green">Recovered {recoveredPct}%</span>
        <span>At risk {100 - recoveredPct}%</span>
      </div>
    </div>
  );
}

// Per-payment story built straight from the audit log: no extra
// backend call needed since App already fetches /api/audit.
function RecoveryTimeline({ paymentId, audit }) {
  const events = useMemo(
    () => audit.filter((e) => e.payment_id === paymentId),
    [audit, paymentId]
  );

  if (events.length === 0) return null;

  return (
    <div className="timeline">
      <small>Recovery timeline</small>
      <div className="timeline-track">
        {events.map((event, index) => (
          <div className="timeline-item" key={index}>
            <span
              className="timeline-dot"
              style={{ borderColor: ACTION_COLORS[event.action] || "#a9834b" }}
            />
            <div className="timeline-label">
              <strong>{EVENT_LABELS[event.event] || event.event}</strong>
              {event.action && (
                <span style={{ color: ACTION_COLORS[event.action] || "#6b6455" }}>
                  {event.action}
                </span>
              )}
            </div>
            {index < events.length - 1 && <span className="timeline-arrow">→</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// Shows the customer-facing Hinglish recovery copy the agent would
// send — an SMS/WhatsApp version and a separate voice-call script.
function RecoveryMessagePreview({ message }) {
  const [tab, setTab] = useState("sms");

  if (!message || (!message.sms && !message.voice_script)) return null;

  return (
    <div className="message-preview">
      <small>Customer recovery message (Hinglish)</small>
      <div className="message-tabs">
        <button
          className={`message-tab ${tab === "sms" ? "active" : ""}`}
          onClick={() => setTab("sms")}
        >
          💬 SMS / WhatsApp
        </button>
        <button
          className={`message-tab ${tab === "voice_script" ? "active" : ""}`}
          onClick={() => setTab("voice_script")}
        >
          📞 Voice Call Script
        </button>
      </div>
      <div className="message-bubble">{tab === "sms" ? message.sms : message.voice_script}</div>
    </div>
  );
}

// Shows the planned automated-retry ladder for this payment (real
// backoff timing between attempts, not instant back-to-back retries)
// and lets the demo skip the wait instead of sitting through hours.
function MandateSequencer({ payment, onSkipWait }) {
  const relevant =
    payment.mandate_sequence?.length > 0 &&
    (EXECUTABLE_ACTIONS.includes(payment.action) || payment.attempts > 0);

  if (!relevant) return null;

  const scheduled = payment.next_retry_at ? new Date(payment.next_retry_at) : null;
  const isWaiting = scheduled && scheduled > new Date();

  return (
    <div className="mandate-sequencer">
      <small>Mandate retry sequence</small>
      <div className="mandate-steps">
        {payment.mandate_sequence.map((step) => (
          <div className={`mandate-step ${step.status}`} key={step.step}>
            <span className="mandate-step-dot" />
            <span className="mandate-step-label">{step.label}</span>
          </div>
        ))}
      </div>

      {isWaiting && (
        <div className="mandate-wait">
          <span>⏳ Next attempt eligible {formatScheduledTime(payment.next_retry_at)}</span>
          <button onClick={() => onSkipWait(payment.id)}>⏩ Skip Wait (Demo)</button>
        </div>
      )}
    </div>
  );
}

function DecisionPanel({ selected, audit, onAnalyze, onRecover, onDelete, onPromise, onFulfillPromise, onSkipWait }) {
  const isWaitingOnSchedule =
    selected?.next_retry_at && new Date(selected.next_retry_at) > new Date();
  const canExecute = selected && EXECUTABLE_ACTIONS.includes(selected.action) && !isWaitingOnSchedule;
  const isPromised = selected?.status === "promised";
  const [promiseDate, setPromiseDate] = useState("");

  const handlePromiseSubmit = () => {
    if (!promiseDate) return;
    onPromise(selected.id, promiseDate);
    setPromiseDate("");
  };

  return (
    <div className="card decision">
      <div className="card-header">
        <div>
          <h2>AI Decision</h2>
          <p>Explainable recovery recommendation</p>
        </div>
        <span className="ai-badge">✦ AI</span>
      </div>

      {selected ? (
        <>
          <div className="payment-info">
            <div className="payment-icon">₹</div>
            <div>
              <strong>{selected.id}</strong>
              <small>{selected.customer}</small>
            </div>
            <strong className="payment-amount">{money(selected.amount)}</strong>
          </div>

          <div className="probability">
            <strong style={{ color: scoreColor(selected.score) }}>{selected.score}%</strong>
            <small>Recovery probability</small>
          </div>

          <div className="recommendation">
            <small>Recommended action</small>
            <strong style={{ color: ACTION_COLORS[selected.action] || "#23293a" }}>{selected.action}</strong>
            <p>{selected.explanation}</p>

            {selected.reasoning && selected.reasoning.length > 0 && (
              <>
                <small>Why the AI thinks this</small>
                <ul className="reasoning-list">
                  {selected.reasoning.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <RecoveryMessagePreview message={selected.recovery_message} />

          <MandateSequencer payment={selected} onSkipWait={onSkipWait} />

          <RecoveryTimeline paymentId={selected.id} audit={audit} />

          {isPromised ? (
            <div className="promise-box">
              <small>Active promise</small>
              <strong>Due {selected.promise_date}</strong>
              <div className="decision-buttons">
                <button className="execute" onClick={() => onFulfillPromise(selected.id)}>
                  Mark as Paid
                </button>
              </div>
            </div>
          ) : (
            <div className="promise-box">
              <small>Promise to Pay</small>
              <div className="promise-input-row">
                <input
                  type="date"
                  className="promise-date-input"
                  value={promiseDate}
                  onChange={(e) => setPromiseDate(e.target.value)}
                />
                <button onClick={handlePromiseSubmit} disabled={!promiseDate}>
                  Record Promise
                </button>
              </div>
            </div>
          )}

          <div className="decision-buttons">
            <button onClick={() => onAnalyze(selected.id)}>Re-analyze</button>
            <button
              className="execute"
              onClick={() => onRecover(selected.id)}
              disabled={!canExecute}
              title={
                !canExecute
                  ? isWaitingOnSchedule
                    ? "Waiting for the mandate backoff window"
                    : "Blocked by safety layer — needs human review"
                  : ""
              }
            >
              Execute
            </button>
            <button className="delete" onClick={() => onDelete(selected.id)}>Delete</button>
          </div>

          {!canExecute && (
            <p className="safety-note">
              {isWaitingOnSchedule
                ? "Mandate retry sequencer: this payment is in its backoff window. Use \u201cSkip Wait\u201d above to simulate time passing."
                : "Safety layer: automated execution is only allowed for Retry Now / Retry Later."}
            </p>
          )}
        </>
      ) : (
        <div className="empty">No payment selected</div>
      )}
    </div>
  );
}
function Overview({ payments, metrics, audit, selected, search, setSearch, sortBy, setSortBy, onSelect, onAnalyze, onRecover, onDelete, onPromise, onFulfillPromise, onSkipWait }) {
  const animatedAtRisk = useAnimatedNumber(metrics.revenue_at_risk);
  const animatedRecoverable = useAnimatedNumber(metrics.potentially_recoverable);
  const animatedRecovered = useAnimatedNumber(metrics.revenue_recovered);
  const animatedRate = useAnimatedNumber(metrics.recovery_rate);

  const visiblePayments = useMemo(() => {
    let list = payments;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.id.toLowerCase().includes(q) ||
          p.customer.toLowerCase().includes(q) ||
          (p.failure_reason || "").toLowerCase().includes(q)
      );
    }

    list = [...list].sort((a, b) => {
      if (sortBy === "amount") return b.amount - a.amount;
      if (sortBy === "score") return b.score - a.score;
      return 0;
    });

    return list;
  }, [payments, search, sortBy]);

  return (
    <>
      <div className="simulation">
        <span>ⓘ</span>
        <div>
          <strong>Simulation Mode</strong>
          <span>AI decisions and recovery outcomes are simulated for this demo.</span>
        </div>
        <b>SAFE</b>
      </div>

      <section className="metrics">
        <div className="metric-card">
          <span>Revenue at Risk</span>
          <strong>{money(animatedAtRisk)}</strong>
          <small>Current failed payments</small>
        </div>
        <div className="metric-card">
          <span>Potentially Recoverable</span>
          <strong>{money(animatedRecoverable)}</strong>
          <small>AI identified opportunities</small>
        </div>
        <div className="metric-card">
          <span>Revenue Recovered</span>
          <strong className="green">{money(animatedRecovered)}</strong>
          <small>Successfully recovered</small>
        </div>
        <div className="metric-card">
          <span>Recovery Rate</span>
          <strong className="green">{animatedRate.toFixed(1)}%</strong>
          <small>Overall recovery performance</small>
        </div>
      </section>

      <section className="card performance">
        <div>
          <h2>Recovery Performance</h2>
          <p>Recovered vs. still at-risk revenue</p>
        </div>
        <RecoveryChart metrics={metrics} />
      </section>

      <section className="lower-grid">
        <div className="card queue">
          <div className="card-header">
            <div>
              <h2>AI Recovery Queue</h2>
              <p>Highest-value failed payments</p>
            </div>
            <span className="count">{visiblePayments.length} shown</span>
          </div>

          <div className="queue-controls">
            <input
              className="search-input"
              placeholder="Search payment, customer or reason…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className="sort-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="amount">Sort by amount</option>
              <option value="score">Sort by AI score</option>
            </select>
          </div>

          <div className="table-header">
            <span>PAYMENT</span>
            <span>AMOUNT</span>
            <span>AI SCORE</span>
            <span>ACTION</span>
          </div>

          {visiblePayments.length === 0 ? (
            <div className="empty">No payments match your search.</div>
          ) : (
            visiblePayments.map((payment) => (
              <PaymentRow key={payment.id} payment={payment} selected={selected} onSelect={onSelect} />
            ))
          )}
        </div>

        <DecisionPanel
          selected={selected}
          audit={audit}
          onAnalyze={onAnalyze}
          onRecover={onRecover}
          onDelete={onDelete}
          onPromise={onPromise}
          onFulfillPromise={onFulfillPromise}
          onSkipWait={onSkipWait}
        />
      </section>
    </>
  );
}

function FailedPayments({ payments, selected, onSelect }) {
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>Failed Payments</h2>
          <p>All failed payments handled by RazorRecover</p>
        </div>
        <span className="count">{payments.length} payments</span>
      </div>

      <div className="table-header">
        <span>PAYMENT</span>
        <span>AMOUNT</span>
        <span>AI SCORE</span>
        <span>ACTION</span>
      </div>

      {payments.map((payment) => (
        <PaymentRow key={payment.id} payment={payment} selected={selected} onSelect={onSelect} />
      ))}
    </section>
  );
}

function AIDecisions({ payments, onAnalyze }) {
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>AI Decisions</h2>
          <p>Explainable AI recovery recommendations</p>
        </div>
        <span className="ai-badge">✦ AI</span>
      </div>

      {payments.map((payment) => (
        <div key={payment.id} className="decision-item">
          <div>
            <strong>{payment.id}</strong>
            <small>{payment.customer} · {money(payment.amount)}</small>
          </div>
          <div className="decision-score" style={{ color: scoreColor(payment.score) }}>{payment.score}%</div>
          <ActionBadge action={payment.action} />
          <button onClick={() => onAnalyze(payment.id)}>Analyze</button>
        </div>
      ))}
    </section>
  );
}

function Analytics({ metrics }) {
  const animatedAtRisk = useAnimatedNumber(metrics.revenue_at_risk);
  const animatedRecoverable = useAnimatedNumber(metrics.potentially_recoverable);
  const animatedRecovered = useAnimatedNumber(metrics.revenue_recovered);
  const animatedRate = useAnimatedNumber(metrics.recovery_rate);

  return (
    <>
      <section className="metrics">
        <div className="metric-card">
          <span>Revenue at Risk</span>
          <strong>{money(animatedAtRisk)}</strong>
        </div>
        <div className="metric-card">
          <span>Potentially Recoverable</span>
          <strong>{money(animatedRecoverable)}</strong>
        </div>
        <div className="metric-card">
          <span>Revenue Recovered</span>
          <strong className="green">{money(animatedRecovered)}</strong>
        </div>
        <div className="metric-card">
          <span>Recovery Rate</span>
          <strong className="green">{animatedRate.toFixed(1)}%</strong>
        </div>
      </section>

      <section className="card performance">
        <h2>Recovery Analytics</h2>
        <p>Recovered vs. still at-risk revenue</p>
        <RecoveryChart metrics={metrics} />
      </section>

      <section className="card analytics-summary">
        <h2>Recovery Strategy</h2>
        <p>RazorRecover evaluates failed payments using failure reason, retry attempts and payment value.</p>

        <div className="strategy-grid">
          <div><strong style={{ color: ACTION_COLORS["RETRY NOW"] }}>RETRY NOW</strong><span>Transient failures</span></div>
          <div><strong style={{ color: ACTION_COLORS["RETRY LATER"] }}>RETRY LATER</strong><span>Temporary bank declines</span></div>
          <div><strong style={{ color: ACTION_COLORS["REMINDER"] }}>REMINDER</strong><span>Customer action required</span></div>
          <div><strong style={{ color: ACTION_COLORS["HUMAN REVIEW"] }}>HUMAN REVIEW</strong><span>Low confidence cases</span></div>
        </div>
      </section>
    </>
  );
}

function AuditTrail({ audit }) {
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>Audit Trail</h2>
          <p>Every AI decision and recovery action</p>
        </div>
        <span className="count">{audit.length} events</span>
      </div>

      {audit.length === 0 ? (
        <div className="empty">
          No audit events yet.
          <br />
          Run the AI Agent to generate activity.
        </div>
      ) : (
        audit
          .slice()
          .reverse()
          .map((event, index) => (
            <div className="audit-item" key={index}>
              <div className="audit-icon">✓</div>
              <div>
                <strong>{event.event}</strong>
                <small>Payment: {event.payment_id || "System"}</small>
              </div>
              <span style={{ color: ACTION_COLORS[event.action] || "#6b6455" }}>{event.action || ""}</span>
            </div>
          ))
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// App: owns all state and data fetching, renders the page components
// above and passes them only the data/handlers they need.
// ---------------------------------------------------------------------

function App() {
  const [payments, setPayments] = useState([]);
  const [metrics, setMetrics] = useState({
    revenue_at_risk: 0,
    potentially_recoverable: 0,
    revenue_recovered: 0,
    recovery_rate: 0,
  });

  const [audit, setAudit] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState("overview");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("amount");

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  const loadDashboard = async () => {
    try {
      const [paymentsResponse, metricsResponse, auditResponse] = await Promise.all([
        fetch(`${API}/api/payments`),
        fetch(`${API}/api/metrics`),
        fetch(`${API}/api/audit`),
      ]);

      if (!paymentsResponse.ok || !metricsResponse.ok || !auditResponse.ok) {
        throw new Error("Backend not responding");
      }

      const paymentData = await paymentsResponse.json();
      const metricsData = await metricsResponse.json();
      const auditData = await auditResponse.json();

      setPayments(paymentData);
      setMetrics(metricsData);
      setAudit(auditData);

      setSelected((old) => {
        if (!old && paymentData.length > 0) return paymentData[0];
        if (old) return paymentData.find((p) => p.id === old.id) || paymentData[0] || null;
        return null;
      });
    } catch (error) {
      setMessage("Backend connect nahi ho raha. Port 8000 check karo.");
      console.error(error);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const resetDemo = async () => {
    const confirmed = window.confirm("Reset all demo data back to the original failed payments?");
    if (!confirmed) return;

    setLoading(true);
    try {
      await fetch(`${API}/api/reset`, { method: "POST" });
      await loadDashboard();
      setMessage("Demo data reset — ready to run again.");
    } catch (error) {
      setMessage("Reset failed.");
    }
    setLoading(false);
  };

  const runAgent = async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`${API}/api/agent/run`, { method: "POST" });
      const data = await response.json();
      await loadDashboard();
      setMessage(`AI Agent analyzed ${data.analyzed} failed payments successfully.`);
    } catch (error) {
      setMessage("AI Agent run failed.");
    }
    setLoading(false);
  };

  const analyzePayment = async (paymentId) => {
    try {
      const response = await fetch(`${API}/api/payments/${paymentId}/decision`, { method: "POST" });
      const data = await response.json();
      setSelected(data.payment);
      await loadDashboard();
      setMessage(`AI Decision: ${data.payment.action}`);
    } catch (error) {
      setMessage("AI analysis failed.");
    }
  };

  const recoverPayment = async (paymentId) => {
    try {
      const response = await fetch(`${API}/api/payments/${paymentId}/recover`, { method: "POST" });
      const data = await response.json();
      setMessage(data.message);
      await loadDashboard();
    } catch (error) {
      setMessage("Recovery failed.");
    }
  };

    const deletePayment = async (paymentId) => {
    const confirmed = window.confirm(`Delete payment ${paymentId}? This can't be undone.`);
    if (!confirmed) return;

    try {
      const response = await fetch(`${API}/api/payments/${paymentId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Delete failed");
      await loadDashboard();
      setMessage("Payment removed.");
    } catch (error) {
      setMessage("Delete failed.");
    }
  };

  const makePromise = async (paymentId, promiseDate) => {
    try {
      const response = await fetch(`${API}/api/payments/${paymentId}/promise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promise_date: promiseDate }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.detail || "Could not record promise.");
        return;
      }
      setMessage(`Promise recorded — due ${promiseDate}.`);
      await loadDashboard();
    } catch (error) {
      setMessage("Promise request failed.");
    }
  };

  const fulfillPromise = async (paymentId) => {
    try {
      const response = await fetch(`${API}/api/payments/${paymentId}/promise/fulfill`, { method: "POST" });
      const data = await response.json();
      setMessage(data.message);
      await loadDashboard();
    } catch (error) {
      setMessage("Could not mark promise as fulfilled.");
    }
  };

  const skipWait = async (paymentId) => {
    try {
      const response = await fetch(`${API}/api/payments/${paymentId}/skip-wait`, { method: "POST" });
      const data = await response.json();
      setMessage(data.message);
      await loadDashboard();
    } catch (error) {
      setMessage("Could not skip wait.");
    }
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          <span>R</span>
          <strong>RazorRecover</strong>
        </div>

        <div className="menu-title">Ledger</div>

        <button className={`menu ${page === "overview" ? "active" : ""}`} onClick={() => setPage("overview")}>◈ Overview</button>
        <button className={`menu ${page === "payments" ? "active" : ""}`} onClick={() => setPage("payments")}>◈ Failed Payments</button>
        <button className={`menu ${page === "decisions" ? "active" : ""}`} onClick={() => setPage("decisions")}>◈ AI Decisions</button>
        <button className={`menu ${page === "analytics" ? "active" : ""}`} onClick={() => setPage("analytics")}>◈ Analytics</button>
        <button className={`menu ${page === "audit" ? "active" : ""}`} onClick={() => setPage("audit")}>◈ Audit Trail</button>

        <div className="agent-status">
          <div>● AI AGENT ONLINE</div>
          <small>Recovery engine active</small>
        </div>
      </aside>

      <main className="main">
        <header className="header">
          <div>
            <div className="eyebrow">Revenue operations</div>
            <h1>
              {page === "overview" && "Recovery Command Center"}
              {page === "payments" && "Failed Payments"}
              {page === "decisions" && "AI Decisions"}
              {page === "analytics" && "Recovery Analytics"}
              {page === "audit" && "Audit Trail"}
            </h1>
            <p>AI-powered recovery for failed payments</p>
          </div>

          <div className="header-actions">
            <span className="live">● LIVE</span>
            <button className="reset-demo" onClick={resetDemo} disabled={loading}>
              ↺ Reset Demo
            </button>
            <button className="run-agent" onClick={runAgent} disabled={loading}>
              ✦ {loading ? "Analyzing..." : "Run AI Agent"}
            </button>
          </div>
        </header>

        {page === "overview" && (
          <Overview
            payments={payments}
            metrics={metrics}
            audit={audit}
            selected={selected}
            search={search}
            setSearch={setSearch}
            sortBy={sortBy}
            setSortBy={setSortBy}
            onSelect={setSelected}
            onAnalyze={analyzePayment}
            onRecover={recoverPayment}
            onDelete={deletePayment}
            onPromise={makePromise}
            onFulfillPromise={fulfillPromise}
            onSkipWait={skipWait}
          />
        )}
        {page === "payments" && (
          <FailedPayments payments={payments} selected={selected} onSelect={setSelected} />
        )}
        {page === "decisions" && (
          <AIDecisions payments={payments} onAnalyze={analyzePayment} />
        )}
        {page === "analytics" && <Analytics metrics={metrics} />}
        {page === "audit" && <AuditTrail audit={audit} />}

        {message && <div className="toast">{message}</div>}
      </main>
    </div>
  );
}

export default App;