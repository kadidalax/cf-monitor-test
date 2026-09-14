package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func auditCPUFixture(t *testing.T, quota, cpus string) (string, string) {
	t.Helper()
	root := t.TempDir()
	writeCgroupFixture(t, root, "self/cgroup", "0::/tenant/agent\n")
	writeCgroupFixture(t, root, "tenant/agent/cpu.max", quota)
	writeCgroupFixture(t, root, "tenant/agent/cpu.stat", "usage_usec 250000\nuser_usec 200000\nsystem_usec 50000\n")
	if cpus != "" {
		writeCgroupFixture(t, root, "tenant/agent/cpuset.cpus.effective", cpus)
	}
	return root, filepath.Join(root, "self", "cgroup")
}

func TestAuditCPUUsesQuotaAndCPUSet(t *testing.T) {
	for _, tc := range []struct {
		name, quota, cpus string
		capacity          float64
	}{
		{"half core quota", "50000 100000", "0-7", .5},
		{"cpuset narrower than quota", "400000 100000", "2,5", 2},
		{"unlimited quota retains cpuset", "max 100000", "0-1", 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root, self := auditCPUFixture(t, tc.quota, tc.cpus)
			got := readCgroupCPU(root, self)
			if !got.available || got.capacity != tc.capacity || got.usageNanos != 250000000 {
				t.Fatalf("CPU snapshot = %#v", got)
			}
		})
	}
}

func TestAuditCPURespectsAncestorQuotaAndInheritedCPUSet(t *testing.T) {
	root, self := auditCPUFixture(t, "max 100000", "")
	writeCgroupFixture(t, root, "tenant/cpu.max", "25000 100000")
	writeCgroupFixture(t, root, "tenant/cpu.stat", "usage_usec 9000000")
	writeCgroupFixture(t, root, "tenant/cpuset.cpus.effective", "1-3")
	writeCgroupFixture(t, root, "tenant/agent/cpuset.cpus", "")
	got := readCgroupCPU(root, self)
	if !got.available || got.capacity != .25 || got.usageNanos != 250000000 {
		t.Fatal("CPU must retain leaf usage and apply the inherited shared upper budget")
	}
}

func TestAuditCPUUsesV1AccountingAndSeparateCPUSet(t *testing.T) {
	root := t.TempDir()
	writeCgroupFixture(t, root, "self/cgroup", "3:cpu,cpuacct:/tenant/agent\n4:cpuset:/slice\n")
	writeCgroupFixture(t, root, "cpu,cpuacct/tenant/agent/cpu.cfs_quota_us", "100000")
	writeCgroupFixture(t, root, "cpu,cpuacct/tenant/agent/cpu.cfs_period_us", "100000")
	writeCgroupFixture(t, root, "cpu,cpuacct/tenant/agent/cpuacct.usage", "500000000")
	writeCgroupFixture(t, root, "cpu,cpuacct/tenant/cpu.cfs_quota_us", "50000")
	writeCgroupFixture(t, root, "cpu,cpuacct/tenant/cpu.cfs_period_us", "100000")
	writeCgroupFixture(t, root, "cpuset/slice/cpuset.cpus", "0-3")
	got := readCgroupCPU(root, filepath.Join(root, "self", "cgroup"))
	if !got.available || got.capacity != .5 || got.usageNanos != 500000000 {
		t.Fatalf("v1 accounting and cpu/cpuset controllers disagree: %#v", got)
	}
}

func TestAuditCPUUnknownOrUnreadableDoesNotAuthorizeHostFallback(t *testing.T) {
	for _, mode := range []string{"bad quota", "bad cpuset", "unreadable usage", "missing affinity"} {
		t.Run(mode, func(t *testing.T) {
			root, self := auditCPUFixture(t, "50000 100000", "0-1")
			switch mode {
			case "bad quota":
				writeCgroupFixture(t, root, "tenant/agent/cpu.max", "broken")
			case "bad cpuset":
				writeCgroupFixture(t, root, "tenant/agent/cpuset.cpus.effective", "4-1")
			case "unreadable usage":
				if err := os.Remove(filepath.Join(root, "tenant", "agent", "cpu.stat")); err != nil {
					t.Fatal(err)
				}
				if err := os.Mkdir(filepath.Join(root, "tenant", "agent", "cpu.stat"), 0700); err != nil {
					t.Fatal(err)
				}
			case "missing affinity":
				if err := os.Remove(filepath.Join(root, "tenant", "agent", "cpuset.cpus.effective")); err != nil {
					t.Fatal(err)
				}
			}
			hostCalls := 0
			got := readCPUReport(true, false, func() cgroupCPUSnapshot { return readCgroupCPU(root, self) }, func() cpuReportValue {
				hostCalls++
				return cpuReportValue{value: float64Metric(75), capacity: 64}
			}, func(time.Duration) { t.Fatal("unavailable CPU must not wait for a second sample") }, time.Now)
			if hostCalls != 0 || got.value != nil || got.reason != "container_scope_unavailable" {
				t.Fatal("unknown container CPU borrowed host utilization")
			}
		})
	}
}

func TestAuditCPUReadOnlyMountRootAndBoundary(t *testing.T) {
	root := t.TempDir()
	mount := filepath.Join(root, "mounted")
	writeCgroupFixture(t, root, "mounted/agent/cpu.max", "max 100000")
	writeCgroupFixture(t, root, "mounted/cpu.max", "50000 100000")
	writeCgroupFixture(t, root, "mounted/agent/cpuset.cpus.effective", "0-3")
	writeCgroupFixture(t, root, "mounted/agent/cpu.stat", "usage_usec 100000")
	writeCgroupFixture(t, root, "cpu.max", "1000 100000")
	writeCgroupFixture(t, root, "self/cgroup", "0::/tenant/agent\n")
	writeCgroupFixture(t, root, "self/mountinfo", "10 1 0:1 /tenant "+filepath.ToSlash(mount)+" ro - cgroup2 cgroup rw\n")
	self := filepath.Join(root, "self", "cgroup")
	got := readCgroupCPU(root, self)
	if !got.available || got.capacity != .5 {
		t.Fatal("mount root mapping escaped or lost the visible ancestor quota")
	}
	writeCgroupFixture(t, root, "self/cgroup", "0::/tenant/../elsewhere\n")
	if got := readCgroupCPU(root, self); got.available {
		t.Fatal("CPU namespace parent traversal was accepted")
	}
}

func TestAuditCPUDisabledCPUSetUsesKernelAffinity(t *testing.T) {
	root, self := auditCPUFixture(t, "max 100000", "")
	writeCgroupFixture(t, root, "self/status", "Name:\tagent\nCpus_allowed_list:\t2,7\n")
	got := readCgroupCPU(root, self)
	if !got.available || got.capacity != 2 {
		t.Fatal("kernel CPU affinity was not respected")
	}
}

func TestAuditCPUUsageIsNormalizedToAvailableBudget(t *testing.T) {
	before := cgroupCPUSnapshot{usageNanos: 1000000000, capacity: .5, scope: "fixture", available: true}
	after := before
	after.usageNanos += 250000000
	got := cgroupCPUPercent(before, after, time.Second)
	if got.value == nil || *got.value != 50 {
		t.Fatal("quarter CPU-second in a half-core budget must report 50 percent")
	}
	zero := cgroupCPUPercent(after, after, time.Second)
	if zero.value == nil || *zero.value != 0 {
		t.Fatal("measured idle CPU is a known zero")
	}
	reset := cgroupCPUPercent(after, before, time.Second)
	if reset.value != nil || reset.reason != "warming_up" {
		t.Fatal("counter reset must rebuild the sampling baseline")
	}
	after.capacity = 1
	if got := cgroupCPUPercent(before, after, time.Second); got.value != nil {
		t.Fatal("changed CPU budget was mixed within one sample")
	}
}

func TestAuditCPUPhysicalHostAndVerifiedLXCFSKeepValidZeros(t *testing.T) {
	for _, container := range []bool{false, true} {
		calls := 0
		got := readCPUReport(container, container, func() cgroupCPUSnapshot { return cgroupCPUSnapshot{} }, func() cpuReportValue {
			calls++
			return hostCPUReport([]float64{0}, nil, func(bool) (int, error) { return 2, nil })
		}, func(time.Duration) {}, time.Now)
		if got.value == nil || *got.value != 0 || calls != 1 {
			t.Fatal("trusted zero CPU reading was discarded")
		}
	}
	got := hostCPUReport(nil, errors.New("synthetic read failure"), func(bool) (int, error) { return 2, nil })
	if got.value != nil || got.reason != "collection_failed" {
		t.Fatal("host CPU read error became idle")
	}
}

func TestAuditCPUSetParsingDoesNotDoubleCountOrExpandHugeRanges(t *testing.T) {
	if count, ok := cpuSetCount("0-3,2-5,8"); !ok || count != 7 {
		t.Fatal("overlapping CPU ranges counted twice")
	}
	for _, value := range []string{"", "2-1", "-1", "0-999999999999", "0,,1", "bad"} {
		if _, ok := cpuSetCount(value); ok {
			t.Fatal("invalid CPU set accepted")
		}
	}
}
