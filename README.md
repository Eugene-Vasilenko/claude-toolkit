# claude-toolkit

Claude Code marketplace: skills, agents, hooks and other tools. Each plugin is independent, install only what you need.

## Install

```
/plugin marketplace add Eugene-Vasilenko/claude-toolkit
/plugin install <plugin>@claude-toolkit
```

No GitHub SSH key? Set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1`.

## Plugins

None yet.

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
