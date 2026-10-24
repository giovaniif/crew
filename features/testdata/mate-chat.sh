p=$PPID
sid=
while [ -z "$sid" ] && [ "$p" -gt 1 ]; do
	sid=$(ps -o args= -p "$p" | sed -n 's/.*--session-id \([^ ]*\).*/\1/p')
	p=$(ps -o ppid= -p "$p" | tr -d ' ')
done
dir="$CLAUDE_CONFIG_DIR/projects/$(printf '%s' "$PWD" | sed 's/[^A-Za-z0-9]/-/g')"
mkdir -p "$dir"
t="$dir/$sid.jsonl"
hook() { printf '{"session_id":"%s"}' "$sid" | crew hook --harness claude --event "$1"; }
hook SessionStart
hook Stop
n=0
while IFS= read -r msg </dev/tty; do
	n=$((n + 1))
	at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
	printf '{"type":"user","uuid":"u%s","promptId":"p%s","timestamp":"%s","message":{"content":"%s"}}\n' "$n" "$n" "$at" "$msg" >>"$t"
	sleep 1
	printf '{"type":"assistant","uuid":"a%s","timestamp":"%s","message":{"content":[{"type":"text","text":"TEST reply: %s"}]}}\n' "$n" "$at" "$msg" >>"$t"
	hook Stop
done
