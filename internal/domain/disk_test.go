package domain

import (
	"slices"
	"testing"
)

func TestReclaimableSumsWorktreesTheEngineWouldRemoveOrBackUp(t *testing.T) {
	rows := []DiskRow{
		{WorktreeID: "a", Size: 100, Action: CleanupRemove},
		{WorktreeID: "b", Size: 40, Action: CleanupBackupThenAsk},
		{WorktreeID: "c", Size: 1000, Action: CleanupKeep},
		{WorktreeID: "d", Size: 7, Action: CleanupRemove},
	}
	total, pending := Reclaimable(rows)
	if total != 147 || pending != 0 {
		t.Errorf("Reclaimable = %d, %d pending; want 147, 0", total, pending)
	}
}

func TestReclaimableLeavesOutSizesNotComputedYetAndCountsThem(t *testing.T) {
	rows := []DiskRow{
		{WorktreeID: "a", Size: SizePending, Action: CleanupRemove},
		{WorktreeID: "b", Size: 40, Action: CleanupRemove},
		{WorktreeID: "c", Size: SizePending, Action: CleanupKeep},
	}
	total, pending := Reclaimable(rows)
	if total != 40 || pending != 1 {
		t.Errorf("Reclaimable = %d, %d pending; want 40, 1 (a kept row's pending size does not count)", total, pending)
	}
}

func TestTotalSizeSumsEveryMeasuredWorktreeAndCountsTheRest(t *testing.T) {
	rows := []DiskRow{
		{WorktreeID: "a", Size: 100, Action: CleanupKeep},
		{WorktreeID: "b", Size: SizePending, Action: CleanupRemove},
		{WorktreeID: "c", Size: 5, Action: CleanupRemove},
	}
	total, pending := TotalSize(rows)
	if total != 105 || pending != 1 {
		t.Errorf("TotalSize = %d, %d pending; want 105, 1", total, pending)
	}
}

func TestDiskTotalsLeaveOutAMissingFolderWithoutWaitingForIt(t *testing.T) {
	rows := []DiskRow{
		{WorktreeID: "a", Size: SizeMissing, Action: CleanupRemove},
		{WorktreeID: "b", Size: 40, Action: CleanupRemove},
		{WorktreeID: "c", Size: SizeMissing, Action: CleanupKeep},
	}
	cases := []struct {
		name string
		fn   func([]DiskRow) (int64, int)
	}{
		{"Reclaimable", Reclaimable},
		{"TotalSize", TotalSize},
	}
	for _, c := range cases {
		total, pending := c.fn(rows)
		if total != 40 || pending != 0 {
			t.Errorf("%s = %d, %d pending; want 40, 0", c.name, total, pending)
		}
	}
}

func TestWorktreeStatusSaysWhatTheWorktreeIsDoing(t *testing.T) {
	merged := &PullRequest{Number: 1, State: PRMerged}
	cases := []struct {
		name   string
		w      Worktree
		owner  *Session
		action CleanupAction
		want   string
	}{
		{"its session is running", Worktree{Branch: "a"}, &Session{State: StateRunning}, CleanupKeep, "◐ in use"},
		{"its session waits on you", Worktree{Branch: "a"}, &Session{State: StateWaiting}, CleanupKeep, "✳ in use"},
		{"its session is done", Worktree{Branch: "a"}, &Session{State: StateDone}, CleanupKeep, "● in use"},
		{"its session is idle", Worktree{Branch: "a"}, &Session{State: StateIdle}, CleanupKeep, "○ idle"},
		{"its session ended", Worktree{Branch: "a"}, &Session{State: StateIdle, Ended: true}, CleanupKeep, "○ idle"},
		{"no session", Worktree{Branch: "a"}, nil, CleanupKeep, "○ idle"},
		{"cleanup would remove it", Worktree{Branch: "a"}, nil, CleanupRemove, "✓ merged"},
		{"merged but kept for now", Worktree{Branch: "a", PR: merged}, &Session{State: StateRunning}, CleanupKeep, "✓ merged"},
		{"merged with changes", Worktree{Branch: "a", PR: merged}, nil, CleanupBackupThenAsk, "! merged, dirty"},
		{"detached and not in the default branch", Worktree{}, nil, CleanupBackupThenAsk, "! detached"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := WorktreeStatus(c.w, c.owner, c.action); got != c.want {
				t.Fatalf("got %q, want %q", got, c.want)
			}
		})
	}
}

func TestSortDiskRowsComparesDigitRunsAsNumbers(t *testing.T) {
	cases := []struct {
		name string
		in   []string
		want []string
	}{
		{"numbered seeds", []string{"/w/seed-10", "/w/seed-2", "/w/seed-1"}, []string{"/w/seed-1", "/w/seed-2", "/w/seed-10"}},
		{"issue branches", []string{"/w/689-disk", "/w/1000-x", "/w/90-y"}, []string{"/w/90-y", "/w/689-disk", "/w/1000-x"}},
		{"text before numbers", []string{"/b/1", "/a/2", "/a/10"}, []string{"/a/2", "/a/10", "/b/1"}},
		{"leading zeros keep a stable order", []string{"/w/x-01", "/w/x-1", "/w/x-001"}, []string{"/w/x-1", "/w/x-01", "/w/x-001"}},
		{"plain text", []string{"/w/b", "/w/ab", "/w/a"}, []string{"/w/a", "/w/ab", "/w/b"}},
		{"a number before a letter", []string{"/w/a", "/w/9"}, []string{"/w/9", "/w/a"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rows := make([]DiskRow, len(tc.in))
			for i, id := range tc.in {
				rows[i] = DiskRow{WorktreeID: id}
			}
			SortDiskRows(rows)
			got := make([]string, len(rows))
			for i, r := range rows {
				got[i] = r.WorktreeID
			}
			if !slices.Equal(got, tc.want) {
				t.Errorf("order = %v, want %v", got, tc.want)
			}
		})
	}
}
