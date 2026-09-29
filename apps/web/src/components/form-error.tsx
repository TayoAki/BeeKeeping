/** An error message that screen readers announce when it appears. */
export function FormError({ message }: { message: string | undefined }) {
  return (
    <p role="alert" className="error">
      {message ?? ""}
    </p>
  );
}
