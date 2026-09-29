// Shown with a 403 when a page calls forbidden(). Next.js reads no metadata
// from this file, so a page that can refuse names itself for both cases, as
// the members page does.
export default function Forbidden() {
  return (
    <>
      <h1>You can&apos;t open this page</h1>
      <p>
        Your role in this organization doesn&apos;t include it. Ask an owner or
        an admin if you need access.
      </p>
    </>
  );
}
