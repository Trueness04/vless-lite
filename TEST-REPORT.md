# VLESS Lite development test report

| Check | Result |
| --- | --- |
| DIR-869 A1 identity | Official OpenWrt DTS and 25.12.6 image recipe agree on ath79/tiny, QCA9563, SEAMA and a 15,872 KiB firmware region |
| Core build | Go 1.27.0, Linux 32-bit big-endian MIPS soft-float, 21,495,963 raw bytes |
| Core standalone XZ | 4,045,936 bytes. Image SquashFS contribution is pending |
| Native loopback | 12 traffic checks passed on Windows amd64. RAW and XHTTP, each with none, TLS and REALITY, through both SOCKS5 and HTTP |
| TLS validation | Test client verified a pin for an ephemeral localhost certificate |
| REALITY validation | Client and server used an ephemeral X25519 keypair, short ID and local TLS decoy |
| Manager renderer | Imported an XHTTP+REALITY link, generated configuration with DNS and CIDR rules, and Xray accepted it |
| Overlay calculation baseline | Official 25.12.6 sysupgrade image 6,750,491 bytes, SquashFS offset 2,162,688 bytes, SquashFS used 4,573,845 bytes, erase-aligned rootfs_data region 9,502,720 bytes. These values describe the official image |
| LuCI and rpcd | JavaScript syntax passed. Live UI and service integration remain pending |
| GitHub Actions and custom APK/firmware | Pending a destination repository and authenticated push |
| MIPS emulator and physical router | Pending. Router RAM, Wi-Fi, transparent DNS and TCP, management availability, and recovery remain unverified |

MIPS binary SHA256

```
6af1e2636b4dba066b7b80655c6bb315e768a4e33b18b89801f9b2ce92bdcc7e
```

No firmware was flashed.

