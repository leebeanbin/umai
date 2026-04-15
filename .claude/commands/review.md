---
description: "Two-phase code review: pr-review-toolkit (local deep analysis) + code-review (GitHub PR comment)"
argument-hint: "[pr-number] [aspects: all|code|errors|types|tests|comments|simplify]"
allowed-tools: ["Bash", "Glob", "Grep", "Read", "Agent"]
---

# Umai Code Review Workflow

Two-phase review: **pr-review-toolkit** as the base (deep local analysis) → **code-review** for GitHub PR comment.

Arguments: "$ARGUMENTS"
- First arg (optional): PR number (e.g. `14`). If omitted, uses current branch's open PR.
- Second arg (optional): review aspects — `all` (default), `code`, `errors`, `types`, `tests`, `comments`, `simplify`

---

## Phase 1 — pr-review-toolkit (local, deep)

Run specialized agents in parallel on the git diff. Each agent owns one concern:

1. **code-reviewer** — CLAUDE.md compliance, general bugs, style violations
2. **silent-failure-hunter** — catch blocks, swallowed errors, missing error logging
3. **type-design-analyzer** — Pydantic models (backend) and TypeScript types (frontend), invariant quality
4. **pr-test-analyzer** — test coverage gaps, untested edge cases
5. **comment-analyzer** — code comments that no longer match the implementation

Collect all findings. Organize output:

```
## Phase 1 — Local Analysis

### Critical (must fix before merge)
- [agent]: description [file:line]

### Important (should fix)
- [agent]: description [file:line]

### Suggestions (nice to have)
- [agent]: description [file:line]
```

If there are Critical or Important issues, stop and report them to the user before proceeding to Phase 2.

---

## Phase 2 — code-review (GitHub PR comment)

Only run if Phase 1 found no Critical/Important issues (or user confirms to proceed anyway).

Using the PR number from arguments (or `gh pr view --json number` to detect it):

Launch 5 parallel agents on the GitHub PR diff:
1. CLAUDE.md compliance audit
2. Obvious bug scan (changes only)
3. git blame / history context analysis
4. Previous PR comments on the same files
5. Inline code comment guidance compliance

Score each issue 0–100. Filter < 80. Post to GitHub PR via `gh pr comment`.

---

## Important rules
- Links in GitHub comments must use full git SHA (`git rev-parse HEAD`), not abbreviated
- No emojis except 🤖 in footer
- False positive filters: pre-existing issues, linter-catchable, eslint-disable-line comments, intentional patterns
- Intentional patterns in this repo (do NOT flag):
  - `// eslint-disable-line react-hooks/set-state-in-effect` on localStorage hydration useEffect
  - `<img>` in MaskCanvas.tsx (canvas overlay — intentional)
  - `react/display-name` on forwardRef components
