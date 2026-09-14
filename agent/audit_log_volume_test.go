package main

import (
	"bytes"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestAuditNormalReportsDoNotProducePerFrameLogs(t *testing.T) {
	previous := log.Writer()
	var output bytes.Buffer
	log.SetOutput(&output)
	t.Cleanup(func() { log.SetOutput(previous) })
	for index := 0; index < 1000; index++ {
		logReport("HTTP report accepted", Report{CPU: float64Metric(0)})
	}
	if output.Len() != 0 {
		t.Fatal("default successful reporting wrote a line for every frame")
	}
	log.Print("synthetic failure remains visible")
	if output.Len() == 0 {
		t.Fatal("error diagnostics disappeared with successful frame logging")
	}
}

func TestAuditCollectorLogCLIIsExplicitAndLocal(t *testing.T) {
	t.Setenv("CF_MONITOR_LOG_FILE", filepath.Join(t.TempDir(), "must-not-be-read"))
	_, err := parseDirectoryCollectorOptions([]string{"--disk-usage-collector", "fixture", "--log-file", "/var/log/fixture.log"}, io.Discard)
	if err != nil {
		t.Fatal("local collector rejected an explicit bounded log destination")
	}
	if _, err := parseDirectoryCollectorOptions([]string{"--disk-usage-check", "--log-file", "/var/log/fixture.log"}, io.Discard); err == nil {
		t.Fatal("read-only scope checks must not initialize a log file")
	}
}

func TestAuditVerboseReportsRemainAvailable(t *testing.T) {
	previous, enabled := log.Writer(), verboseLogs
	var output bytes.Buffer
	log.SetOutput(&output)
	verboseLogs = true
	t.Cleanup(func() { log.SetOutput(previous); verboseLogs = enabled })
	logReport("synthetic report", Report{CPU: float64Metric(0)})
	if !strings.Contains(output.String(), "synthetic report") {
		t.Fatal("explicit verbose mode lost report diagnostics")
	}
}

func TestAuditLogRotationBoundsContinuousAndOversizedWrites(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent.log")
	writer, err := newRotatingAgentLog(path, 64, 3, 7*24*time.Hour, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { writer.Close() })
	for index := 0; index < 1000; index++ {
		if _, err := writer.Write([]byte("synthetic failure remains diagnosable\n")); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := writer.Write(bytes.Repeat([]byte("x"), 4096)); err != nil {
		t.Fatal(err)
	}
	if _, err := writer.Write([]byte("latest failure\n")); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	var total int64
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			t.Fatal(err)
		}
		if info.Size() > 64 {
			t.Fatal("an individual log exceeded the configured size")
		}
		total += info.Size()
	}
	if len(entries) > 4 || total > 256 {
		t.Fatal("continuous errors exceeded the total retention budget")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(data, []byte("latest failure")) {
		t.Fatal("rotation lost the most recent failure")
	}
}

func TestAuditLogRotationUsesDatesAndPrunesExpiredBackups(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent.log")
	now := time.Now().UTC().Truncate(24 * time.Hour).Add(12 * time.Hour)
	for _, item := range []struct {
		suffix string
		age    time.Duration
	}{{"", 24 * time.Hour}, {".2", 8 * 24 * time.Hour}} {
		if err := os.WriteFile(path+item.suffix, []byte("earlier failure\n"), 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path+item.suffix, now.Add(-item.age), now.Add(-item.age)); err != nil {
			t.Fatal(err)
		}
	}
	writer, err := newRotatingAgentLog(path, 64, 3, 7*24*time.Hour, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { writer.Close() })
	if _, err := os.Stat(path + ".1"); err != nil {
		t.Fatal("a previous day's log was not rotated")
	}
	if _, err := os.Stat(path + ".3"); !os.IsNotExist(err) {
		t.Fatal("expired backup survived initialization")
	}
	if _, err := writer.Write([]byte("today\n")); err != nil {
		t.Fatal(err)
	}
	now = now.Add(24 * time.Hour)
	if _, err := writer.Write([]byte("tomorrow\n")); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path + ".1")
	if err != nil || string(data) != "today\n" {
		t.Fatal("a date boundary did not retain the preceding day's log")
	}
}
