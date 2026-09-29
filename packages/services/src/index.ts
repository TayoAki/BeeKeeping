// Services do the reusable how. Each one takes everything as parameters,
// never reads the session or our tables, and returns ok(...) or fail(reason)
// instead of throwing for failures it expects.
export { fail, ok } from "./result.ts";
export type { Fail, Ok, Result } from "./result.ts";
export * as email from "./email/index.ts";
export * as money from "./money/index.ts";
