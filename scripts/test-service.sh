#!/usr/bin/env bash
set -euo pipefail
root=$PWD
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/run"
template="$root/openwrt/package/files/etc/vless-lite/config.json"
files=openwrt/package/files
sed -e "s@/var/run/vless-lite@$tmp/run@g" \
    -e "s@/var/lock/vless-lite-check.lock@$tmp/check.lock@g" \
    -e "s@/tmp/vless-lite-validate\.@$tmp/validate.@g" \
    -e "s@/usr/bin/xray-lite@$root/dist/xray-lite-host@g" \
    -e "s@/etc/vless-lite/config.json@$template@g" \
    "$files/etc/init.d/vless-lite" > "$tmp/init"

extra_command() { :; }
config_load() { :; }
uci() { printf 'profile\n'; }
logger() { :; }
config_get() {
    case "$3" in
        active) active=node1 ;;
        link) link=$candidate ;;
        resolver) resolver=1.1.1.1 ;;
        rules) rules= ;;
    esac
}
# Exercise the installed init logic with the real host core, but no system services.
source "$tmp/init"
good='vless://11111111-1111-4111-8111-111111111111@example.test:443?security=tls'
candidate=$good
prepare_config
test "$(stat -c %a "$config")" = 600
cp "$config" "$tmp/expected"
candidate="$good&type=grpc"
if prepare_config; then
    echo 'Unexpected activation of unsupported transport' >&2
    exit 1
fi
cmp "$config" "$tmp/expected"
VLESS_LITE_LINK="$good" validate 1.1.1.1 ''
if VLESS_LITE_LINK="$candidate" validate 1.1.1.1 ''; then
    echo 'Unexpected validation of unsupported transport' >&2
    exit 1
fi
test -z "$(find "$tmp" -name 'validate.*' -o -name 'config.??????')"
cmp "$config" "$tmp/expected"
