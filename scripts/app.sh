#!/usr/bin/env bash
# Mnemon in containers: build the images, migrate, start, and say where it runs.
#
#   scripts/app.sh up [--seed] [--yes] [--web-port N] [--db-port N] [--no-build]
#   scripts/app.sh seed [--yes]      load the demo meetings; shows the cost first
#   scripts/app.sh status | logs | down
#
# Host ports come from --web-port/--db-port, else MNEMON_WEB_PORT/MNEMON_DB_PORT, else
# 3000 and 54320. A port something else is using moves to the next free one. API keys
# and settings are read from .env (see .env.example); nothing is printed from it.
set -euo pipefail

cd "$(dirname "$0")/.."
STATE_DIR=.mnemon
GENERATED_ENV=$STATE_DIR/generated.env
LOG=$STATE_DIR/app.log
PORT_TRIES=20
COMPOSE=(docker compose --profile app)

# ---- output ------------------------------------------------------------------------

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m' DIM=$'\033[2m' GREEN=$'\033[32m' YELLOW=$'\033[33m' RED=$'\033[31m'
  CYAN=$'\033[36m' RESET=$'\033[0m'
else
  BOLD='' DIM='' GREEN='' YELLOW='' RED='' CYAN='' RESET=''
fi
ok() { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
fail() {
  printf '%s✗%s %s\n' "$RED" "$RESET" "$*" >&2
  exit 1
}
note() { printf '  %s%s%s\n' "$DIM" "$*" "$RESET"; }

# Runs a command with its output going to the log, showing a spinner on a terminal.
# On failure, shows the end of the log and returns the command's status.
run() {
  local label=$1 status=0
  shift
  mkdir -p "$STATE_DIR"
  printf '\n== %s: %s\n' "$label" "$*" >>"$LOG"
  if [ -t 1 ]; then
    "$@" >>"$LOG" 2>&1 &
    local pid=$! i=0 frames='-\|/'
    while kill -0 "$pid" 2>/dev/null; do
      printf '\r%s%s%s %s' "$CYAN" "${frames:i++%4:1}" "$RESET" "$label"
      sleep 0.15
    done
    printf '\r\033[K'
    wait "$pid" || status=$?
  else
    "$@" >>"$LOG" 2>&1 || status=$?
  fi
  return "$status"
}

show_log_tail() {
  printf '%s' "$DIM" >&2
  tail -n 15 "$LOG" >&2
  printf '%s' "$RESET" >&2
  note "Full log: $LOG"
}

# ---- checks ------------------------------------------------------------------------

require_docker() {
  command -v docker >/dev/null 2>&1 || fail "Docker is not installed: https://docs.docker.com/get-docker/"
  docker info >/dev/null 2>&1 || fail "Docker is not running. Start Docker Desktop (or the daemon) and try again."
  local version major minor
  version=$(docker compose version --short 2>/dev/null) || fail "Docker Compose v2 is needed (docker compose)."
  major=${version%%.*}
  minor=${version#*.}
  minor=${minor%%.*}
  # Optional env files (env_file: required: false) arrived in Compose 2.24.
  if [ "$major" -lt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -lt 24 ]; }; then
    fail "Docker Compose $version is too old; 2.24 or later is needed."
  fi
}

# Whether .env sets this variable to something; the value itself is never read out.
env_has() {
  [ -f .env ] && grep -Eq "^[[:space:]]*(export[[:space:]]+)?$1=[\"']?[^\"'[:space:]]" .env
}

check_env() {
  if [ ! -f .env ]; then
    cp .env.example .env
    warn "Created .env from .env.example. Add your API keys there to ask questions."
  fi
  local missing=''
  for key in MNEMON_ANTHROPIC_API_KEY MNEMON_VOYAGE_API_KEY; do
    env_has "$key" || missing="$missing $key"
  done
  if [ -n "$missing" ]; then
    warn "Not set in .env:$missing. Meetings can be read, but asking and adding need them."
  else
    ok "API keys found in .env"
  fi
}

# The app refuses everyone in production without an access code. Use the shell's or
# .env's; else make one, once, keep it in .mnemon/, and export it, since docker-compose.yml
# takes the shell's value over .env's (an empty MNEMON_ACCESS_CODE= in .env included).
ACCESS_NOTE=''
ensure_access_code() {
  if [ -n "${MNEMON_ACCESS_CODE:-}" ]; then
    ACCESS_NOTE="the MNEMON_ACCESS_CODE set in your shell"
    return
  fi
  if env_has MNEMON_ACCESS_CODE; then
    ACCESS_NOTE="the MNEMON_ACCESS_CODE in .env"
    return
  fi
  if ! grep -q '^MNEMON_ACCESS_CODE=.' "$GENERATED_ENV" 2>/dev/null; then
    local hex
    hex=$(head -c 6 /dev/urandom | od -An -tx1 | tr -d ' \n')
    (umask 077 && printf 'MNEMON_ACCESS_CODE=%s-%s-%s\n' "${hex:0:4}" "${hex:4:4}" "${hex:8:4}" >"$GENERATED_ENV")
  fi
  MNEMON_ACCESS_CODE=$(sed -n 's/^MNEMON_ACCESS_CODE=//p' "$GENERATED_ENV")
  export MNEMON_ACCESS_CODE
  ACCESS_NOTE="$MNEMON_ACCESS_CODE  ${DIM}(generated; set MNEMON_ACCESS_CODE in .env to choose your own)${RESET}"
}

# ---- ports -------------------------------------------------------------------------

port_busy() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 0
  command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

# The first free port from $1, trying PORT_TRIES ports.
free_port() {
  local port=$1 tries=1
  while port_busy "$port"; do
    [ "$tries" -ge "$PORT_TRIES" ] && return 1
    port=$((port + 1))
    tries=$((tries + 1))
  done
  echo "$port"
}

# The host port our running container for this service already publishes, if any.
published_port() {
  "${COMPOSE[@]}" port "$1" "$2" 2>/dev/null | sed -n 's/.*://p' | head -n 1
}

# A host port for a service: the one it already runs on, else the wanted one if free,
# else the next free one.
pick_port() {
  local name=$1 service=$2 inner=$3 wanted=$4 explicit=$5 current chosen
  current=$(published_port "$service" "$inner")
  if [ -n "$current" ] && { [ "$explicit" != 1 ] || [ "$current" = "$wanted" ]; }; then
    echo "$current"
    return
  fi
  chosen=$(free_port "$wanted") ||
    fail "No free port for the $name from $wanted to $((wanted + PORT_TRIES - 1)). Choose one with --${service}-port."
  [ "$chosen" = "$wanted" ] || warn "Port $wanted is in use, so the $name uses $chosen."
  echo "$chosen"
}

# Starts services, moving a port that turns out to be taken (another program can grab
# it between the check and the start) to the next free one, a few times.
start_with_retries() {
  local label=$1
  shift
  local attempt port
  for attempt in 1 2 3 4 5; do
    export MNEMON_WEB_PORT=$WEB_PORT MNEMON_DB_PORT=$DB_PORT
    : >"$STATE_DIR/last-start.log"
    if run "$label" sh -c 's=0; "$@" >"$0" 2>&1 || s=$?; cat "$0"; exit $s' "$STATE_DIR/last-start.log" "$@"; then
      return 0
    fi
    port=$(grep -Eo '127\.0\.0\.1:[0-9]+' "$STATE_DIR/last-start.log" | tail -n 1 | cut -d: -f2 || true)
    if ! grep -Eqi 'already allocated|address already in use|bind' "$STATE_DIR/last-start.log"; then
      break
    elif [ "$port" = "$WEB_PORT" ]; then
      WEB_PORT=$(free_port $((WEB_PORT + 1))) || break
      warn "Port $port was taken while starting; trying the app on $WEB_PORT."
    elif [ "$port" = "$DB_PORT" ]; then
      DB_PORT=$(free_port $((DB_PORT + 1))) || break
      warn "Port $port was taken while starting; trying the database on $DB_PORT."
    else
      break
    fi
  done
  show_log_tail
  fail "$label failed."
}

# ---- commands ----------------------------------------------------------------------

seed() {
  local yes=$1 plan
  plan=$("${COMPOSE[@]}" run --rm --no-deps migrate node apps/cli/src/seed.ts 2>>"$LOG") || {
    show_log_tail
    fail "Could not plan the demo meetings."
  }
  printf '%s\n' "$plan" | sed 's/^/  /'
  if printf '%s' "$plan" | grep -q 'Nothing to do'; then return; fi
  if [ "$yes" != 1 ]; then
    if [ ! -t 0 ]; then
      note "Run scripts/app.sh seed --yes to load them."
      return
    fi
    local answer
    read -r -p "  Load them, at the cost above? [y/N] " answer
    case $answer in
      y | Y | yes) ;;
      *)
        note "Skipped. Load them later with scripts/app.sh seed."
        return
        ;;
    esac
  fi
  "${COMPOSE[@]}" run --rm --no-deps migrate node apps/cli/src/seed.ts --yes 2>>"$LOG" | sed 's/^/  /' || {
    show_log_tail
    fail "Seeding failed."
  }
  ok "Demo meetings loaded"
}

meeting_count() {
  "${COMPOSE[@]}" exec -T db psql -U mnemon -d mnemon -Atc 'select count(*) from meetings' 2>/dev/null || echo '?'
}

up() {
  local do_seed=0 yes=0 build=1 web_explicit=0 db_explicit=0
  WEB_PORT=${MNEMON_WEB_PORT:-3000}
  DB_PORT=${MNEMON_DB_PORT:-54320}
  [ -n "${MNEMON_WEB_PORT:-}" ] && web_explicit=1
  [ -n "${MNEMON_DB_PORT:-}" ] && db_explicit=1
  while [ $# -gt 0 ]; do
    case $1 in
      --seed) do_seed=1 ;;
      --yes) yes=1 ;;
      --no-build) build=0 ;;
      --web-port)
        WEB_PORT=${2:?--web-port needs a number}
        web_explicit=1
        shift
        ;;
      --db-port)
        DB_PORT=${2:?--db-port needs a number}
        db_explicit=1
        shift
        ;;
      *) fail "Unknown option for up: $1 (see scripts/app.sh help)" ;;
    esac
    shift
  done

  printf '\n%sMnemon%s  %slocal containers%s\n\n' "$BOLD" "$RESET" "$DIM" "$RESET"
  require_docker
  ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null), Compose $(docker compose version --short)"
  check_env
  ensure_access_code

  DB_PORT=$(pick_port db db 5432 "$DB_PORT" "$db_explicit")
  WEB_PORT=$(pick_port app web 3000 "$WEB_PORT" "$web_explicit")
  ok "Ports: app $WEB_PORT, database $DB_PORT"

  if [ "$build" = 1 ]; then
    run "Building the images (the first build takes a few minutes)" "${COMPOSE[@]}" build || {
      show_log_tail
      fail "The build failed."
    }
    ok "Images built: mnemon-web, mnemon-tools"
  fi

  start_with_retries "Starting the database" docker compose up -d --wait db
  ok "Database ready on localhost:$DB_PORT"

  local migrated
  migrated=$("${COMPOSE[@]}" run --rm --no-deps migrate 2>>"$LOG") || {
    show_log_tail
    fail "Migrations failed."
  }
  ok "$migrated"

  [ "$do_seed" = 1 ] && seed "$yes"

  start_with_retries "Starting the app" "${COMPOSE[@]}" up -d --wait --no-deps web
  ok "App healthy"

  local meetings
  meetings=$(meeting_count)
  printf '\n%sMnemon is running%s\n' "$BOLD" "$RESET"
  printf '  %-10s %shttp://localhost:%s%s\n' "App" "$CYAN" "$WEB_PORT" "$RESET"
  printf '  %-10s %s\n' "Sign in" "$ACCESS_NOTE"
  printf '  %-10s %s\n' "Meetings" "$meetings stored"
  printf '  %-10s %s\n' "Database" "localhost:$DB_PORT (user mnemon, password mnemon)"
  printf '  %-10s %s\n' "Logs" "scripts/app.sh logs"
  printf '  %-10s %s\n' "Stop" "scripts/app.sh down"
  if [ "$meetings" = 0 ]; then
    printf '\n'
    note "No meetings yet: scripts/app.sh seed loads three synthetic ones (about \$0.07)."
  fi
  printf '\n'
}

usage() {
  sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
}

main() {
  local command=${1:-help}
  [ $# -gt 0 ] && shift
  mkdir -p "$STATE_DIR"
  case $command in
    up) up "$@" ;;
    seed)
      require_docker
      local yes=0
      [ "${1:-}" = --yes ] && yes=1
      docker compose up -d --wait db >>"$LOG" 2>&1 || fail "The database did not start; see $LOG."
      seed "$yes"
      ;;
    status) "${COMPOSE[@]}" ps ;;
    logs) "${COMPOSE[@]}" logs -f web ;;
    down)
      "${COMPOSE[@]}" down
      ok "Stopped. The data is kept in the mnemon-db volume."
      ;;
    help | -h | --help) usage ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
