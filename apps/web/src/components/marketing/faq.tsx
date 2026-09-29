import { FAQ_ITEMS } from "@/lib/marketing-content";

const ITEMS = FAQ_ITEMS;

export function FAQ() {
  return (
    <section className="section section-alt" id="faq" data-nav="pricing" aria-labelledby="faq-title">
      <div className="shell faq">
        <div className="faq-side" data-reveal>
          <div className="sh-meta">
            <span className="sh-index">09</span>
            <span className="sh-label">Questions</span>
          </div>
          <h2 id="faq-title" className="display-3">
            What teams ask before they connect a repository.
          </h2>
          <p>
            Something else? Email{" "}
            <a className="text-link" href="mailto:hello@savant.app">
              hello@savant.app
            </a>
            . We reply within a day.
          </p>
        </div>
        <div className="faq-list" data-reveal data-reveal-delay="1">
          {ITEMS.map((item) => (
            <details key={item.q} className="faq-item" data-track="faq_expand" data-track-question={item.q}>
              <summary>
                <span>{item.q}</span>
                <span className="faq-glyph" aria-hidden="true" />
              </summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
