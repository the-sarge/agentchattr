require_uv() {
    if command -v uv >/dev/null 2>&1; then
        return
    fi
    echo "uv is required but was not found on PATH."
    echo "Install uv, then retry: https://docs.astral.sh/uv/getting-started/installation/"
    exit 1
}
