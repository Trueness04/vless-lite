#!/bin/sh
# Run on the target while generating representative traffic from a LAN client.
set -eu
samples=${1:-60}
printf 'sample,VmRSS_kB,VmHWM_kB,MemAvailable_kB\n'
i=0
while [ "$i" -lt "$samples" ]; do
	pid=$(pidof xray-lite)
	set -- $pid
	[ "$#" -eq 1 ]
	awk -v i="$i" '
		/^VmRSS:/ { rss=$2 }
		/^VmHWM:/ { hwm=$2 }
		/^MemAvailable:/ { avail=$2 }
		END { if (!rss || !avail) exit 1; print i "," rss "," hwm "," avail }
	' "/proc/$1/status" /proc/meminfo
	i=$((i + 1))
	sleep 1
done

