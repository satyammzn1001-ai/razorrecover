import { useEffect, useMemo, useState, useRef } from "react";
import "./App.css";

const API = "http://127.0.0.1:8000";

// Animates a number from its previous value to a new target whenever
// the target changes — used on the metric cards so numbers visibly
// count up/down instead of jumping, especially right after "Run AI Agent".
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
      // ease-out for a natural deceleration
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

const ACTION_COLORS = {
  "RETRY NOW": "#6fe0a0",
  "RETRY LATER": "#8fb3ff",
  "REMINDER": "#e0c56f",
  "HUMAN REVIEW": "#e0716f",
  "UNANALYZED": "#6b7280",
};

const EXECUTABLE_ACTIONS = ["RETRY NOW", "RETRY LATER"];

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

  // auto-dismiss toast after 4 seconds
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

  const money = (amount) => `₹${Number(amount || 0).toLocaleString("en-IN")}`;

  // Hooks live here at the top level of App, not inside Overview/Analytics.
  // Overview/Analytics were being redefined as new inline components on every
  // render, which made React remount them and reset the animation's internal
  // state each time — so the numbers jumped instead of counting up.
  const animatedAtRisk = useAnimatedNumber(metrics.revenue_at_risk);
  const animatedRecoverable = useAnimatedNumber(metrics.potentially_recoverable);
  const animatedRecovered = useAnimatedNumber(metrics.revenue_recovered);
  const animatedRate = useAnimatedNumber(metrics.recovery_rate);

  const scoreColor = (score) => {
    if (score >= 70) return "#6fe0a0";
    if (score >= 45) return "#e0c56f";
    return "#e0716f";
  };

  // filtered + sorted view of the payments queue, without touching the
  // underlying data used elsewhere on the dashboard
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

  const ActionBadge = ({ action }) => (
    <span
      className="action-badge"
      style={{ color: ACTION_COLORS[action] || "#b3b8c2", borderColor: (ACTION_COLORS[action] || "#232b40") + "55" }}
    >
      {action}
    </span>
  );

  const PaymentRow = ({ payment }) => (
    <button
      className={`payment-row ${selected?.id === payment.id ? "selected-row" : ""}`}
      onClick={() => setSelected(payment)}
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

  // simple sparkline built from the current recovery rate history-ish shape,
  // just to visualise the recovered vs at-risk split without a chart library
  const RecoveryChart = () => {
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
  };

  const Overview = () => (
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
        <RecoveryChart />
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
  placeholder="Search payment, customer or reason..."
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
            visiblePayments.map((payment) => <PaymentRow key={payment.id} payment={payment} />)
          )}
        </div>

        <DecisionPanel />
      </section>
    </>
  );

  const DecisionPanel = () => {
    const canExecute = selected && EXECUTABLE_ACTIONS.includes(selected.action);

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
              <small>RECOVERY PROBABILITY</small>
            </div>

            <div className="recommendation">
              <small>RECOMMENDED ACTION</small>
              <strong style={{ color: ACTION_COLORS[selected.action] || "#e6e6e6" }}>{selected.action}</strong>
              <p>{selected.explanation}</p>
            </div>

            <div className="decision-buttons">
              <button onClick={() => analyzePayment(selected.id)}>Re-analyze</button>
              <button
                className="execute"
                onClick={() => recoverPayment(selected.id)}
                disabled={!canExecute}
                title={!canExecute ? "Blocked by safety layer — needs human review" : ""}
              >
                Execute
              </button>
              <button className="delete" onClick={() => deletePayment(selected.id)}>Delete</button>
            </div>

            {!canExecute && (
              <p className="safety-note">
                🔒 Safety layer: automated execution is only allowed for RETRY NOW / RETRY LATER.
              </p>
            )}
          </>
        ) : (
          <div className="empty">No payment selected</div>
        )}
      </div>
    );
  };

  const FailedPayments = () => (
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
        <PaymentRow key={payment.id} payment={payment} />
      ))}
    </section>
  );

  const AIDecisions = () => (
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
          <button onClick={() => analyzePayment(payment.id)}>Analyze</button>
        </div>
      ))}
    </section>
  );

  const Analytics = () => (
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
        <RecoveryChart />
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

  const AuditTrail = () => (
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
              <span style={{ color: ACTION_COLORS[event.action] || "#8a8f98" }}>{event.action || ""}</span>
            </div>
          ))
      )}
    </section>
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          <span>R</span>
          <strong>RazorRecover</strong>
        </div>

        <div className="menu-title">COMMAND CENTER</div>

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
            <div className="eyebrow">REVENUE OPERATIONS</div>
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

        {page === "overview" && <Overview />}
        {page === "payments" && <FailedPayments />}
        {page === "decisions" && <AIDecisions />}
        {page === "analytics" && <Analytics />}
        {page === "audit" && <AuditTrail />}

        {message && <div className="toast">{message}</div>}
      </main>
    </div>
  );
}

export default App;