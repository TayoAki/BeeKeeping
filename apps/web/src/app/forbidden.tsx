import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Not allowed" };

export default function Forbidden() {
  return (
    <main>
      <h1>You can&apos;t open this page</h1>
      <p>
        Your role in this organization doesn&apos;t include it. Ask an owner or
        an admin if you need access.
      </p>
      <p>
        <Link href="/">Back to your books</Link>
      </p>
    </main>
  );
}
