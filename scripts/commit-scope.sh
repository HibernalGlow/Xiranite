#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/commit-scope.sh [--dry-run] <message> <path> [path...]

Commit only the explicitly listed repository-relative paths. Existing staged
changes outside those paths are preserved and excluded from the commit.
EOF
}

dry_run=false
if [[ ${1:-} == "--dry-run" ]]; then
  dry_run=true
  shift
fi

if (($# < 2)); then
  usage >&2
  exit 2
fi

message=$1
shift
paths=("$@")

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

for path in "${paths[@]}"; do
  if [[ -z "$path" || "$path" == -* || "$path" == /* || "$path" =~ ^[A-Za-z]:[/\\] || "$path" == .. || "$path" == ../* || "$path" == */../* ]]; then
    printf 'Invalid repository-relative path: %s\n' "$path" >&2
    exit 2
  fi
done

if [[ -z $(git status --porcelain=v1 -- "${paths[@]}") ]]; then
  printf 'No changes found in the requested paths.\n' >&2
  exit 1
fi

intent_paths=()
for path in "${paths[@]}"; do
  if ! git ls-files --error-unmatch -- "$path" >/dev/null 2>&1; then
    git add --intent-to-add -- "$path"
    intent_paths+=("$path")
  fi
done

cleanup_intent_paths() {
  if ((${#intent_paths[@]})); then
    git reset --quiet -- "${intent_paths[@]}"
  fi
}
trap cleanup_intent_paths EXIT

git diff --check HEAD -- "${paths[@]}"
if [[ $dry_run == true ]]; then
  printf 'Ready to commit only:\n'
  printf '  %s\n' "${paths[@]}"
  exit 0
fi

git commit --only -m "$message" -- "${paths[@]}"
trap - EXIT
