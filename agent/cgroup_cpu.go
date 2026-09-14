package main

import (
	"errors"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
)

type cgroupCPUSnapshot struct {
	usageNanos uint64
	capacity   float64
	scope      string
	available  bool
}

type cpuReportValue struct {
	value    *float64
	capacity float64
	reason   string
}

// Usage belongs to the process's cgroup, including its descendants. An
// ancestor's bandwidth quota is a shared upper bound, not dedicated CPU time.
func readCgroupCPU(root, procSelfCgroup string) cgroupCPUSnapshot {
	groups := controllerCgroupPaths(root, procSelfCgroup, "cpu")
	if len(groups) == 0 {
		return cgroupCPUSnapshot{}
	}
	group := groups[0]
	quota, ok := effectiveCPUQuota(cgroupAncestorPaths(group.root, group.leaf), group.v2)
	if !ok {
		return cgroupCPUSnapshot{}
	}
	cores, ok := effectiveCPUSet(root, procSelfCgroup)
	if !ok {
		return cgroupCPUSnapshot{}
	}
	capacity := float64(cores)
	if quota > 0 && quota < capacity {
		capacity = quota
	}
	result := cgroupCPUSnapshot{capacity: capacity, scope: group.leaf}
	if group.v2 {
		data, err := os.ReadFile(filepath.Join(group.leaf, "cpu.stat"))
		if err != nil {
			return result
		}
		for _, line := range strings.Split(string(data), "\n") {
			fields := strings.Fields(line)
			if len(fields) == 2 && fields[0] == "usage_usec" {
				usage, err := strconv.ParseUint(fields[1], 10, 64)
				if err != nil || usage > math.MaxUint64/1000 {
					return result
				}
				result.usageNanos, result.available = usage*1000, true
				return result
			}
		}
		return result
	}
	accounting := controllerCgroupPaths(root, procSelfCgroup, "cpuacct")
	if len(accounting) == 0 {
		return result
	}
	data, err := os.ReadFile(filepath.Join(accounting[0].leaf, "cpuacct.usage"))
	if err != nil {
		return result
	}
	usage, err := strconv.ParseUint(strings.TrimSpace(string(data)), 10, 64)
	if err != nil {
		return result
	}
	result.usageNanos, result.available = usage, true
	result.scope += "|" + accounting[0].leaf
	return result
}

func effectiveCPUQuota(dirs []string, v2 bool) (float64, bool) {
	var budget float64
	for _, dir := range dirs {
		var quota, period string
		if v2 {
			data, err := os.ReadFile(filepath.Join(dir, "cpu.max"))
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			if err != nil {
				return 0, false
			}
			fields := strings.Fields(string(data))
			if len(fields) != 2 {
				return 0, false
			}
			quota, period = fields[0], fields[1]
		} else {
			data, err := os.ReadFile(filepath.Join(dir, "cpu.cfs_quota_us"))
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			if err != nil {
				return 0, false
			}
			quota = strings.TrimSpace(string(data))
			data, err = os.ReadFile(filepath.Join(dir, "cpu.cfs_period_us"))
			if err != nil {
				return 0, false
			}
			period = strings.TrimSpace(string(data))
		}
		periodValue, err := strconv.ParseUint(period, 10, 64)
		if err != nil || periodValue == 0 {
			return 0, false
		}
		if (v2 && quota == "max") || (!v2 && quota == "-1") {
			continue
		}
		quotaValue, err := strconv.ParseUint(quota, 10, 64)
		if err != nil || quotaValue == 0 {
			return 0, false
		}
		value := float64(quotaValue) / float64(periodValue)
		if budget == 0 || value < budget {
			budget = value
		}
	}
	return budget, len(dirs) > 0
}

func effectiveCPUSet(root, procSelfCgroup string) (int, bool) {
	groups := controllerCgroupPaths(root, procSelfCgroup, "cpuset")
	if len(groups) > 0 {
		group := groups[0]
		for _, dir := range cgroupAncestorPaths(group.root, group.leaf) {
			name := "cpuset.effective_cpus"
			if group.v2 {
				name = "cpuset.cpus.effective"
			}
			data, err := os.ReadFile(filepath.Join(dir, name))
			if err == nil {
				return cpuSetCount(string(data))
			}
			if !errors.Is(err, os.ErrNotExist) {
				return 0, false
			}
			data, err = os.ReadFile(filepath.Join(dir, "cpuset.cpus"))
			if err == nil && strings.TrimSpace(string(data)) != "" {
				return cpuSetCount(string(data))
			}
			if err != nil && !errors.Is(err, os.ErrNotExist) {
				return 0, false
			}
		}
	}
	// A disabled cpuset controller still has a kernel-enforced affinity mask.
	data, err := os.ReadFile(filepath.Join(filepath.Dir(procSelfCgroup), "status"))
	if err != nil {
		return 0, false
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "Cpus_allowed_list:") {
			return cpuSetCount(strings.TrimPrefix(line, "Cpus_allowed_list:"))
		}
	}
	return 0, false
}

func cpuSetCount(raw string) (int, bool) {
	type cpuRange struct{ first, last int }
	var ranges []cpuRange
	for _, part := range strings.Split(strings.TrimSpace(raw), ",") {
		ends := strings.Split(part, "-")
		if len(ends) < 1 || len(ends) > 2 {
			return 0, false
		}
		first, err := strconv.Atoi(ends[0])
		if err != nil || first < 0 || first > 1048575 {
			return 0, false
		}
		last := first
		if len(ends) == 2 {
			last, err = strconv.Atoi(ends[1])
			if err != nil || last < first || last > 1048575 {
				return 0, false
			}
		}
		ranges = append(ranges, cpuRange{first, last})
	}
	sort.Slice(ranges, func(i, j int) bool { return ranges[i].first < ranges[j].first })
	count, end := 0, -1
	for _, item := range ranges {
		if item.last <= end {
			continue
		}
		first := item.first
		if first <= end {
			first = end + 1
		}
		count += item.last - first + 1
		end = item.last
	}
	return count, count > 0
}

func cgroupCPUPercent(before, after cgroupCPUSnapshot, elapsed time.Duration) cpuReportValue {
	result := cpuReportValue{capacity: after.capacity}
	if !before.available || !after.available {
		result.reason = "collection_failed"
		return result
	}
	if before.scope != after.scope || before.capacity != after.capacity || after.usageNanos < before.usageNanos || elapsed <= 0 || after.capacity <= 0 {
		result.reason = "warming_up"
		return result
	}
	value := float64(after.usageNanos-before.usageNanos) / float64(elapsed) * 100 / after.capacity
	result.value = float64Metric(math.Min(100, math.Max(0, value)))
	return result
}

func readCPUReport(containerized, scopedProc bool, readCgroup func() cgroupCPUSnapshot, readHost func() cpuReportValue, pause func(time.Duration), clock func() time.Time) cpuReportValue {
	if !containerized {
		return readHost()
	}
	before := readCgroup()
	if !before.available {
		if scopedProc {
			return readHost()
		}
		return cpuReportValue{reason: "container_scope_unavailable", capacity: before.capacity}
	}
	started := clock()
	pause(time.Second)
	return cgroupCPUPercent(before, readCgroup(), clock().Sub(started))
}

func collectCPUReport() cpuReportValue {
	containerized := runtime.GOOS == "linux" && isLinuxContainer()
	scopedProc := containerized && procFileIsLXCFS("/proc/stat", "/proc/self/mountinfo") && procFileIsLXCFS("/proc/cpuinfo", "/proc/self/mountinfo")
	return readCPUReport(containerized, scopedProc, func() cgroupCPUSnapshot {
		return readCgroupCPU("/sys/fs/cgroup", "/proc/self/cgroup")
	}, func() cpuReportValue {
		percent, err := cpu.Percent(time.Second, false)
		return hostCPUReport(percent, err, cpu.Counts)
	}, time.Sleep, time.Now)
}

func hostCPUReport(percent []float64, err error, count func(bool) (int, error)) cpuReportValue {
	if err != nil || len(percent) == 0 || math.IsNaN(percent[0]) || math.IsInf(percent[0], 0) {
		return cpuReportValue{reason: "collection_failed"}
	}
	result := cpuReportValue{value: float64Metric(math.Min(100, math.Max(0, percent[0])))}
	if cores, err := count(true); err == nil && cores > 0 {
		result.capacity = float64(cores)
	}
	return result
}

func applyCPUReport(report *Report, result cpuReportValue) {
	report.CPU = result.value
	if result.capacity > 0 {
		report.CPUCapacity = float64Metric(result.capacity)
	}
	if result.reason != "" {
		report.setMetricError("cpu", result.reason)
	}
}
