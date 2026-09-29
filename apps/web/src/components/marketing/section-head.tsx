import type { ReactNode } from "react";

/**
 * Editorial section opener: metadata sits on the left above a hairline, the
 * headline and explanation hang off the right columns. Keeps sections
 * asymmetric instead of centring headline → paragraph → cards.
 */
export function SectionHead({
  index,
  meta,
  title,
  children,
  id,
}: {
  index: string;
  meta: string;
  title: ReactNode;
  children?: ReactNode;
  id?: string;
}) {
  return (
    <div className="sh" data-reveal>
      <div className="sh-meta">
        <span className="sh-index">{index}</span>
        <span className="sh-label">{meta}</span>
      </div>
      <div className="sh-body">
        <h2 id={id} className="display-2">
          {title}
        </h2>
        {children ? <div className="sh-copy">{children}</div> : null}
      </div>
    </div>
  );
}
