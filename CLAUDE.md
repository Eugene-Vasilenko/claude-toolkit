# claude-toolkit

Public Claude Code marketplace: skills, agents, hooks. Each plugin is independent.

## Layout

```
.claude-plugin/marketplace.json   # plugin catalog
plugins/<name>/
  .claude-plugin/plugin.json
  skills/<skill>/SKILL.md
```

Every new plugin must be added to `plugins` in `marketplace.json`.

## Rules

- Everything in this repo is in English: code, docs, skills, commit messages, PR text.
- Skills are generic: no ties to a specific project or company.
- `description` in SKILL.md is at most 1024 characters.
- Before committing: `claude plugin validate .` (the "No version specified" warning is expected: plugins omit `version` so the commit SHA is the version).
- Temporary files go to `/tmp` only.
- Do not commit or push without an explicit request.
