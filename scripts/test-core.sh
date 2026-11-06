#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
python3 - "$tmp" <<'PY'
import json
import pathlib
import sys
base = json.loads(pathlib.Path("openwrt/package/files/etc/vless-lite/config.json").read_text())
for transport in ("raw", "xhttp"):
    for security in ("none", "tls", "reality"):
        settings = {"network": transport, "security": security}
        if transport == "xhttp":
            settings["xhttpSettings"] = {"path": "/vless", "mode": "auto"}
        if security == "tls":
            settings["tlsSettings"] = {"serverName": "example.com"}
        if security == "reality":
            settings["realitySettings"] = {
                "serverName": "example.com", "fingerprint": "chrome",
                "password": "hSDwCYkwp1R0i33ctD73Wg2_Og0mOBr066SpjqqbTmo", "shortId": "0123456789abcdef",
            }
        base["outbounds"][0]["streamSettings"] = settings
        (pathlib.Path(sys.argv[1]) / f"{transport}-{security}.json").write_text(json.dumps(base))
PY
for config in "$tmp"/*.json; do
    echo "Testing $config"
    dist/xray-lite-host run -test -config "$config"
done
for script in scripts/*.sh openwrt/package/files/etc/init.d/vless-lite openwrt/package/files/usr/share/vless-lite/firewall openwrt/package/files/usr/share/vless-lite/run openwrt/package/files/usr/libexec/rpcd/vless-lite; do
    bash -n "$script"
done
template=openwrt/package/files/etc/vless-lite/config.json
link='vless://11111111-1111-4111-8111-111111111111@203.0.113.1:443?type=xhttp&security=reality&sni=example.com&pbk=hSDwCYkwp1R0i33ctD73Wg2_Og0mOBr066SpjqqbTmo&sid=aa&path=%2Fvless'
VLESS_LITE_LINK="$link" dist/xray-lite-host manager render "$template" 1.1.1.1 'direct 203.0.113.0/24' > "$tmp/manager.json"
dist/xray-lite-host run -test -config "$tmp/manager.json"
if VLESS_LITE_LINK="$link&type=grpc" dist/xray-lite-host manager render "$template" 1.1.1.1 ''; then
    echo 'Unexpected duplicate parameter acceptance' >&2
    exit 1
fi
if VLESS_LITE_LINK="$link" dist/xray-lite-host manager render "$template" 1.1.1.1 'direct invalid'; then
    echo 'Unexpected invalid CIDR acceptance' >&2
    exit 1
fi
domain_link=${link/203.0.113.1/vless.example.com}
VLESS_LITE_LINK="$domain_link" dist/xray-lite-host manager render "$template" 1.1.1.1 '' > "$tmp/domain.json"
python3 -c 'import json,sys; assert json.load(open(sys.argv[1]))["outbounds"][0]["settings"]["vnext"][0]["address"] == "vless.example.com"' "$tmp/domain.json"
dist/xray-lite-host run -test -config "$tmp/domain.json"
if VLESS_LITE_LINK="${link/203.0.113.1/bad..example}" dist/xray-lite-host manager render "$template" 1.1.1.1 ''; then
    echo 'Unexpected invalid DNS hostname acceptance' >&2
    exit 1
fi
file dist/xray-lite

