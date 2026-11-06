#!/usr/bin/env bash
set -euo pipefail

image=${1:?sysupgrade image required}
offset=${2:?SquashFS offset required}

unsquashfs -o "$offset" -cat "$image" lib/apk/db/installed |
    awk '
        BEGIN { RS = ""; FS = "\n" }
        {
            package = directory = architecture = ""
            owns_core = 0
            for (i = 1; i <= NF; i++) {
                if ($i ~ /^P:/) package = substr($i, 3)
                if ($i ~ /^A:/) architecture = substr($i, 3)
                if ($i ~ /^F:/) directory = substr($i, 3)
                if (directory == "usr/bin" && $i == "R:xray-lite") owns_core = 1
            }
            if (package == "vless-lite-core" && architecture == "mips_24kc" && owns_core)
                core = 1
            if (package == "vless-lite-manager")
                manager = 1
        }
        END {
            printf "core_owns_usr_bin_xray_lite=%d\nmanager_registered=%d\n", core, manager
            exit !(core && manager)
        }
    '
