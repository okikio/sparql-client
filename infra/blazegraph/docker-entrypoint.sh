#!/usr/bin/env bash
set -Eeuo pipefail

# Blazegraph Docker Entrypoint
# Initializes database from seed data on first run, then starts Blazegraph server

readonly SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"
readonly DATA_DIR="/var/lib/blazegraph/data"
readonly SEED_DIR="/var/lib/blazegraph/seed"
readonly JOURNAL_FILE="${DATA_DIR}/blazegraph.jnl"
readonly SEED_JOURNAL="${SEED_DIR}/blazegraph.jnl"
readonly BLAZEGRAPH_JAR="/opt/blazegraph.jar"
readonly BLAZEGRAPH_USER="blazegraph"
readonly BLAZEGRAPH_UID=999
readonly BLAZEGRAPH_GID=999

# Logging functions
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] [INFO] $*" >&2
}

log_error() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] [ERROR] $*" >&2
}

log_warn() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] [WARN] $*" >&2
}

# Error handler
error_exit() {
    log_error "$1"
    exit "${2:-1}"
}

# Validate environment
validate_environment() {
    if [[ ! -f "${BLAZEGRAPH_JAR}" ]]; then
        error_exit "Blazegraph JAR not found at ${BLAZEGRAPH_JAR}" 2
    fi

    if [[ ! -d "${DATA_DIR}" ]]; then
        error_exit "Data directory not found at ${DATA_DIR}" 2
    fi
}

# Fix permissions on data directory for volume mounts
fix_permissions() {
    local data_owner
    data_owner=$(stat -c '%u:%g' "${DATA_DIR}" 2>/dev/null || echo "unknown")
    
    if [[ "${data_owner}" != "${BLAZEGRAPH_UID}:${BLAZEGRAPH_GID}" ]]; then
        log "Fixing data directory permissions (current owner: ${data_owner})"
        chown -R "${BLAZEGRAPH_UID}:${BLAZEGRAPH_GID}" "${DATA_DIR}"
    fi
}

# Initialize database from seed if needed
initialize_database() {
    if [[ -f "${JOURNAL_FILE}" ]]; then
        log "Using existing database"
        local journal_size
        journal_size=$(du -h "${JOURNAL_FILE}" 2>/dev/null | cut -f1 || echo "unknown")
        log "Database size: ${journal_size}"
        return 0
    fi

    log "First run detected - initializing database from seed"

    if [[ ! -f "${SEED_JOURNAL}" ]]; then
        log_warn "Seed journal not found at ${SEED_JOURNAL}"
        log "Starting with empty database"
        return 0
    fi

    log "Copying pre-seeded journal file"
    if ! cp "${SEED_JOURNAL}" "${JOURNAL_FILE}"; then
        error_exit "Failed to copy seed journal to data directory" 1
    fi

    chown "${BLAZEGRAPH_UID}:${BLAZEGRAPH_GID}" "${JOURNAL_FILE}"

    local journal_size
    journal_size=$(du -h "${JOURNAL_FILE}" 2>/dev/null | cut -f1 || echo "unknown")
    log "Database initialized successfully (size: ${journal_size})"
}

# Signal handlers
handle_signal() {
    local signal=$1
    log "Received ${signal} signal, shutting down gracefully"
    exit 0
}

# Main entrypoint logic
main() {
    trap 'handle_signal SIGTERM' SIGTERM
    trap 'handle_signal SIGINT' SIGINT

    log "Starting ${SCRIPT_NAME}"
    
    validate_environment
    
    # Fix permissions if running as root (handles volume mounts)
    if [[ "$(id -u)" == "0" ]]; then
        fix_permissions
        initialize_database
        
        log "Launching Blazegraph server as user ${BLAZEGRAPH_USER}"
        
        # Drop to blazegraph user and exec Java process
        # shellcheck disable=SC2086
        exec su-exec "${BLAZEGRAPH_USER}" java ${JAVA_OPTS:-} -server -jar "${BLAZEGRAPH_JAR}"
    else
        # Already running as blazegraph user
        initialize_database
        
        log "Launching Blazegraph server"
        
        # shellcheck disable=SC2086
        exec java ${JAVA_OPTS:-} -server -jar "${BLAZEGRAPH_JAR}"
    fi
}

# Run main function
main "$@"