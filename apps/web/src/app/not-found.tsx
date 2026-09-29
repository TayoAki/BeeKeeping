import Link from "next/link";

// An address with no page. It renders in the root layout, outside the app
// shell, so it brings its own main landmark.
export default function NotFound() {
  return (
    <main>
      <h1>There&apos;s no page here</h1>
      <p>
        Check the address, or <Link href="/">go to your home page</Link>.
      </p>
    </main>
  );
}
