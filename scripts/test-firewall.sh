#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
firewall=$root/openwrt/package/files/usr/share/vless-lite/firewall
tmp=$(mktemp -d)
suffix=$$
client=vless-client-$suffix
router=vless-router-$suffix
server=vless-server-$suffix
cleanup() {
    for namespace in "$client" "$router" "$server"; do
        ip netns pids "$namespace" 2>/dev/null | xargs -r kill || true
        ip netns del "$namespace" 2>/dev/null || true
    done
    rm -r "$tmp"
}
trap cleanup EXIT
for namespace in "$client" "$router" "$server"; do
    ip netns add "$namespace"
    ip -n "$namespace" link set lo up
done
ip link add vc type veth peer name vr
ip link add vu type veth peer name vs
ip link set vc netns "$client"
ip link set vr netns "$router"
ip link set vu netns "$router"
ip link set vs netns "$server"
ip -n "$router" link set vr name br-lan
ip -n "$client" addr add 192.168.23.2/24 dev vc
ip -n "$router" addr add 192.168.23.1/24 dev br-lan
ip -n "$router" addr add 198.18.0.1/24 dev vu
ip -n "$server" addr add 198.18.0.2/24 dev vs
ip -n "$client" addr add fd00:1::2/64 dev vc nodad
ip -n "$router" addr add fd00:1::1/64 dev br-lan nodad
ip -n "$router" addr add fd00:2::1/64 dev vu nodad
ip -n "$server" addr add fd00:2::2/64 dev vs nodad
ip -n "$client" link set vc up
ip -n "$router" link set br-lan up
ip -n "$router" link set vu up
ip -n "$server" link set vs up
ip -n "$client" route add default via 192.168.23.1
ip -n "$server" route add default via 198.18.0.1
ip -n "$client" -6 route add default via fd00:1::1
ip -n "$server" -6 route add default via fd00:2::1
ip netns exec "$router" sysctl -qw net.ipv4.ip_forward=1 net.ipv6.conf.all.forwarding=1
printf '#!/bin/sh\nexit 1\n' > "$tmp/uci"
chmod +x "$tmp/uci"
cat > "$tmp/listen.py" <<'PY'
import selectors
import socket
import sys

selector = selectors.DefaultSelector()
for spec in sys.argv[1:]:
    transport, address, port, result = spec.split(",")
    sock = socket.socket(socket.AF_INET6 if ":" in address else socket.AF_INET,
                         socket.SOCK_DGRAM if transport == "udp" else socket.SOCK_STREAM)
    sock.bind((address, int(port)))
    if transport == "tcp":
        sock.listen()
    selector.register(sock, selectors.EVENT_READ, (transport, result.encode()))
while True:
    for key, _ in selector.select():
        transport, result = key.data
        if transport == "udp":
            _, peer = key.fileobj.recvfrom(2048)
            key.fileobj.sendto(result, peer)
        else:
            conn, _ = key.fileobj.accept()
            with conn:
                conn.sendall(result)
PY
ip netns exec "$router" python3 "$tmp/listen.py" tcp,0.0.0.0,12345,proxy tcp,0.0.0.0,1053,dns udp,0.0.0.0,1053,dns tcp,192.168.23.1,8080,management &
ip netns exec "$server" python3 "$tmp/listen.py" tcp,198.18.0.2,8080,direct udp,198.18.0.2,8080,direct tcp,fd00:2::2,8080,direct udp,fd00:2::2,53,direct &
sleep 1
ip netns exec "$router" env "PATH=$tmp:$PATH" sh "$firewall" apply
ip netns exec "$client" python3 - <<'PY'
import socket

for protocol, host, port, expected in [
    ("tcp", "198.18.0.2", 8080, b"proxy"),
    ("udp", "198.18.0.2", 8080, b"direct"),
    ("tcp", "198.18.0.2", 53, b"dns"),
    ("udp", "198.18.0.2", 53, b"dns"),
    ("tcp", "fd00:2::2", 8080, b"direct"),
    ("udp", "fd00:2::2", 53, b"direct"),
    ("tcp", "192.168.23.1", 8080, b"management"),
]:
    for _ in range(20):
        with socket.socket(socket.AF_INET6 if ":" in host else socket.AF_INET,
                           socket.SOCK_DGRAM if protocol == "udp" else socket.SOCK_STREAM) as sock:
            sock.settimeout(3)
            sock.connect((host, port))
            if protocol == "udp":
                sock.send(b"test")
            assert sock.recv(128) == expected, (protocol, host, port)
    print(f"{protocol} {host}:{port}: 20 successful requests")
PY
ip netns exec "$router" sh "$firewall" remove
ip netns exec "$client" python3 - <<'PY'
import socket

with socket.create_connection(("198.18.0.2", 8080), 3) as sock:
    assert sock.recv(128) == b"direct"
PY
