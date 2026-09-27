#!/usr/bin/env bash
# Double-click (Mac) or run ./start.command (Linux) to start Tin Whistle Scores.
# Sets itself up on the first run.
cd "$(dirname "$0")" || exit 1

if [ ! -x .venv/bin/python ]; then
    echo "Setting up for the first time..."
    PY=""
    for candidate in python3 python; do
        if command -v "$candidate" >/dev/null 2>&1; then PY="$candidate"; break; fi
    done
    if [ -z "$PY" ] || ! "$PY" -m venv .venv; then
        echo
        echo "ERROR: Could not create the Python environment."
        echo "Install Python from https://www.python.org/downloads/ and try again."
        read -r -p "Press Enter to close..."
        exit 1
    fi
fi

.venv/bin/python run.py "$@"
status=$?
if [ $status -ne 0 ]; then
    read -r -p "Press Enter to close..."
fi
exit $status
