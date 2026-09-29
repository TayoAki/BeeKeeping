import type { ReactNode } from "react";

/**
 * A form's submit button. While the request runs it is marked with
 * aria-disabled rather than disabled, so it keeps keyboard focus, and
 * useRequest ignores a second submit.
 */
export function SubmitButton({
  pending,
  className,
  children,
}: {
  pending: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button type="submit" className={className} aria-disabled={pending}>
      {children}
    </button>
  );
}
