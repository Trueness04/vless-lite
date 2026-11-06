package main

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/xtls/xray-core/common/uuid"
	"github.com/xtls/xray-core/main/commands/base"
)

func init() {
	base.RootCommand.Commands = append(base.RootCommand.Commands, &base.Command{
		UsageLine: "xray manager [arguments]",
		Short:     "render an OpenWrt client configuration or probe its proxy",
		Run: func(_ *base.Command, args []string) {
			if err := manage(args); err != nil {
				fmt.Fprintln(os.Stderr, err)
				os.Exit(1)
			}
		},
	})
}

func manage(args []string) error {
	if len(args) == 1 && args[0] == "probe" {
		return probeProxy()
	}
	if len(args) != 4 || args[0] != "render" {
		return errors.New("expected manager render TEMPLATE DNS RULES or manager probe")
	}
	link := os.Getenv("VLESS_LITE_LINK")
	config, err := renderProfile(args[1], link, args[2], args[3])
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(config)
}

func validEndpoint(host string) bool {
	if ip, err := netip.ParseAddr(host); err == nil {
		return ip.Zone() == ""
	}
	if len(host) == 0 || len(host) > 253 {
		return false
	}
	for _, label := range strings.Split(host, ".") {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, char := range label {
			if !(char >= 'a' && char <= 'z' || char >= '0' && char <= '9' || char == '-') {
				return false
			}
		}
	}
	return true
}

func renderProfile(template, link, resolver, rules string) (map[string]any, error) {
	if len(link) > 4096 || len(rules) > 8192 {
		return nil, errors.New("profile or routing rules exceed their size limit")
	}
	u, err := url.Parse(link)
	if err != nil || u.Scheme != "vless" || u.User == nil || u.Path != "" {
		return nil, errors.New("invalid VLESS link")
	}
	id := u.User.Username()
	_, hasPassword := u.User.Password()
	if _, err = uuid.ParseString(id); err != nil || len(id) != 36 || hasPassword {
		return nil, errors.New("VLESS link requires a UUID")
	}
	host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
	port, portErr := strconv.ParseUint(u.Port(), 10, 16)
	if !validEndpoint(host) || portErr != nil || port == 0 {
		return nil, errors.New("use an IP address or DNS hostname and explicit port")
	}
	dns, err := netip.ParseAddr(resolver)
	if err != nil || !dns.Is4() || !dns.IsGlobalUnicast() {
		return nil, errors.New("DNS requires a unicast IPv4 address")
	}

	q, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return nil, errors.New("invalid VLESS parameters")
	}
	for k, values := range q {
		switch k {
		case "type", "security", "encryption", "flow", "sni", "fp", "pbk", "sid", "spx", "path", "host", "mode", "headerType", "alpn":
		default:
			return nil, fmt.Errorf("unsupported VLESS parameter %q", k)
		}
		if len(values) != 1 {
			return nil, fmt.Errorf("duplicate VLESS parameter %q", k)
		}
	}
	network := q.Get("type")
	switch network {
	case "", "tcp", "raw":
		network = "raw"
	case "xhttp":
	default:
		return nil, errors.New("only RAW and XHTTP are supported")
	}
	security := q.Get("security")
	if security == "" {
		security = "none"
	}
	flow := q.Get("flow")
	if (flow != "" && (flow != "xtls-rprx-vision" || network != "raw" || security == "none")) ||
		(q.Get("encryption") != "" && q.Get("encryption") != "none") ||
		(q.Get("headerType") != "" && q.Get("headerType") != "none") {
		return nil, errors.New("unsupported flow, encryption or header")
	}
	stream := map[string]any{"network": network, "security": security}
	switch security {
	case "none":
	case "tls":
		serverName := q.Get("sni")
		if serverName == "" {
			serverName = host
		}
		settings := map[string]any{"serverName": serverName}
		if fp := q.Get("fp"); fp != "" {
			settings["fingerprint"] = fp
		}
		if alpn := q.Get("alpn"); alpn != "" {
			settings["alpn"] = strings.Split(alpn, ",")
		}
		stream["tlsSettings"] = settings
	case "reality":
		key, keyErr := base64.RawURLEncoding.DecodeString(q.Get("pbk"))
		sid, sidErr := hex.DecodeString(q.Get("sid"))
		if keyErr != nil || len(key) != 32 || sidErr != nil || len(sid) > 8 || q.Get("sni") == "" {
			return nil, errors.New("REALITY requires SNI, a valid public key and a valid short ID")
		}
		fp := q.Get("fp")
		if fp == "" {
			fp = "chrome"
		}
		stream["realitySettings"] = map[string]any{"serverName": q.Get("sni"), "fingerprint": fp,
			"password": q.Get("pbk"), "shortId": q.Get("sid"), "spiderX": q.Get("spx")}
	default:
		return nil, errors.New("unsupported VLESS security")
	}
	if network == "xhttp" {
		mode := q.Get("mode")
		switch mode {
		case "":
			mode = "auto"
		case "auto", "packet-up", "stream-up", "stream-one":
		default:
			return nil, errors.New("unsupported XHTTP mode")
		}
		path := q.Get("path")
		if path == "" {
			path = "/"
		}
		if !strings.HasPrefix(path, "/") {
			return nil, errors.New("XHTTP path must begin with /")
		}
		stream["xhttpSettings"] = map[string]any{"host": q.Get("host"), "path": path, "mode": mode}
	}

	data, err := os.ReadFile(template)
	if err != nil {
		return nil, err
	}
	var config map[string]any
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, err
	}
	inbounds, _ := config["inbounds"].([]any)
	outbounds, _ := config["outbounds"].([]any)
	if len(inbounds) != 4 || len(outbounds) != 3 {
		return nil, errors.New("invalid installed template")
	}
	dnsInbound, _ := inbounds[3].(map[string]any)
	dnsSettings, _ := dnsInbound["settings"].(map[string]any)
	if dnsSettings == nil || dnsInbound["tag"] != "dns" {
		return nil, errors.New("missing DNS inbound")
	}
	dnsSettings["address"] = dns.String()
	outbounds[0] = map[string]any{"tag": "proxy", "protocol": "vless", "streamSettings": stream,
		"settings": map[string]any{"vnext": []any{map[string]any{"address": host, "port": port,
			"users": []any{map[string]any{"id": id, "flow": flow, "encryption": "none"}}}}}}

	entries := []any{map[string]any{"type": "field", "inboundTag": []string{"dns"}, "outboundTag": "proxy"}}
	for n, line := range strings.Split(rules, "\n") {
		words := strings.Fields(line)
		if len(words) == 0 || strings.HasPrefix(words[0], "#") {
			continue
		}
		if len(words) != 2 || (words[0] != "proxy" && words[0] != "direct" && words[0] != "block") {
			return nil, fmt.Errorf("rule %d must contain action and IPv4 CIDR", n+1)
		}
		cidr, err := netip.ParsePrefix(words[1])
		if err != nil || !cidr.Addr().Is4() {
			return nil, fmt.Errorf("rule %d requires an IPv4 CIDR", n+1)
		}
		entries = append(entries, map[string]any{"type": "field", "ip": []string{cidr.Masked().String()}, "outboundTag": words[0]})
	}
	config["routing"] = map[string]any{"domainStrategy": "AsIs", "rules": entries}
	return config, nil
}

func probeProxy() error {
	proxy := &url.URL{Scheme: "http", Host: net.JoinHostPort("127.0.0.1", "1081")}
	transport := &http.Transport{Proxy: http.ProxyURL(proxy), DisableKeepAlives: true}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://www.gstatic.com/generate_204", nil)
	if err != nil {
		return err
	}
	start := time.Now()
	res, err := client.Do(req)
	if err != nil {
		return errors.New("HTTPS probe through the active profile failed")
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		return fmt.Errorf("unexpected probe status %d", res.StatusCode)
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": true, "latency_ms": time.Since(start).Milliseconds()})
}
