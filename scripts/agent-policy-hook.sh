#!/usr/bin/env bash
# Repository policy endpoint for the Muse harness. Reads one PreToolUse JSON
# payload on stdin. An allow stays silent with exit 0, a denial prints its
# reason on stdout with exit 0, and a broken invocation prints to stderr and
# exits 2. Only --harness muse is accepted; unknown tool names pass, while
# read, write, edit, and shell inputs referencing a protected .env file are
# denied. The explicitly permitted .env.example stays allowed.
set -euo pipefail
if [[ $# != 2 || $1 != --harness || $2 != muse ]]; then
	printf '%s\n' 'Invalid harness' >&2
	exit 2
fi
payload=$(cat)
if [[ -z $payload ]]; then
	printf '%s\n' 'Empty Muse hook payload.' >&2
	exit 2
fi
tool=$(printf '%s' "$payload" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
if [[ -z $tool ]]; then
	printf '%s\n' 'Invalid Muse hook payload.' >&2
	exit 2
fi
case "$tool" in
read_file | write_file | edit_file | bash)
	hits=$(printf '%s' "$payload" | grep -o '\.env[a-zA-Z0-9_.]*' | sort -u || true)
	for hit in $hits; do
		if [[ $hit == .env.example ]]; then continue; fi
		printf '%s\n' "Muse policy denied ${tool} referencing a .env file."
		exit 0
	done
	;;
esac
exit 0
