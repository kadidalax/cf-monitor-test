package main

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/shirou/gopsutil/v3/mem"
)

func readHostMemorySnapshot() memorySnapshot {
	var snapshot memorySnapshot
	if info, err := mem.VirtualMemory(); err == nil {
		snapshot.ramUsed, snapshot.ramTotal, snapshot.hasRAM = info.Used, info.Total, true
	}
	if info, err := mem.SwapMemory(); err == nil {
		snapshot.swapUsed, snapshot.swapTotal, snapshot.hasSwap = info.Used, info.Total, true
	}
	return snapshot
}

func completeMemorySnapshot(snapshot memorySnapshot, allowHost bool, readHost func() memorySnapshot) memorySnapshot {
	if allowHost && (!snapshot.hasRAM || !snapshot.hasSwap) {
		fallback := readHost()
		if !snapshot.hasRAM {
			snapshot.ramUsed, snapshot.ramTotal, snapshot.hasRAM = fallback.ramUsed, fallback.ramTotal, fallback.hasRAM
		}
		if !snapshot.hasSwap {
			snapshot.swapUsed, snapshot.swapTotal, snapshot.hasSwap = fallback.swapUsed, fallback.swapTotal, fallback.hasSwap
		}
	}
	if snapshot.ramUsed > snapshot.ramTotal {
		snapshot.ramUsed = snapshot.ramTotal
	}
	if snapshot.swapUsed > snapshot.swapTotal {
		snapshot.swapUsed = snapshot.swapTotal
	}
	return snapshot
}

// Service presence or a similarly named path cannot establish proc scope.
// Check the most specific mount covering the file, including overmounts.
func procFileIsLXCFS(procPath, mountinfoPath string) bool {
	data, err := os.ReadFile(mountinfoPath)
	if err != nil {
		return false
	}
	procPath = filepath.Clean(procPath)
	unescape := strings.NewReplacer(`\040`, " ", `\011`, "\t", `\012`, "\n", `\134`, `\`)
	matchedLength, scoped := -1, false
	for _, line := range strings.Split(string(data), "\n") {
		parts := strings.SplitN(line, " - ", 2)
		if len(parts) != 2 {
			continue
		}
		before, after := strings.Fields(parts[0]), strings.Fields(parts[1])
		if len(before) < 6 || len(after) < 3 {
			continue
		}
		mountPoint := filepath.Clean(unescape.Replace(before[4]))
		if procPath != mountPoint && !strings.HasPrefix(procPath, strings.TrimRight(mountPoint, string(os.PathSeparator))+string(os.PathSeparator)) {
			continue
		}
		if len(mountPoint) >= matchedLength {
			matchedLength, scoped = len(mountPoint), after[0] == "fuse.lxcfs"
		}
	}
	return scoped
}
