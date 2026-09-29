// Actions decide the why and when: who may act, whether the action is allowed
// now, what it means in the ledger, and what the user sees when it fails.
// They read and write our tables inside the request's transaction.
// Orchestration that many actions share, such as postEntry, lives in shared/.
// See "Writing code with code-structure" in docs/execution-plan.md.
