import { useEffect, useState } from "react";
import "./App.css";

const API = "http://127.0.0.1:8000";

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

  const loadDashboard = async () => {
    try {
      const [paymentsResponse, metricsResponse, auditResponse] =
        await Promise.all([
          fetch(`${API}/api/payments`),
          fetch(`${API}/api/metrics`),
          fetch(`${API}/api/audit`),
        ]);

      if (
        !paymentsResponse.ok ||
        !metricsResponse.ok ||
        !auditResponse.ok
      ) {
        throw new Error("Backend not responding");
      }

      const paymentData = await paymentsResponse.json();
      const metricsData = await metricsResponse.json();
      const auditData = await auditResponse.json();

      setPayments(paymentData);
      setMetrics(metricsData);
      setAudit(auditData);

      setSelected((old) => {
        if (!old && paymentData.length > 0) {
          return paymentData[0];
        }

        if (old) {
          return (
            paymentData.find((p) => p.id === old.id) ||
            paymentData[0] ||
            null
          );
        }

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

  // -----------------------------
  // RUN AI AGENT
  // -----------------------------

  const runAgent = async () => {
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${API}/api/agent/run`, {
        method: "POST",
      });

      const data = await response.json();

      await loadDashboard();

      setMessage(
        `AI Agent analyzed ${data.analyzed} failed payments successfully.`
      );
    } catch (error) {
      setMessage("AI Agent run failed.");
    }

    setLoading(false);
  };

  // -----------------------------
  // AI DECISION
  // -----------------------------

  const analyzePayment = async (paymentId) => {
    try {
      const response = await fetch(
        `${API}/api/payments/${paymentId}/decision`,
        {
          method: "POST",
        }
      );

      const data = await response.json();

      setSelected(data.payment);

      await loadDashboard();

      setMessage(`AI Decision: ${data.payment.action}`);
    } catch (error) {
      setMessage("AI analysis failed.");
    }
  };

  // -----------------------------
  // RECOVER PAYMENT
  // -----------------------------

  const recoverPayment = async (paymentId) => {
    try {
      const response = await fetch(
        `${API}/api/payments/${paymentId}/recover`,
        {
          method: "POST",
        }
      );

      const data = await response.json();

      setMessage(data.message);

      await loadDashboard();
    } catch (error) {
      setMessage("Recovery failed.");
    }
  };

  // -----------------------------
  // DELETE PAYMENT
  // -----------------------------

  const deletePayment = async (paymentId) => {
    try {
      const response = await fetch(
        `${API}/api/payments/${paymentId}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        throw new Error("Delete failed");
      }

      await loadDashboard();

      setMessage("Payment removed.");
    } catch (error) {
      setMessage("Delete failed.");
    }
  };

  // -----------------------------
  // MONEY
  // -----------------------------

  const money = (amount) => {
    return `₹${Number(amount || 0).toLocaleString("en-IN")}`;
  };

  // -----------------------------
  // PAYMENT ROW
  // -----------------------------

  const PaymentRow = ({ payment }) => (
    <button
      className={`payment-row ${
        selected?.id === payment.id ? "selected-row" : ""
      }`}
      onClick={() => setSelected(payment)}
    >
      <span>
        <strong>{payment.id}</strong>
        <small>{payment.customer}</small>
      </span>

      <strong>{money(payment.amount)}</strong>

      <strong className="score">
        {payment.score}%
      </strong>

      <span className="action-badge">
        {payment.action}
      </span>
    </button>
  );

  // -----------------------------
  // OVERVIEW
  // -----------------------------

  const Overview = () => (
    <>
      <div className="simulation">
        <span>ⓘ</span>

        <div>
          <strong>Simulation Mode</strong>

          <span>
            AI decisions and recovery outcomes are simulated
            for this demo.
          </span>
        </div>

        <b>SAFE</b>
      </div>

      <section className="metrics">

        <div className="metric-card">
          <span>Revenue at Risk</span>

          <strong>
            {money(metrics.revenue_at_risk)}
          </strong>

          <small>Current failed payments</small>
        </div>

        <div className="metric-card">
          <span>Potentially Recoverable</span>

          <strong>
            {money(metrics.potentially_recoverable)}
          </strong>

          <small>AI identified opportunities</small>
        </div>

        <div className="metric-card">
          <span>Revenue Recovered</span>

          <strong className="green">
            {money(metrics.revenue_recovered)}
          </strong>

          <small>Successfully recovered</small>
        </div>

        <div className="metric-card">
          <span>Recovery Rate</span>

          <strong className="green">
            {metrics.recovery_rate}%
          </strong>

          <small>Overall recovery performance</small>
        </div>

      </section>

      <section className="card performance">

        <div>
          <h2>Recovery Performance</h2>

          <p>
            Revenue recovered over the last 7 days
          </p>
        </div>

        <div className="chart">
          <div className="chart-line"></div>
        </div>

      </section>

      <section className="lower-grid">

        <div className="card queue">

          <div className="card-header">

            <div>
              <h2>AI Recovery Queue</h2>

              <p>
                Highest-value failed payments
              </p>
            </div>

            <span className="count">
              {payments.length} pending
            </span>

          </div>

          <div className="table-header">
            <span>PAYMENT</span>
            <span>AMOUNT</span>
            <span>AI SCORE</span>
            <span>ACTION</span>
          </div>

          {payments.map((payment) => (
            <PaymentRow
              key={payment.id}
              payment={payment}
            />
          ))}

        </div>

        <DecisionPanel />

      </section>
    </>
  );

  // -----------------------------
  // DECISION PANEL
  // -----------------------------

  const DecisionPanel = () => (
    <div className="card decision">

      <div className="card-header">

        <div>
          <h2>AI Decision</h2>

          <p>
            Explainable recovery recommendation
          </p>
        </div>

        <span className="ai-badge">
          ✦ AI
        </span>

      </div>

      {selected ? (
        <>
          <div className="payment-info">

            <div className="payment-icon">
              ₹
            </div>

            <div>
              <strong>{selected.id}</strong>

              <small>
                {selected.customer}
              </small>
            </div>

            <strong className="payment-amount">
              {money(selected.amount)}
            </strong>

          </div>

          <div className="probability">

            <strong>
              {selected.score}%
            </strong>

            <small>
              RECOVERY PROBABILITY
            </small>

          </div>

          <div className="recommendation">

            <small>
              RECOMMENDED ACTION
            </small>

            <strong>
              {selected.action}
            </strong>

            <p>
              {selected.explanation}
            </p>

          </div>

          <div className="decision-buttons">

            <button
              onClick={() =>
                analyzePayment(selected.id)
              }
            >
              Re-analyze
            </button>

            <button
              className="execute"
              onClick={() =>
                recoverPayment(selected.id)
              }
            >
              Execute
            </button>

            <button
              className="delete"
              onClick={() =>
                deletePayment(selected.id)
              }
            >
              Delete
            </button>

          </div>
        </>
      ) : (
        <div className="empty">
          No payment selected
        </div>
      )}

    </div>
  );

  // -----------------------------
  // FAILED PAYMENTS PAGE
  // -----------------------------

  const FailedPayments = () => (
    <section className="card">

      <div className="card-header">

        <div>
          <h2>Failed Payments</h2>

          <p>
            All failed payments handled by RazorRecover
          </p>
        </div>

        <span className="count">
          {payments.length} payments
        </span>

      </div>

      <div className="table-header">
        <span>PAYMENT</span>
        <span>AMOUNT</span>
        <span>AI SCORE</span>
        <span>ACTION</span>
      </div>

      {payments.map((payment) => (
        <PaymentRow
          key={payment.id}
          payment={payment}
        />
      ))}

    </section>
  );

  // -----------------------------
  // AI DECISIONS PAGE
  // -----------------------------

  const AIDecisions = () => (
    <section className="card">

      <div className="card-header">

        <div>
          <h2>AI Decisions</h2>

          <p>
            Explainable AI recovery recommendations
          </p>
        </div>

        <span className="ai-badge">
          ✦ AI
        </span>

      </div>

      {payments.map((payment) => (
        <div
          key={payment.id}
          className="decision-item"
        >

          <div>
            <strong>{payment.id}</strong>

            <small>
              {payment.customer} · {money(payment.amount)}
            </small>
          </div>

          <div className="decision-score">
            {payment.score}%
          </div>

          <div className="action-badge">
            {payment.action}
          </div>

          <button
            onClick={() =>
              analyzePayment(payment.id)
            }
          >
            Analyze
          </button>

        </div>
      ))}

    </section>
  );

  // -----------------------------
  // ANALYTICS PAGE
  // -----------------------------

  const Analytics = () => (
    <>
      <section className="metrics">

        <div className="metric-card">
          <span>Revenue at Risk</span>
          <strong>
            {money(metrics.revenue_at_risk)}
          </strong>
        </div>

        <div className="metric-card">
          <span>Potentially Recoverable</span>
          <strong>
            {money(metrics.potentially_recoverable)}
          </strong>
        </div>

        <div className="metric-card">
          <span>Revenue Recovered</span>
          <strong className="green">
            {money(metrics.revenue_recovered)}
          </strong>
        </div>

        <div className="metric-card">
          <span>Recovery Rate</span>
          <strong className="green">
            {metrics.recovery_rate}%
          </strong>
        </div>

      </section>

      <section className="card performance">

        <h2>Recovery Analytics</h2>

        <p>
          AI-powered recovery performance
        </p>

        <div className="chart">
          <div className="chart-line"></div>
        </div>

      </section>

      <section className="card analytics-summary">

        <h2>Recovery Strategy</h2>

        <p>
          RazorRecover evaluates failed payments using
          failure reason, retry attempts and payment value.
        </p>

        <div className="strategy-grid">

          <div>
            <strong>RETRY NOW</strong>
            <span>Transient failures</span>
          </div>

          <div>
            <strong>RETRY LATER</strong>
            <span>Temporary bank declines</span>
          </div>

          <div>
            <strong>REMINDER</strong>
            <span>Customer action required</span>
          </div>

          <div>
            <strong>HUMAN REVIEW</strong>
            <span>Low confidence cases</span>
          </div>

        </div>

      </section>
    </>
  );

  // -----------------------------
  // AUDIT TRAIL PAGE
  // -----------------------------

  const AuditTrail = () => (
    <section className="card">

      <div className="card-header">

        <div>
          <h2>Audit Trail</h2>

          <p>
            Every AI decision and recovery action
          </p>
        </div>

        <span className="count">
          {audit.length} events
        </span>

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
            <div
              className="audit-item"
              key={index}
            >

              <div className="audit-icon">
                ✓
              </div>

              <div>
                <strong>
                  {event.event}
                </strong>

                <small>
                  Payment: {event.payment_id || "System"}
                </small>
              </div>

              <span>
                {event.action || ""}
              </span>

            </div>
          ))
      )}

    </section>
  );

  return (
    <div className="app">

      {/* SIDEBAR */}

      <aside className="sidebar">

        <div className="logo">
          <span>R</span>
          <strong>RazorRecover</strong>
        </div>

        <div className="menu-title">
          COMMAND CENTER
        </div>

        <button
          className={`menu ${
            page === "overview" ? "active" : ""
          }`}
          onClick={() => setPage("overview")}
        >
          ◈ Overview
        </button>

        <button
          className={`menu ${
            page === "payments" ? "active" : ""
          }`}
          onClick={() => setPage("payments")}
        >
          ◈ Failed Payments
        </button>

        <button
          className={`menu ${
            page === "decisions" ? "active" : ""
          }`}
          onClick={() => setPage("decisions")}
        >
          ◈ AI Decisions
        </button>

        <button
          className={`menu ${
            page === "analytics" ? "active" : ""
          }`}
          onClick={() => setPage("analytics")}
        >
          ◈ Analytics
        </button>

        <button
          className={`menu ${
            page === "audit" ? "active" : ""
          }`}
          onClick={() => setPage("audit")}
        >
          ◈ Audit Trail
        </button>

        <div className="agent-status">
          <div>● AI AGENT ONLINE</div>
          <small>Recovery engine active</small>
        </div>

      </aside>

      {/* MAIN */}

      <main className="main">

        <header className="header">

          <div>

            <div className="eyebrow">
              REVENUE OPERATIONS
            </div>

            <h1>
              {page === "overview" &&
                "Recovery Command Center"}

              {page === "payments" &&
                "Failed Payments"}

              {page === "decisions" &&
                "AI Decisions"}

              {page === "analytics" &&
                "Recovery Analytics"}

              {page === "audit" &&
                "Audit Trail"}
            </h1>

            <p>
              AI-powered recovery for failed payments
            </p>

          </div>

          <div className="header-actions">

            <span className="live">
              ● LIVE
            </span>

            <button
              className="run-agent"
              onClick={runAgent}
              disabled={loading}
            >
              ✦{" "}
              {loading
                ? "Analyzing..."
                : "Run AI Agent"}
            </button>

          </div>

        </header>

        {/* PAGE */}

        {page === "overview" && <Overview />}

        {page === "payments" && (
          <FailedPayments />
        )}

        {page === "decisions" && (
          <AIDecisions />
        )}

        {page === "analytics" && (
          <Analytics />
        )}

        {page === "audit" && (
          <AuditTrail />
        )}

        {message && (
          <div className="toast">
            {message}
          </div>
        )}

      </main>

    </div>
  );
}

export default App;