package main

import (
	"fmt"
	"time"

	gnet "github.com/shirou/gopsutil/v3/net"
)

func int64Metric(value int64) *int64       { return &value }
func float64Metric(value float64) *float64 { return &value }

func (r *Report) setMetricError(metric, reason string) {
	if r.MetricErrors == nil {
		r.MetricErrors = make(map[string]string)
	}
	r.MetricErrors[metric] = reason
}

func applyMemoryReport(report *Report, memory memorySnapshot, containerized bool) {
	reason := "collection_failed"
	if containerized {
		reason = "container_scope_unavailable"
	}
	if memory.hasRAM {
		report.RAM, report.RAMTotal = int64Metric(int64(memory.ramUsed)), int64Metric(int64(memory.ramTotal))
	} else {
		report.RAM, report.RAMTotal = nil, nil
		report.setMetricError("ram", reason)
	}
	if memory.hasSwap {
		report.Swap, report.SwapTotal = int64Metric(int64(memory.swapUsed)), int64Metric(int64(memory.swapTotal))
	} else {
		report.Swap, report.SwapTotal = nil, nil
		report.setMetricError("swap", reason)
	}
}

func collectNetworkReport(report *Report, now time.Time, read func(bool) ([]gnet.IOCountersStat, error)) {
	netIO, err := read(true)
	if err != nil || len(netIO) == 0 {
		report.setMetricError("network", "collection_failed")
		return
	}
	selected := trafficInterfaceSelection(netIO)
	if len(selected) == 0 {
		report.setMetricError("network", "collection_failed")
		return
	}
	rawUp, rawDown := sumNetworkCounters(netIO, selected)
	report.hasRawNetTotals = true
	report.rawNetTotalUp, report.rawNetTotalDown = rawUp, rawDown
	report.netPerInterface = collectPerInterfaceCounters(netIO, selected)
	up, down := rawUp, rawDown
	if trafficTracker != nil {
		up, down = trafficTracker.adjustInterfaces(report.netPerInterface, now)
	}
	report.NetTotalUp, report.NetTotalDown = int64Metric(up), int64Metric(down)
}

func formatOptionalCPU(value *float64) string {
	if value == nil {
		return "unknown"
	}
	return fmt.Sprintf("%.1f%%", *value)
}

func formatOptionalMemory(value *int64) string {
	if value == nil {
		return "unknown"
	}
	return formatMemoryBytes(*value)
}

func formatOptionalRate(value *int64) string {
	if value == nil {
		return "unknown"
	}
	return fmt.Sprintf("%dB/s", *value)
}
