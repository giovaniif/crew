package domain

import (
	"cmp"
	"slices"
	"strings"
)

const (
	SizePending int64 = -1
	SizeMissing int64 = -2
)

type DiskRow struct {
	WorktreeID string
	Size       int64
	Action     CleanupAction
	Reason     string
}

func Reclaimable(rows []DiskRow) (total int64, pending int) {
	for _, r := range rows {
		if r.Action != CleanupRemove && r.Action != CleanupBackupThenAsk {
			continue
		}
		if r.Size == SizePending {
			pending++
			continue
		}
		if r.Size == SizeMissing {
			continue
		}
		total += r.Size
	}
	return total, pending
}

func TotalSize(rows []DiskRow) (total int64, pending int) {
	for _, r := range rows {
		if r.Size == SizePending {
			pending++
			continue
		}
		if r.Size == SizeMissing {
			continue
		}
		total += r.Size
	}
	return total, pending
}

func WorktreeStatus(w Worktree, owner *Session, a CleanupAction) string {
	switch {
	case a == CleanupBackupThenAsk && w.Branch == "":
		return "! detached"
	case a == CleanupBackupThenAsk:
		return "! merged, dirty"
	case a == CleanupRemove, w.PR != nil && w.PR.State == PRMerged:
		return "✓ merged"
	case owner == nil || owner.Ended:
		return "○ idle"
	}
	switch owner.State {
	case StateRunning:
		return "◐ in use"
	case StateWaiting, StatePermission:
		return "✳ in use"
	case StateDone:
		return "● in use"
	}
	return "○ idle"
}

func SortDiskRows(rows []DiskRow) {
	slices.SortStableFunc(rows, func(a, b DiskRow) int { return naturalCompare(a.WorktreeID, b.WorktreeID) })
}

func naturalCompare(a, b string) int {
	for a != "" && b != "" {
		da, db := digitRun(a), digitRun(b)
		if da > 0 && db > 0 {
			na, nb := strings.TrimLeft(a[:da], "0"), strings.TrimLeft(b[:db], "0")
			if c := cmp.Compare(len(na), len(nb)); c != 0 {
				return c
			}
			if c := strings.Compare(na, nb); c != 0 {
				return c
			}
			if c := cmp.Compare(da, db); c != 0 {
				return c
			}
			a, b = a[da:], b[db:]
			continue
		}
		if a[0] != b[0] {
			return cmp.Compare(a[0], b[0])
		}
		a, b = a[1:], b[1:]
	}
	return cmp.Compare(len(a), len(b))
}

func digitRun(s string) int {
	n := 0
	for n < len(s) && s[n] >= '0' && s[n] <= '9' {
		n++
	}
	return n
}
