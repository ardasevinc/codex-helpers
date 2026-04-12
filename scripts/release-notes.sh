#!/bin/sh
set -eu

REPO="ardasevinc/codex-helpers"
PACKAGE="${1:?Usage: release-notes.sh <package> <version>}"
VERSION="${2:?Usage: release-notes.sh <package> <version>}"
TAG="${PACKAGE}-v${VERSION}"
BASE_URL="https://github.com/${REPO}/releases/download/${TAG}"

cat <<EOF
## Install

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | sh -s -- ${PACKAGE}
\`\`\`

## Update

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | sh -s -- ${PACKAGE} ${VERSION}
\`\`\`

## Direct Downloads

- ${PACKAGE}-darwin-arm64: ${BASE_URL}/${PACKAGE}-darwin-arm64
- ${PACKAGE}-darwin-x64: ${BASE_URL}/${PACKAGE}-darwin-x64
- ${PACKAGE}-linux-arm64: ${BASE_URL}/${PACKAGE}-linux-arm64
- ${PACKAGE}-linux-x64: ${BASE_URL}/${PACKAGE}-linux-x64
EOF

if [ ! -t 0 ]; then
  printf '\n## Changes\n\n'
  cat
fi
