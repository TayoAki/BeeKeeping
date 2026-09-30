import type { ReactNode } from "react";

/**
 * Holds a table that can be wider than a phone's screen. The table scrolls
 * sideways inside this box, so the page itself never does. The box takes
 * focus, so a keyboard can scroll it, and the label names it when it does.
 */
export function TableScroll({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    // A keyboard can scroll a box only once the box can take focus.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
