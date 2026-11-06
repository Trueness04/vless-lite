#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root=$PWD
version=25.12.6
mode=${1:?specify sdk or firmware}
mkdir -p .build artifacts
case "$mode" in
    sdk)
        url=https://downloads.openwrt.org/releases/$version/targets/ath79/tiny
        mkdir -p .build/sdk
        cd .build/sdk
        curl -fsSLO "$url/sha256sums"
        sdk=$(awk '$2 ~ /^\*openwrt-sdk-.*Linux-x86_64.tar.zst$/ { print substr($2,2) }' sha256sums)
        test -n "$sdk"
        curl -fsSLO "$url/$sdk"
        awk -v name="*$sdk" '$2 == name' sha256sums | sha256sum -c -
        echo "a2a7726c4eb7bc1a3630935eb0cd1165de709daf4f7c10574e44f404e43438db  $sdk" | sha256sum -c -
        tar --zstd -xf "$sdk"
        cd "${sdk%.tar.zst}"
        ;;
    firmware)
        cd .build
        if [[ ! -d openwrt/.git ]]; then
            git clone --depth 1 --branch "v$version" https://github.com/openwrt/openwrt
        fi
        cd openwrt
        test "$(git rev-parse HEAD)" = 64900e756efa667774214f9c6b17c113222e01f7
        grep -Fq 'TARGET_DEVICES += dlink_dir-869-a1' target/linux/ath79/image/tiny.mk
        cp "$root/openwrt/dir-869.config" .vless-config
        ;;
    *) exit 2 ;;
esac
feed="$root/.build/project-feed"
mkdir -p "$feed/vless-lite"
cp -R "$root/openwrt/package/." "$feed/vless-lite/"
install -Dm755 "$root/dist/xray-lite" "$feed/vless-lite/files/usr/bin/xray-lite"
install -Dm644 "$root/dist/Xray-LICENSE" "$feed/vless-lite/files/usr/share/licenses/xray-lite/LICENSE"
cp "$root/openwrt/feeds.conf" feeds.conf
printf 'src-link vlesslite %s\n' "$feed" >> feeds.conf
./scripts/feeds update -a
./scripts/feeds install luci
./scripts/feeds install -p vlesslite vless-lite-core vless-lite-manager
if [[ $mode == sdk ]]; then
    printf '%s\n' CONFIG_PACKAGE_vless-lite-core=m CONFIG_PACKAGE_vless-lite-manager=m >> .config
fi
if [[ $mode == firmware ]]; then mv .vless-config .config; fi; make defconfig
if [[ $mode == sdk ]]; then
    make -C package/feeds/vlesslite/vless-lite TOPDIR="$PWD" SDK=1 V=s compile
    find bin -type f -name 'vless-lite-*.apk' -exec cp {} "$root/artifacts/" \;
    for package in vless-lite-core vless-lite-manager; do
        compgen -G "$root/artifacts/$package-*.apk"
    done
else
    grep -qx CONFIG_TARGET_DEVICE_ath79_tiny_DEVICE_dlink_dir-869-a1=y .config
    grep -qx CONFIG_PACKAGE_vless-lite-core=y .config
    grep -qx CONFIG_PACKAGE_vless-lite-manager=y .config
    grep -qx CONFIG_PACKAGE_luci-app-package-manager=y .config
    make -j"${JOBS:-2}" V=s
    image=$(find bin/targets/ath79/tiny -name '*dir-869-a1*squashfs-sysupgrade.bin' -print -quit)
    test -n "$image"
    node "$root/scripts/flash-budget.mjs" "$image" | tee "$root/artifacts/flash-budget.txt"
    offset=$(sed -n 's/^squashfs_offset_bytes=//p' "$root/artifacts/flash-budget.txt")
    bash "$root/scripts/check-runtime-packages.sh" "$image" "$offset" | tee "$root/artifacts/runtime-packages.txt"
    listing=$(unsquashfs -o "$offset" -ll "$image")
    if grep -Fq squashfs-root/www/moci <<< "$listing"; then exit 1; fi
    for entry in usr/bin/xray-lite usr/libexec/rpcd/vless-lite www/cgi-bin/luci www/luci-static/bootstrap/cascade.css www/luci-static/resources/view/network/wireless.js www/luci-static/resources/view/vless-lite/settings.js; do
        grep -Fq "squashfs-root/$entry" <<< "$listing"
    done
    factory=${image%-sysupgrade.bin}-factory.bin
    test -s "$factory"
    test "$(stat -c %s "$factory")" -le $((15872*1024))
    printf 'factory_bytes=%s\n' "$(stat -c %s "$factory")" >> "$root/artifacts/flash-budget.txt"
    test "$(stat -c %s "$factory")" -le $((12*1024*1024))
    printf '%s\n' "$listing" > "$root/artifacts/rootfs-files.txt"
    cp .config "$root/artifacts/build.config"
    manifest=$(find bin/targets/ath79/tiny -maxdepth 1 -name '*.manifest' -print -quit)
    test -n "$manifest"
    for package in vless-lite-core vless-lite-manager; do
        grep -Eq "^$package[[:space:]]+-[[:space:]]+" "$manifest"
    done
    if grep -Eq '^(git(-[^ ]+)?|golang(-[^ ]+)?|gcc(-[^ ]+)?|gdb(-[^ ]+)?|binutils(-[^ ]+)?|strace|make|cmake|ninja|ccache)[[:space:]]' "$manifest"; then
        echo 'Development tools found in firmware package manifest' >&2
        exit 1
    fi
    if grep -Eq 'squashfs-root/(usr/)?(bin|sbin)/(git|go|gofmt|gcc|g\+\+|gdb|strace|make|cmake|ninja)([[:space:]]|$)' <<< "$listing"; then
        echo 'Development executables found in SquashFS' >&2
        exit 1
    fi
    cp "$manifest" "$root/artifacts/package.manifest"
    cp "$image" "$factory" "$root/artifacts/"
fi
(cd "$root/artifacts" && find . -maxdepth 1 -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
