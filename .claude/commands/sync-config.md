Sync the latest shared Claude Code config from the KotaHusky/claude-config repo into the current project.

Run the sync.sh script from the claude-config repo. It does the following:

1. Verify we're inside a git repo
2. Pull CLAUDE.md from KotaHusky/claude-config main branch
3. Recursively pull the entire .claude/ directory (settings.json, commands/, and any other config files) from the repo
4. Use `gh api` to fetch file contents and base64 decode them
5. Show a summary of every file synced
6. Do NOT commit — just sync the files so the user can review with `git diff` before committing

Run this command:
```bash
bash <(gh api repos/KotaHusky/claude-config/contents/sync.sh?ref=main --jq '.content' | base64 -d)
```
