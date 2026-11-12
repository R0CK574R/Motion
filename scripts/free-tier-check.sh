#!/usr/bin/env bash
# Runs the API and the risk engine under the same limits as Render's free
# instance (0.1 CPU, 512 MB of memory) and measures what a visitor feels:
# how long a cold start takes, how fast the demo answers, and peak memory.
#
#   scripts/free-tier-check.sh
#
# Needs Docker. Prints a Markdown report, and appends it to the GitHub job
# summary when run in Actions. Fails if a container runs out of memory, a
# request fails, or the API is not up within START_TIMEOUT seconds.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CPUS=${CPUS:-0.1}
MEMORY=${MEMORY:-512m}
START_TIMEOUT=${START_TIMEOUT:-600}
HEALTH_PATH=${HEALTH_PATH:-/health}
NET=motion-free-tier
JWT=$(openssl rand -hex 48)

cleanup() {
  docker rm -f motion-api motion-risk motion-db > /dev/null 2>&1 || true
  docker network rm "$NET" > /dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

now() { date +%s.%N; }
since() { awk -v a="$1" -v b="$(now)" 'BEGIN { printf "%.1f", b - a }'; }

# Polls a URL until it answers 2xx; prints the seconds it took.
wait_for() {
  local url=$1 start=$2
  while ! curl -sf --max-time 5 "$url" > /dev/null; do
    if awk -v s="$(since "$start")" -v m="$START_TIMEOUT" 'BEGIN { exit !(s > m) }'; then
      echo "timeout"
      return 1
    fi
    sleep 0.5
  done
  since "$start"
}

# Prints the seconds one request took and its HTTP status.
timed() {
  curl -s -o /tmp/free-tier-body -w '%{time_total} %{http_code}' "$@"
}

peak_mb() {
  docker exec "$1" cat /sys/fs/cgroup/memory.peak 2> /dev/null | awk '{ printf "%.0f", $1 / 1048576 }' || echo "?"
}
oom() { docker inspect -f '{{.State.OOMKilled}}' "$1"; }

echo "Building images..." >&2
docker build -q -t motion-api-check backend > /dev/null
docker build -q -t motion-risk-check risk-engine > /dev/null

docker network create "$NET" > /dev/null
docker run -d --name motion-db --network "$NET" -e POSTGRES_USER=motion -e POSTGRES_PASSWORD=motion \
  -e POSTGRES_DB=motion postgres:16-alpine > /dev/null
until docker exec motion-db pg_isready -U motion -q; do sleep 0.5; done

limits=(--cpus "$CPUS" --memory "$MEMORY" --memory-swap "$MEMORY")

start=$(now)
docker run -d --name motion-risk --network "$NET" "${limits[@]}" -p 8000:8000 motion-risk-check > /dev/null
risk_start=$(wait_for http://localhost:8000/health "$start")

api_env=(-e DATABASE_URL=postgres://motion:motion@motion-db:5432/motion -e JWT_ACCESS_SECRET="$JWT"
  -e RISK_ENGINE_URL=http://motion-risk:8000 -e APP_URL=http://localhost:5173)

start=$(now)
docker run -d --name motion-api --network "$NET" "${limits[@]}" -p 4000:4000 "${api_env[@]}" motion-api-check > /dev/null
api_start=$(wait_for "http://localhost:4000$HEALTH_PATH" "$start") || { docker logs --tail 80 motion-api; exit 1; }

read -r demo_s demo_code < <(timed -X POST http://localhost:4000/api/auth/demo)
TOKEN=$(python3 -c "import json; print(json.load(open('/tmp/free-tier-body'))['accessToken'])")
auth=(-H "Authorization: Bearer $TOKEN")
json=(-H "Content-Type: application/json")
read -r portfolio_s portfolio_code < <(timed "${auth[@]}" http://localhost:4000/api/portfolio)
read -r ledger_s ledger_code < <(timed "${auth[@]}" "http://localhost:4000/api/ledger/transactions?limit=25")
read -r risk_s risk_code < <(timed "${auth[@]}" http://localhost:4000/api/risk)
read -r risk2_s risk2_code < <(timed "${auth[@]}" "http://localhost:4000/api/risk?confidence=0.99&horizon=10")
read -r ask_s ask_code < <(timed "${auth[@]}" "${json[@]}" -d '{"question":"What is my largest position?"}' \
  http://localhost:4000/api/ai/ask)
read -r buy_s buy_code < <(timed "${auth[@]}" "${json[@]}" -d '{"type":"BUY","ticker":"JPM","quantity":1,"price":250}' \
  http://localhost:4000/api/ledger/transactions)

# A few more sign-ins, to see the speed once the JVM has warmed up.
warm=()
for _ in 1 2 3 4 5; do
  read -r seconds _code < <(timed -X POST http://localhost:4000/api/auth/demo)
  warm+=("$seconds")
done
warm_demo=$(printf '%s\n' "${warm[@]}" | sort -n | awk '{ a[NR] = $1 } END { print a[int((NR + 1) / 2)] }')

api_peak=$(peak_mb motion-api)
risk_peak=$(peak_mb motion-risk)
api_oom=$(oom motion-api)
risk_oom=$(oom motion-risk)

# The same API image with no limits, for comparison.
docker rm -f motion-api > /dev/null
start=$(now)
docker run -d --name motion-api --network "$NET" -p 4000:4000 "${api_env[@]}" motion-api-check > /dev/null
api_start_unlimited=$(wait_for "http://localhost:4000$HEALTH_PATH" "$start")

report=$(cat << MD
### Free-tier check ($CPUS CPU, $MEMORY memory)

| Measure | Result |
|---|---|
| API cold start (container start to healthy) | ${api_start} s |
| API cold start with no CPU limit, for comparison | ${api_start_unlimited} s |
| Risk engine cold start | ${risk_start} s |
| First demo sign-in (creates and seeds an account) | ${demo_s} s (HTTP ${demo_code}) |
| Demo sign-in once warm (median of 5) | ${warm_demo} s |
| Portfolio | ${portfolio_s} s (HTTP ${portfolio_code}) |
| Ledger, 25 transactions | ${ledger_s} s (HTTP ${ledger_code}) |
| Risk, first call | ${risk_s} s (HTTP ${risk_code}) |
| Risk, 99% over 10 days | ${risk2_s} s (HTTP ${risk2_code}) |
| Ask (sample answer) | ${ask_s} s (HTTP ${ask_code}) |
| Record a buy | ${buy_s} s (HTTP ${buy_code}) |
| API peak memory | ${api_peak} MB of ${MEMORY} (out of memory: ${api_oom}) |
| Risk engine peak memory | ${risk_peak} MB of ${MEMORY} (out of memory: ${risk_oom}) |
MD
)
echo "$report"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$report" >> "$GITHUB_STEP_SUMMARY"; fi

for code in "$demo_code" "$portfolio_code" "$ledger_code" "$risk_code" "$risk2_code" "$ask_code" "$buy_code"; do
  case "$code" in
    2??) ;;
    *) echo "A request failed (HTTP $code)."; docker logs --tail 60 motion-api; exit 1 ;;
  esac
done
if [ "$api_oom" = "true" ] || [ "$risk_oom" = "true" ]; then
  echo "A container ran out of memory."
  exit 1
fi
