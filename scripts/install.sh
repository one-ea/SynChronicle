#!/bin/sh
set -e

VERSION="${SYNCHRONICLE_VERSION:-${1:-latest}}"

command -v node >/dev/null 2>&1 || { echo "需要 Node.js 24 或更高版本"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "需要 npm"; exit 1; }

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
[ "$NODE_MAJOR" -ge 24 ] || { echo "需要 Node.js 24 或更高版本"; exit 1; }

if [ "$VERSION" = "latest" ] || [ -z "$VERSION" ]; then
	PACKAGE="synchronicle"
else
	case "$VERSION" in
		v*) VERSION=${VERSION#v} ;;
	esac
	PACKAGE="synchronicle@$VERSION"
fi

echo "安装 $PACKAGE"
npm install -g "$PACKAGE"
echo "SynChronicle 安装完成，运行 synchronicle 开始使用"
