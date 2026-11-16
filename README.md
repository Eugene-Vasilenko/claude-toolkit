# claude-toolkit

Claude Code marketplace: skills, agents, hooks and other tools. Each plugin is independent, install only what you need.

## Install

```
/plugin marketplace add Eugene-Vasilenko/claude-toolkit
/plugin install <plugin>@claude-toolkit
```

Example: `/plugin install forked-review@claude-toolkit`.

No GitHub SSH key? Set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1`.

## Plugins

| Plugin | What it does |
|---|---|
| [`forked-review`](#forked-review) | Multi-angle code review of a branch or PR: one warm baseline session, an analyze fork that picks the angles, parallel forked passes, a consolidation fork that verifies and merges. Run `/forked-review:review`. |

### forked-review

```
/plugin install forked-review@claude-toolkit
/forked-review:review
```

- Reviews the current branch against its base. Optional: name the angles ("security and correctness only"), a base branch, or include uncommitted changes.
- Angles: architecture, correctness, security, reuse, hygiene, simplicity, root cause. A fork that knows the diff picks 2–5 by the size and kind of the change, or follows your wishes (`/forked-review:review also check security`).
- Your main session stays small: it never reads the diff or the angle reports, it only receives the final report.
- Output: one checklist (BLOCKER > WARNING > NIT), questions for the author, deferred tech debt. Findings are re-checked against the code before they are reported. Nothing is written into your repo.
- Cost: one baseline session, an analyze fork, 2–5 parallel sessions and a consolidation fork, so more than a normal review. The runner prints an estimated cost per step.
- Safety: reviewers run read-only (`dontAsk` mode, allowlist of read-only `git` commands, reads confined to the repo).
- Needs: `git`, Node.js, `claude` CLI. `gh` is optional: it supplies the base branch and the spec (PR text and linked issue). Without it, pass a base branch.
- Runs only when you call it: the skills are marked `disable-model-invocation`, so Claude never starts it by itself.

## Layout

```
.claude-plugin/marketplace.json   # plugin catalog
plugins/<name>/
  .claude-plugin/plugin.json
  skills/<skill>/SKILL.md
```

Check before pushing: `claude plugin validate . --strict`.

## License

MIT
