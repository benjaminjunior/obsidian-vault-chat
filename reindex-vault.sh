#!/bin/bash

# Obsidian Vault Re-indexing Script
# This script re-indexes the vault and restarts the service

# Configuration
PROJECT_DIR="/home/bjunior/obsidian-vault-chat"
LOG_DIR="/var/log/obsidian-chat"
LOG_FILE="$LOG_DIR/reindex.log"
SERVICE_NAME="obsidian-chat"

# Create log directory if it doesn't exist
mkdir -p "$LOG_DIR"

# Log function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "=========================================="
log "Starting re-indexing process..."

# Change to project directory
cd "$PROJECT_DIR" || {
    log "ERROR: Could not change to project directory: $PROJECT_DIR"
    exit 1
}

# Run indexing script
log "Running index-vault.js..."
/usr/bin/node scripts/index-vault.js >> "$LOG_FILE" 2>&1

if [ $? -eq 0 ]; then
    log "✅ Re-indexing completed successfully"
    
    # Restart the service to use new index
    log "Restarting $SERVICE_NAME service..."
    sudo systemctl restart "$SERVICE_NAME"
    
    if [ $? -eq 0 ]; then
        log "✅ Service restarted successfully"
    else
        log "❌ ERROR: Failed to restart service"
        exit 1
    fi
else
    log "❌ ERROR: Re-indexing failed"
    exit 1
fi

log "Re-indexing process completed"
log "=========================================="

# Keep only last 30 days of logs
find "$LOG_DIR" -name "*.log" -type f -mtime +30 -delete
