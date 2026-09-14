package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAuditSwapRespectsCgroupBeforeHostProc(t *testing.T) {
	const mib = uint64(1024 * 1024)
	proc := memorySnapshot{ramTotal: 8 * 1024 * mib, ramUsed: 2 * 1024 * mib, hasRAM: true,
		swapTotal: 2 * 1024 * mib, swapUsed: 512 * mib, hasSwap: true}
	for _, tc := range []struct {
		name        string
		total, used uint64
	}{
		{"explicit zero disables swap", 0, 0},
		{"finite container limit", 256 * mib, 64 * mib},
		{"valid large swap budget is not rejected by RAM ratio", 8 * 1024 * mib, 3 * 1024 * mib},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cgroup := memorySnapshot{ramTotal: 1024 * mib, ramUsed: 256 * mib, hasRAM: true,
				swapTotal: tc.total, swapUsed: tc.used, hasSwap: true}
			got := mergeMemorySnapshot(proc, cgroup, true)
			if !got.hasSwap || got.swapTotal != tc.total || got.swapUsed != tc.used {
				t.Fatalf("swap = available:%t total:%d used:%d; want cgroup available:true total:%d used:%d", got.hasSwap, got.swapTotal, got.swapUsed, tc.total, tc.used)
			}
		})
	}
}

func TestAuditSwapUnlimitedOrUnreadableDoesNotAuthorizeHostFallback(t *testing.T) {
	for _, limit := range []string{"max", "not-readable"} {
		t.Run(limit, func(t *testing.T) {
			root := t.TempDir()
			writeCgroupFixture(t, root, "memory.max", "1073741824")
			writeCgroupFixture(t, root, "memory.current", "268435456")
			writeCgroupFixture(t, root, "memory.swap.max", limit)
			writeCgroupFixture(t, root, "memory.swap.current", "0")
			writeCgroupFixture(t, root, "self-cgroup", "0::/\n")
			cgroup := readCgroupMemory(root, filepath.Join(root, "self-cgroup"))
			proc := memorySnapshot{swapTotal: 2 << 30, swapUsed: 512 << 20, hasSwap: true}
			got := mergeMemorySnapshot(proc, cgroup, true)
			if got.hasSwap || got.swapTotal != 0 || got.swapUsed != 0 {
				t.Fatal("unavailable container swap must remain unavailable instead of borrowing host totals")
			}
		})
	}
}

func TestAuditSwapActualCgroupV1AndV2Flow(t *testing.T) {
	for _, v2 := range []bool{false, true} {
		t.Run(map[bool]string{true: "v2", false: "v1"}[v2], func(t *testing.T) {
			root := t.TempDir()
			if v2 {
				writeCgroupFixture(t, root, "memory.max", "1073741824")
				writeCgroupFixture(t, root, "memory.current", "268435456")
				writeCgroupFixture(t, root, "memory.swap.max", "268435456")
				writeCgroupFixture(t, root, "memory.swap.current", "67108864")
				writeCgroupFixture(t, root, "self-cgroup", "0::/\n")
			} else {
				writeCgroupFixture(t, root, "memory/memory.limit_in_bytes", "1073741824")
				writeCgroupFixture(t, root, "memory/memory.usage_in_bytes", "268435456")
				writeCgroupFixture(t, root, "memory/memory.memsw.limit_in_bytes", "1342177280")
				writeCgroupFixture(t, root, "memory/memory.memsw.usage_in_bytes", "335544320")
				writeCgroupFixture(t, root, "self-cgroup", "5:memory:/\n")
			}
			proc := memorySnapshot{swapTotal: 2 << 30, swapUsed: 512 << 20, hasSwap: true}
			got := mergeMemorySnapshot(proc, readCgroupMemory(root, filepath.Join(root, "self-cgroup")), true)
			if !got.hasSwap || got.swapTotal != 256<<20 || got.swapUsed != 64<<20 {
				t.Fatal("the cgroup reader's exact swap budget was lost by the report merge")
			}
		})
	}
}

func TestAuditSwapPhysicalHostKeepsRealZero(t *testing.T) {
	got := mergeMemorySnapshot(memorySnapshot{hasSwap: true}, memorySnapshot{}, false)
	if !got.hasSwap || got.swapTotal != 0 || got.swapUsed != 0 {
		t.Fatal("a physical host's known disabled swap remains a valid zero")
	}
}

func TestAuditSwapLXCFSFallbackRequiresExactMount(t *testing.T) {
	for _, tc := range []struct {
		name, mountinfo string
		scoped          bool
	}{
		{"ordinary proc", "1 0 0:1 / /proc rw - proc proc rw\n", false},
		{"unrelated lxcfs", "2 1 0:2 / /var/lib/lxcfs rw - fuse.lxcfs lxcfs rw\n", false},
		{"file virtualized", "2 1 0:2 /proc/meminfo /proc/meminfo rw - fuse.lxcfs lxcfs rw\n", true},
		{"another file", "2 1 0:2 /proc/stat /proc/stat rw - fuse.lxcfs lxcfs rw\n", false},
		{"overmounted", "2 1 0:2 / /proc rw - fuse.lxcfs lxcfs rw\n3 2 0:3 /meminfo /proc/meminfo rw - proc proc rw\n", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			mountinfo := filepath.Join(t.TempDir(), "mountinfo")
			if err := os.WriteFile(mountinfo, []byte(tc.mountinfo), 0600); err != nil {
				t.Fatal(err)
			}
			proc := memorySnapshot{swapTotal: 512 << 20, swapUsed: 128 << 20, hasSwap: true,
				procContainerScoped: procFileIsLXCFS("/proc/meminfo", mountinfo)}
			got := mergeMemorySnapshot(proc, memorySnapshot{}, true)
			if got.hasSwap != tc.scoped || (tc.scoped && got.swapTotal != proc.swapTotal) {
				t.Fatal("container proc fallback did not follow the exact file's mount provenance")
			}
			// Even a verified LXCFS proc file must not override cgroup zero.
			got = mergeMemorySnapshot(proc, memorySnapshot{hasSwap: true}, true)
			if !got.hasSwap || got.swapTotal != 0 || got.swapUsed != 0 {
				t.Fatal("LXCFS fallback overrode an explicitly disabled cgroup swap")
			}
		})
	}
}

func TestAuditSwapContainerCannotRestoreHostFallback(t *testing.T) {
	calls := 0
	readHost := func() memorySnapshot {
		calls++
		return memorySnapshot{ramTotal: 64 << 30, hasRAM: true, swapTotal: 8 << 30, hasSwap: true}
	}
	container := completeMemorySnapshot(memorySnapshot{}, false, readHost)
	if calls != 0 || container.hasRAM || container.hasSwap {
		t.Fatal("unknown container snapshot called the host collector")
	}
	host := completeMemorySnapshot(memorySnapshot{}, true, readHost)
	if calls != 1 || !host.hasRAM || !host.hasSwap {
		t.Fatal("physical host fallback no longer collects available metrics")
	}
}
