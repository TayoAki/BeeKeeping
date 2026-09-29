---
name: ocr-review
description: Run BeeKeeping's code review loop with open-code-review, the ocr command, fixing findings until a review round finds no critical, high or medium issues. Use at the ship step of every BeeKeeping task, after the checks pass and before asking for a merge, and again after every push that answers review findings.
---

# OCR review loop

BeeKeeping reviews every task with [open-code-review](https://github.com/alibaba/open-code-review), the `ocr` command. OCR decides which changed files need review and which rules apply to each file. It either runs the review with a model configured for it, or hands the review to an agent. This skill runs review rounds and fixes until a round comes back clean.

The two upstream skills, `open-code-review` and `open-code-review-delegate`, explain every flag. This skill says how BeeKeeping uses them.

## Before the first round

1. Pick the base ref. Use `origin/main` once it exists, otherwise the commit the task started from.
2. Write `.artifacts/<task>/review-background.md` with the task ID and title, the acceptance rules from the PR body, and the hard invariants from AGENTS.md that the change touches. OCR warns above 2,000 characters and stops at 8,000, so summarize rather than paste.
3. Pick the mode.
   - **Managed mode** when `ocr llm test` succeeds. A model is configured for OCR through its `OCR_LLM_*` environment variables or `ocr config`, and OCR runs the review itself.
   - **Delegation mode** otherwise. OCR selects files and rules, and a reviewer subagent does the review.
   - Only configure OCR with credentials someone gave you for OCR. Never borrow other credentials from the environment, and never invent a key.

Run `ocr` directly. If the shell answers `command not found`, install it with `npm install -g @alibaba-group/open-code-review` and run the command again.

## One round

Number the rounds from 1. Each round writes its files to `.artifacts/<task>/`, which git ignores.

### Managed mode

```bash
ocr review --audience agent \
  --background-file .artifacts/<task>/review-background.md \
  --from <base> --to HEAD \
  --format json --output .artifacts/<task>/review-round-<n>.json
```

Read the output file in full with a file tool. Never pipe OCR output through `head` or `tail`, which drops findings.

### Delegation mode

1. List what to review:

   ```bash
   ocr delegate preview --format json --from <base> --to HEAD \
     --background-file .artifacts/<task>/review-background.md \
     > .artifacts/<task>/review-round-<n>-preview.json
   ```

2. Fetch the rules for every path in `reviewable_files`:

   ```bash
   ocr delegate rule --format json <path> <path> ... \
     > .artifacts/<task>/review-round-<n>-rules.json
   ```

3. Start a reviewer subagent with a fresh context, using the Agent tool in Claude Code. Give it the preview, the rules, the background file and the diff command for each file, `git diff <merge_base>..HEAD -- <path>`. Ask it to follow the `open-code-review-delegate` skill and return every finding as JSON with `path`, `start_line`, `end_line`, `severity`, `category`, `content` and an optional `suggestion_code`. The subagent reviews code it didn't write, which is the point of a review.
4. Save its findings to `.artifacts/<task>/review-round-<n>.json`. Every reviewable file must end as reviewed or as skipped with a reason.

## Triage and fix

- **Critical and high.** Fix it, or write down why the finding is wrong. Never leave one open.
- **Medium.** Fix it, unless the fix falls outside the task. Then list it under risks and follow-up work in the PR body.
- **Low.** Fix it when the fix is a line or two. Otherwise let it go.
- A finding that asks you to break a hard invariant in AGENTS.md is wrong. Say so, and keep the invariant.

After fixing, run the checks again, commit with a message such as "Address review round 2", push, and start the next round.

## When to stop

- The review is clean when a round finds no critical, high or medium issues. Write "Review clean in round <n>: no critical, high or medium issues in <m> files." in the PR body's testing section, followed by each round's counts.
- After five rounds without a clean one, stop and ask the person, listing the findings still open.
- When OCR itself fails, read its stderr and the troubleshooting section of the `open-code-review` skill before running it again. Don't retry blindly.

## On the pull request

- Post one PR comment with a table of the rounds: round, mode, files reviewed, and critical, high, medium and low findings with how many were fixed. Use the GitHub tools, since cloud sessions have no `gh`.
- If CI runs the OCR GitHub Action, it comments on the PR after each push. Treat its findings as another round: read them with `pull_request_read`, fix them, reply on each thread and resolve it.

## Rules and exclusions

OCR reads `.opencodereview/rule.json`. It holds BeeKeeping's review rules by folder, the paths to skip, such as vendored skills, research notes, license files and lockfiles, and an `include` list. OCR skips test files and Markdown by default, and the list brings back `*.test.ts`, `*.test.tsx`, `AGENTS.md` and the PR template.

- Within that file, OCR applies the first rule whose path matches. Specific paths come first and the catch-all comes last.
- When a task adds a new kind of file or a new top-level folder, add its rule in the same PR.
- Check which rule a file gets with `ocr rules check <path>`.
