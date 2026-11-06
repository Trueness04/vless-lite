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

## MIPS TLS crash disposition

**NON-REPRODUCED** in GitHub Actions run 42191376832. Three runs passed in each cell of the standard versus no-inline compiler and HTTP versus HTTPS harness matrix. Go 1.26.10 and the pinned Xray source were held constant. The prior crypto/x509/pkix SIGSEGV remains an observed failure with unknown cause. The matrix does not establish a fix or substitute for hardware acceptance.

## Gate 0 audit against 299cf61

The review started from `299cf61dea884a50d6c27206a4ddac56afdd7d49`. The public heads were `main` and `engineering/layer-isolation`. The baseline inventory had 35 tracked paths, 38 distinct historical paths and 26 reachable commits. The Gate artifact records the checkout, refs, reachable commits and historical operation-keyword matches for each run.

| Criterion | Evidence and remaining scope |
|---|---|
| 0.1 | Inventoried Git history and tracked files. Reviewed the four current workflow files, the project feed, declared runtime dependencies, SDK and Buildroot pins, Xray pin and build dependency list. A complete transitive dependency audit is open. |
| 0.2 | Reviewed historical operation matches and the current workflows and shell entry points. Matches include SEAMA/sysupgrade artifact handling, keyword-search code and documented hardware instructions. The review identified no project script that invokes a remote router operation. The history scan is discovery evidence and relies on manual classification. |
| 0.3 | Build workflows use GitHub-hosted Ubuntu, local network namespaces or QEMU. The only deploy-like step publishes GitHub release assets on version tags. The repository runner API returned zero self-hosted runners and repository defaults were read-only. GitHub Actions tags are currently accepted without SHA pinning, so action provenance remains open. |
| 0.4 | GitHub repository metadata returned zero Actions secrets, Actions variables, environments, deploy keys and Dependabot secrets. Gitleaks v8.24.3 reported one historical generic-api-key match in `scripts/test-core.sh` at `4f9a575`. The match is the public REALITY key in a test fixture. This evidence covers scanned Git refs and repository metadata. |
| 0.5 | The official 25.12.6 ath79/tiny release profile identifies D-Link DIR-869 A1 and mips_24kc. Gate CI compares the release profile with the checked-out image configuration. |
| 0.6 | The pinned DTS identifies `dlink,dir-869-a1` and includes `qca9563_dlink_dir-8x9-a1.dtsi`. The include contains the partition layout and specifies firmware at `0x070000` with size `0xf80000`. Gate CI records the layout from the pinned source. |
| 0.7 | The issue table above and the reliability register below capture known problems. |
| 0.8 | Gate CI verifies the baseline ancestry and records the checkout commit and tree. |

### Reliability register

| Issue | Disposition and outstanding validation |
|---|---|
| Invalid selected profile overwrites healthy settings | Preflight runs before staging and committing VLESS settings. Browser tests use UCI and RPC doubles. The init test verifies an invalid candidate preserves the prior generated config using the real host Xray binary. |
| Stale or wrong running profile | Ready PID and profile come from the same supervisor record. Actual procd replacement and asynchronous core failures after a successful commit still need a booted OpenWrt integration test. |
| Proxy reachability reported as process readiness | Probe is independent of the running status. Offline proxy and RPC failure presentation are covered in Chrome with mocked ubus. |
| Profile secrecy and RAM | Selected-profile preflight and probe serialize extra core processes. Rendered config files use restrictive modes and validation logs omit raw diagnostics. Live rpcd/ACL, persistent UCI file access and memory under concurrent production traffic need a booted OpenWrt test. |
| MIPS SIGSEGV and physical acceptance | See the matrix above. Hardware Wi-Fi, overlay, fail-open behavior and recovery remain unverified. |
