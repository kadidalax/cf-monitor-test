package main

import (
	"os"
	"path/filepath"
)

// A harmless native process boundary for generated Windows runners.
func main() {
	root := os.Getenv("CF_AUDIT_LOG_ROOT")
	if root == "" {
		os.Exit(90)
	}
	if err := os.WriteFile(filepath.Join(root, "received-log-path"), []byte(os.Getenv("CF_MONITOR_LOG_FILE")), 0600); err != nil {
		os.Exit(91)
	}
}
