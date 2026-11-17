---
name: Morning brief
# cron (min hour day month weekday), @daily, or "every 30m"
schedule: "0 8 * * 1-5"
# prompt | upkeep | shell
type: prompt
# Who runs it; its run log goes to that agent's sessions/
agent: researcher
# prompt only: claude-code or codex, and the profile folder to run in
app: claude-code
profile: ~/.claude_code_profiles/Work
# Optional: working folder, extra CLI arguments, time limit
cwd: ~/Projects
args: --permission-mode acceptEdits
timeout: 20m
# Run once after a missed time (e.g. the Mac was asleep)
catch_up: true
enabled: false
# upkeep only: sync | distill | digest
# job: sync
---

Read yesterday's sessions in the shared brain and anything new in the inbox,
then write a short brief of what needs attention today and log it with
brain_log (kind: session).
