package main

import (
	"encoding/pem"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestAuditHTTPSDownloadNeverFollowsHTTPRedirect(t *testing.T) {
	sh, err := exec.LookPath("sh")
	if err != nil {
		t.Skip("a POSIX shell is required")
	}
	curl, err := exec.LookPath("curl")
	if err != nil {
		t.Skip("curl is required")
	}
	var insecureRequests atomic.Int32
	insecure := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		insecureRequests.Add(1)
		w.Write([]byte("must not be downloaded"))
	}))
	defer insecure.Close()
	secure := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/redirect" {
			http.Redirect(w, r, insecure.URL, http.StatusFound)
			return
		}
		w.Write([]byte("verified local TLS download"))
	}))
	defer secure.Close()
	_, port, err := net.SplitHostPort(strings.TrimPrefix(secure.URL, "https://"))
	if err != nil || len(secure.Certificate().DNSNames) == 0 {
		t.Fatal("local TLS fixture has no DNS identity")
	}
	host := secure.Certificate().DNSNames[0]
	secureURL := "https://" + net.JoinHostPort(host, port)
	root := t.TempDir()
	certificate := filepath.Join(root, "public-ca.pem")
	// Only the public certificate is written. The ephemeral test TLS key stays
	// inside httptest memory and no external requests or credentials are used.
	if err := os.WriteFile(certificate, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: secure.Certificate().Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	quote := func(value string) string {
		return "'" + strings.ReplaceAll(filepath.ToSlash(value), "'", "'\\''") + "'"
	}
	source, err := os.ReadFile("install.sh")
	if err != nil {
		t.Fatal(err)
	}
	definitions, _, found := strings.Cut(string(source), "while [ \"$#\" -gt 0 ]; do")
	if !found {
		t.Fatal("installer definition boundary is missing")
	}
	output := filepath.Join(root, "download")
	for _, endpoint := range []string{"/ok", "/redirect"} {
		script := definitions + "\nDRY_RUN=0; PROXY=''\ncurl() { " + quote(curl) + " --cacert " + quote(certificate) + " --resolve " + quote(host+":"+port+":127.0.0.1") + " --noproxy '*' \"$@\"; }\ndownload_file " + quote(secureURL+endpoint) + " " + quote(output) + "\n"
		path := filepath.Join(root, "download.sh")
		if err := os.WriteFile(path, []byte(script), 0600); err != nil {
			t.Fatal(err)
		}
		command := exec.Command(sh, filepath.ToSlash(path))
		command.Env = append(os.Environ(), "HTTP_PROXY=", "HTTPS_PROXY=", "ALL_PROXY=", "NO_PROXY=*")
		diagnostic, err := command.CombinedOutput()
		if endpoint == "/ok" {
			if err != nil {
				t.Fatalf("the trusted local HTTPS control download failed: %s", diagnostic)
			}
			data, err := os.ReadFile(output)
			if err != nil || string(data) != "verified local TLS download" {
				t.Fatal("HTTPS control body was not downloaded")
			}
		} else if err == nil || insecureRequests.Load() != 0 {
			t.Fatal("the real installer downloader followed a TLS-to-HTTP redirect")
		}
	}
}
