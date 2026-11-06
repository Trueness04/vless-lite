# Recovery evidence

Target is OpenWrt 25.12.6, ath79/tiny, dlink_dir-869-a1, mips_24kc. The firmware partition is 0xf80000 bytes at offset 0x070000. See the official [release profile](https://downloads.openwrt.org/releases/25.12.6/targets/ath79/tiny/profiles.json) and [board DTS](https://github.com/openwrt/openwrt/blob/v25.12.6/target/linux/ath79/dts/qca9563_dlink_dir-869-a1.dts).

| Issue | Origin | Change | Evidence and limitation |
|---|---|---|---|
| MoCI landing page and split interface | Project image overlay and addon | 7029a2a removes MoCI and builds standard LuCI with package management | RootFS audit in Buildroot. Live routes and screenshots pending |
| Broad LAN forwarding block | Project nftables interception | 0725b57 preserves general forwarding and removes redirects when the supervised core exits | Linux namespace test verifies redirects and direct forwarding. Wi-Fi and real client capture pending |
| Hostname imports rejected | Project manager parser | bb23ce5 accepts DNS names and IPs | Core config tests. Sustained service tests pending |
| Reboots, WAN6, radio and DNS rebind | Unattributed | Preserve upstream network and radio defaults | NOT TESTED on this image. No evidence yet separates board, OpenWrt, MoCI and workload effects |
| Full panel, subscriptions and signed feed | Incomplete implementation | Release remains gated | NOT TESTED |
| Hardware stability, flash and rollback | Requires separate owner approval | No automated device deployment | BLOCKED |

Namespace interception covers IPv4 TCP and IPv4 port 53 TCP and UDP. IPv6 and other UDP remain direct. Application DoH, IPv6 DNS and router-originated bootstrap resolution are outside the IPv4 interception policy. Existing conntrack entries can retain their NAT binding after rule removal. Hardware acceptance must exercise new and existing connections separately.

For approved hardware work, use a wired LAN client, verify the image SHA256 and model, save the configuration through standard LuCI, and validate the image with the built-in upgrade test. Record boot IDs, uptime, netifd and kernel logs, per-radio connectivity, MemAvailable, RSS and packet captures. Keep the official board-specific recovery image available and consult the [OpenWrt device recovery instructions](https://openwrt.org/toh/d-link/dir-869). Firmware builds and artifacts are candidates until all mandatory gates pass.

Buildroot registers the commit-local vlesslite feed and selects Core and Manager as built-in packages. The Manager APK includes the LuCI view. SDK outputs remain separate for distribution. The firmware check reads the APK database from SquashFS and requires vless-lite-core (mips_24kc) to own usr/bin/xray-lite. The manifest and RootFS listing are checked for development tools.

After an independently approved boot, collect the following using the device console. The overlay file should be absent and available space must be at least 2048 KiB. Activate a test profile through LuCI only during the approved test and record the core RSS under load.

    apk info -L vless-lite-core
    ls -lh /rom/usr/bin/xray-lite
    ls -lh /overlay/upper/usr/bin/xray-lite
    df -k /overlay
    ubus call vless-lite status

The RootFS data region in the build report is a calculated partition capacity. Actual free space and core RAM usage require a booted device.
