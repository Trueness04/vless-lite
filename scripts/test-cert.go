package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"log"
	"math/big"
	"os"
	"time"
)

func main() {
	if len(os.Args) != 3 {
		log.Fatal("expected certificate and key paths")
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		log.Fatal(err)
	}
	now := time.Now()
	cert := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "localhost"},
		DNSNames: []string{"localhost"}, NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, cert, cert, key.Public(), key)
	if err != nil {
		log.Fatal(err)
	}
	pk, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		log.Fatal(err)
	}
	for _, file := range []struct {
		path, kind string
		data       []byte
	}{{os.Args[1], "CERTIFICATE", der}, {os.Args[2], "PRIVATE KEY", pk}} {
		if err := os.WriteFile(file.path, pem.EncodeToMemory(&pem.Block{Type: file.kind, Bytes: file.data}), 0600); err != nil {
			log.Fatal(err)
		}
	}
}
