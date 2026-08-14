# shellcheck shell=bash
#
# Shared helpers for the Claudezilla installers.
#
# install-macos.sh and install-linux.sh differ only in their platform paths and
# the extra Linux steps (headless profile, systemd unit); the host wrapper,
# native manifest, and MCP dependency install were duplicated line-for-line.
# They live here so a change to any of them happens once.

# Resolve an absolute node path. GUI-launched Firefox does not inherit the
# user's shell PATH, so the wrapper cannot rely on PATH lookup at launch.
clz_require_node() {
    local node
    node="$(command -v node 2>/dev/null)"
    if [ -z "$node" ]; then
        echo "Error: node not found in PATH. Please install Node.js first." >&2
        return 1
    fi
    printf '%s\n' "$node"
}

# clz_write_wrapper <wrapper-path> <entry-path> <node-path>
#
# Writes the launcher that Firefox executes, with an absolute node path so it
# works even when Firefox's PATH lacks /opt/homebrew/bin or ~/.nvm.
clz_write_wrapper() {
    local wrapper_path="$1" entry_path="$2" node_path="$3"

    cat > "$wrapper_path" << WRAPPER_EOF
#!/bin/bash
exec "$node_path" "$entry_path" "\$@"
WRAPPER_EOF
    chmod 755 "$wrapper_path"
}

# clz_write_manifest <native-hosts-dir> <wrapper-path>
#
# Writes the native messaging manifest into a browser's hosts directory.
# SECURITY: manifest permissions are set explicitly.
clz_write_manifest() {
    local hosts_dir="$1" wrapper_path="$2"

    mkdir -p "$hosts_dir"
    cat > "$hosts_dir/claudezilla.json" << MANIFEST_EOF
{
  "name": "claudezilla",
  "description": "Claude Code Firefox browser automation bridge",
  "path": "$wrapper_path",
  "type": "stdio",
  "allowed_extensions": ["claudezilla@boot.industries"]
}
MANIFEST_EOF
    chmod 644 "$hosts_dir/claudezilla.json"
}

# clz_install_mcp_deps <mcp-dir>
clz_install_mcp_deps() {
    local mcp_dir="$1"

    if ! command -v npm >/dev/null 2>&1; then
        echo "Error: npm not found. Please install Node.js and npm first." >&2
        return 1
    fi
    echo "Installing MCP dependencies..."
    (cd "$mcp_dir" && npm install --quiet --ignore-scripts)
}
