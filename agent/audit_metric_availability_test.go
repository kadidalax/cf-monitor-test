package main

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	gnet "github.com/shirou/gopsutil/v3/net"
)

var auditNullableMetrics = []string{"cpu", "ram", "ram_total", "swap", "swap_total", "net_in", "net_out", "net_total_up", "net_total_down"}

func auditMetricJSON(t *testing.T, report Report) map[string]any {
	t.Helper()
	data, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(data, &fields); err != nil {
		t.Fatal(err)
	}
	return fields
}

func TestAuditUnavailableMetricsAreExplicitNull(t *testing.T) {
	fields := auditMetricJSON(t, Report{})
	for _, key := range auditNullableMetrics {
		if value, exists := fields[key]; !exists || value != nil {
			t.Errorf("uncollected %s must be explicit null, got %v", key, value)
		}
	}
}

func TestAuditKnownMetricZerosRemainZero(t *testing.T) {
	var report Report
	if err := json.Unmarshal([]byte(`{"cpu":0,"ram":0,"ram_total":0,"swap":0,"swap_total":0,"net_in":0,"net_out":0,"net_total_up":0,"net_total_down":0}`), &report); err != nil {
		t.Fatal(err)
	}
	fields := auditMetricJSON(t, report)
	for _, key := range auditNullableMetrics {
		if value, ok := fields[key].(float64); !ok || value != 0 {
			t.Errorf("measured zero %s must remain numeric zero", key)
		}
	}
}

func TestAuditContainerUnknownRAMDoesNotBorrowHostProc(t *testing.T) {
	proc := memorySnapshot{ramTotal: 64 << 30, ramUsed: 32 << 30, hasRAM: true}
	got := mergeMemorySnapshot(proc, memorySnapshot{}, true)
	if got.hasRAM || got.ramTotal != 0 || got.ramUsed != 0 {
		t.Fatal("unknown container RAM must not borrow the physical host's totals")
	}
}

func TestAuditUnavailableNetworkDoesNotBecomeIdle(t *testing.T) {
	preparer := &reportPreparer{}
	fields := auditMetricJSON(t, preparer.prepareReportForInterval(Report{}, 10))
	for _, key := range []string{"net_in", "net_out", "net_total_up", "net_total_down"} {
		if fields[key] != nil {
			t.Errorf("failed network sample %s must stay null", key)
		}
	}
}

func TestAuditUnavailableNetworkRecoveryRebuildsBaseline(t *testing.T) {
	preparer := &reportPreparer{}
	makeReport := func(timestamp, bytes int64) Report {
		return Report{Timestamp: timestamp, NetTotalUp: int64Metric(bytes), NetTotalDown: int64Metric(bytes)}
	}
	first := preparer.prepareReportForInterval(makeReport(1000, 1000), 10)
	if first.NetIn != nil || first.MetricErrors["network"] != "warming_up" {
		t.Fatal("first speed needs a baseline")
	}
	preparer.prepareReportForInterval(Report{Timestamp: 11000}, 10)
	recovered := preparer.prepareReportForInterval(makeReport(21000, 500000), 10)
	if recovered.NetIn != nil || recovered.MetricErrors["network"] != "warming_up" {
		t.Fatal("network recovery counted unobserved traffic as a rate")
	}
	next := preparer.prepareReportForInterval(makeReport(31000, 500100), 10)
	if next.NetIn == nil || *next.NetIn != 10 || next.MetricErrors["network"] != "" {
		t.Fatal("network did not recover its measured rate")
	}
}

func TestAuditUnavailableCollectorsPreserveErrorsAndRealZero(t *testing.T) {
	failed := Report{}
	collectNetworkReport(&failed, time.Now(), func(bool) ([]gnet.IOCountersStat, error) { return nil, errors.New("synthetic read failure") })
	applyMemoryReport(&failed, memorySnapshot{}, false)
	applyCPUReport(&failed, hostCPUReport(nil, errors.New("synthetic read failure"), nil))
	fields := auditMetricJSON(t, failed)
	for _, key := range auditNullableMetrics {
		if fields[key] != nil {
			t.Errorf("failed collector %s became numeric", key)
		}
	}
	for _, key := range []string{"cpu", "ram", "swap", "network"} {
		if failed.MetricErrors[key] != "collection_failed" {
			t.Errorf("missing fixed reason for %s", key)
		}
	}
	known := Report{}
	applyMemoryReport(&known, memorySnapshot{hasRAM: true, hasSwap: true}, false)
	if known.RAM == nil || *known.RAM != 0 || known.SwapTotal == nil || *known.SwapTotal != 0 {
		t.Fatal("real zero memory/swap became unavailable")
	}
}
