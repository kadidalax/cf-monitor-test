package main

import (
	"context"
	"strings"
	"testing"
)

func TestAuditServerURLRejectsUserinfoWithoutEcho(t *testing.T) {
	// Synthetic sentinels only. Never print the input or returned error.
	for _, raw := range []string{
		"https://audit-user:audit-secret@example.invalid/base",
		"https://audit-user@example.invalid/base",
		"https://audit-user:audit-secret@example.invalid/%broken",
	} {
		if _, err := normalizeServerURL(raw); err == nil {
			t.Error("server URL containing userinfo was accepted")
		} else if strings.Contains(err.Error(), "audit-user") || strings.Contains(err.Error(), "audit-secret") {
			t.Error("invalid server URL error echoed userinfo")
		}
	}
}

func TestAuditServerURLLogLabelsOmitSensitiveComponents(t *testing.T) {
	for _, raw := range []string{
		"https://audit-user:audit-secret@example.invalid/private-audit-path?auth=audit-query#secret-fragment",
		"https://example.invalid/private-audit-path?auth=audit-query",
		"https://audit-user:audit-secret@example.invalid/%broken",
	} {
		label := redactURLSecret(raw, "auth")
		for _, marker := range []string{"audit-user", "audit-secret", "private-audit-path", "audit-query", "secret-fragment"} {
			if strings.Contains(label, marker) {
				t.Error("URL log label retained a sensitive component")
			}
		}
	}
}

func TestAuditServerURLWebSocketErrorsAreSanitized(t *testing.T) {
	for _, raw := range []string{"https://audit-user:audit-secret@example.invalid/", "https://example.invalid/%audit-secret"} {
		if _, err := webSocketEndpoint(raw, ""); err == nil {
			t.Error("invalid websocket server URL was accepted")
		} else if strings.Contains(err.Error(), "audit-secret") {
			t.Error("websocket URL error echoed an input component")
		}
	}
}

func TestAuditServerURLRequestErrorDoesNotEchoPath(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	// A cancelled context prevents any network access, including loopback.
	err := postJSONWithContext(ctx, "http://127.0.0.1/private-audit-path?auth=audit-query", map[string]string{}, "")
	if err == nil {
		t.Fatal("cancelled request unexpectedly succeeded")
	}
	if strings.Contains(err.Error(), "private-audit-path") || strings.Contains(err.Error(), "audit-query") {
		t.Fatal("request error available to log retained URL path or query")
	}
}
