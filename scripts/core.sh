#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root=$PWD
mkdir -p .build dist
src=$root/.build/xray
if [[ ! -d $src/.git ]]; then
    git clone --depth 1 --branch v26.6.1 https://github.com/XTLS/Xray-core "$src"
fi
cd "$src"
test "$(git rev-parse HEAD)" = 94ffd50060f1cfd5d7482ec90a23a92bdefdff68
if git apply --check "$root/core/lite.patch"; then
    git apply "$root/core/lite.patch"
else
    git apply --reverse --check "$root/core/lite.patch"
fi
cp "$root/core/manager.go" main/vless_manager.go
export CGO_ENABLED=0
flags=(-trimpath -buildvcs=false '-ldflags=-s -w -buildid= -checklinkname=0')
GOOS=linux GOARCH=mips GOMIPS=softfloat go list -deps ./main > "$root/dist/dependencies.txt"
if grep -E 'google.golang.org/grpc|/proxy/(vmess|trojan|shadowsocks[^/]*|wireguard|hysteria|tun)(/|$)|/transport/internet/(grpc|kcp)(/|$)' "$root/dist/dependencies.txt"; then
    exit 1
fi
go build "${flags[@]}" -o "$root/dist/xray-lite-host" ./main
GOOS=linux GOARCH=mips GOMIPS=softfloat go build "${flags[@]}" -o "$root/dist/xray-lite" ./main
cp LICENSE "$root/dist/Xray-LICENSE"
wc -c "$root/dist/xray-lite"

