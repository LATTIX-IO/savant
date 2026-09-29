type Metric = {
  value: string;
  unit?: string;
  label: string;
  trend: string;
  direction: "up" | "down";
};

// Illustrative figures from the demo workspace, not aggregate customer data.
// The rail says so on screen; swap in real aggregates when they exist.
const METRICS: Metric[] = [
  { value: "218", unit: "+", label: "Skills governed", trend: "+14 this quarter", direction: "up" },
  { value: "94", unit: "%", label: "Eval coverage", trend: "+2.1 pts / 30d", direction: "up" },
  { value: "81", unit: "%", label: "First-pass acceptance", trend: "+0.4 pts / 30d", direction: "up" },
  { value: "2.4", unit: "d", label: "Release turnaround", trend: "−0.6d vs prior month", direction: "down" },
];

export function MetricRail() {
  return (
    <section className="mrail" data-nav="" aria-labelledby="mrail-title">
      <div className="shell mrail-inner">
        <div className="mrail-head">
          <h2 id="mrail-title" className="mrail-title">
            Example workspace
          </h2>
          <span className="mrail-note">Illustrative figures from the Savant demo workspace</span>
        </div>
        <dl className="mrail-grid">
          {METRICS.map((metric) => (
            <div key={metric.label} className="mrail-metric" data-reveal>
              <dt className="mrail-label">{metric.label}</dt>
              <dd className="mrail-value">
                <span className="num">{metric.value}</span>
                {metric.unit ? <span className="mrail-unit">{metric.unit}</span> : null}
              </dd>
              <dd className="mrail-trend" data-direction={metric.direction}>
                <span aria-hidden="true">{metric.direction === "up" ? "↗" : "↘"}</span> {metric.trend}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
