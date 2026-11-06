# VLESS Lite for D-Link DIR-869 A1

Development build for `ath79/tiny`, board `dlink,dir-869-a1`, and package architecture `mips_24kc`. The official board definition uses QCA9563, SEAMA packaging, 16 MiB flash and 64 MiB RAM. The build pins OpenWrt 25.12.6 because the required APK manager was introduced in 25.12. OpenWrt 24.10.8 uses opkg.

| SPI region | Start | Length |
| --- | ---: | ---: |
| bootloader | 0x000000 | 0x040000 |
| bdcfg | 0x040000 | 0x010000 |
| devdata | 0x050000 | 0x010000 |
| devconf | 0x060000 | 0x010000 |
| firmware | 0x070000 | 0xf80000 |
| art | 0xff0000 | 0x010000 |

[Hardware table](https://openwrt.org/toh/hwdata/d-link/d-link_dir-869_a1) · [Image definition](https://github.com/openwrt/openwrt/blob/v25.12.6/target/linux/ath79/image/tiny.mk) · [Board DTS](https://github.com/openwrt/openwrt/blob/v25.12.6/target/linux/ath79/dts/qca9563_dlink_dir-869-a1.dts) · [Partition DTSI](https://github.com/openwrt/openwrt/blob/v25.12.6/target/linux/ath79/dts/qca9563_dlink_dir-8x9-a1.dtsi) · [Images and SDK](https://downloads.openwrt.org/releases/25.12.6/targets/ath79/tiny/)

## Components

- **VLESS Lite Core** uses the official Xray v26.6.1 source with a compile-time patch. It includes the profile renderer and HTTPS probe commands so the target does not need another standalone Go binary.
- **VLESS Lite Manager** is an independent OpenWrt package with a LuCI view, UCI profile storage, authenticated rpcd methods, procd and nftables integration.
- **Firmware** includes both packages, standard LuCI Bootstrap and the upstream Ethernet, Wi-Fi and firewall packages. The VLESS Lite controls are under LuCI → Services at `/cgi-bin/luci/`.

The production dependency check rejects VMess, Trojan, Shadowsocks, gRPC, KCP and other removed packages. XHTTP uses shared upstream QUIC, browser-dialer and congestion-control code. [Official Xray source](https://github.com/XTLS/Xray-core/tree/v26.6.1) · [MoCI](https://github.com/HudsonGraeme/moci#features)

## Using the manager

1. Open LuCI and add a server profile with a name and a VLESS share link. Save profiles and settings.
2. Select that profile. Set a resolver IPv4 address and any routing rules. Use **Save and connect** to validate and activate it. **Connect at boot** is optional.
3. Use **Test active connection** for an HTTPS request through the running proxy. It reports elapsed request time, including handshake time. **Refresh status and logs** reports the running profile, PID, RSS, system available RAM and recent service messages.
4. **Disconnect** stops the service and removes interception.

Use an IP address or DNS hostname and an explicit port. Use the provider's SNI for TLS and REALITY. XHTTP extra JSON and custom certificate pinning in share links are outside the current importer. TLS verifies certificates. Runtime JSON lives in `/var/run/vless-lite` and is readable by root. UCI saves the profiles and policies.

The default outbound is VLESS. Routing rules accept one action and IPv4 CIDR per line, such as `block 203.0.113.0/24`, with first match winning. DNS is forced through the VLESS outbound ahead of custom rules. The interception policy applies to the stock `br-lan` bridge. It intercepts IPv4 TCP and port 53 DNS over TCP and UDP, while IPv6 and non-DNS UDP remain direct. Router-originated traffic and other bridges are outside this policy. LAN-local traffic and management stay reachable. Flow offloading must be disabled.

## Build and release

Run on GitHub Actions or an x86-64 Linux filesystem with Go 1.26.10, Node.js and the packages listed in the workflow. Docker is optional.

```sh
bash scripts/core.sh
bash scripts/test-core.sh
node scripts/loopback.mjs
VLESS_TEST_EMULATOR=qemu-mips node scripts/loopback.mjs ./dist/xray-lite
JOBS=4 bash scripts/openwrt.sh sdk
JOBS=4 bash scripts/openwrt.sh firmware
```

The SDK job emits core and manager APKs. The Buildroot job places the core in SquashFS. The standalone core APK needs at least 26 MiB writable space at installation, so the DIR-869 A1 uses the built-in core. The firmware job checks the actual SEAMA sysupgrade image against the 12 MiB target, finds the SquashFS superblock, calculates the erase-aligned rootfs_data region, and checks that the expected LuCI files are present and MoCI is absent. Real usable Overlay is measured on the running device with `df -k /overlay`.

A successful tag workflow publishes an experimental prerelease with checksums. The workflow's emulated MIPS tests exercise the core and do not establish Wi-Fi or memory stability on the physical router.

## Status

The current MIPS build is 21,495,963 bytes raw and 4,045,936 bytes as standalone XZ. Windows loopback tests passed actual TLS and REALITY handshakes over both RAW and XHTTP. See the accompanying test report for the exact results and remaining checks.

The custom APKs, firmware images, physical RAM measurements and hardware acceptance tests are pending. Do not flash without explicit approval. After approval and image validation, exercise Ethernet and both Wi-Fi bands, the management UI, DNS interception, restart and recovery. Collect process RSS, peak RSS and system MemAvailable under load with `scripts/sample-ram.sh`.

