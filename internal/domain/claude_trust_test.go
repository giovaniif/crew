package domain

import "testing"

func TestClaudeTrustsAFolderWhenItOrAParentWasAccepted(t *testing.T) {
	trusted := map[string]bool{"/home/u/code": true, "/home/u/other": false, "/srv/api": true}
	cases := []struct {
		dir  string
		want bool
	}{
		{"/home/u/code", true},
		{"/home/u/code/api", true},
		{"/home/u/code/api/", true},
		{"/home/u/codex", false},
		{"/home/u/other/web", false},
		{"/home/u", false},
		{"/srv/api", true},
		{"/srv", false},
		{"", false},
		{"relative/dir", false},
	}
	for _, c := range cases {
		if got := ClaudeTrusts(trusted, c.dir); got != c.want {
			t.Errorf("ClaudeTrusts(%q) = %v, want %v", c.dir, got, c.want)
		}
	}
	if !ClaudeTrusts(map[string]bool{"/": true}, "/any/dir") {
		t.Error("a trusted root does not trust its subfolders")
	}
}
