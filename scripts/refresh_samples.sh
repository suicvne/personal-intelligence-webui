#!/bin/sh
# Refresh tests/samples from personal-intelligence's test suite (a fake world, never your data), after
# intel's API changed. Expects ../personal-intelligence with its .venv set up.
set -e
here=$(cd "$(dirname "$0")/.." && pwd)
cd "$here/../personal-intelligence"
INTEL_EXPORT_SAMPLES="$here/tests/samples" .venv/bin/python -m pytest tests/test_server.py -k sample
echo "Samples refreshed in tests/samples; run npm test."
