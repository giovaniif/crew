package main

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAssetsCheckFailsWhenThePRBranchAddsImages(t *testing.T) {
	r := newEvRepo(t, "docs/shot.png")
	e := realGitEnv(t)
	got, code := runJSON(t, e, "assets", "check", "--repo", r.dir, "--base", "main")
	if code != 1 || !strings.Contains(problemText(got), "docs/shot.png") {
		t.Errorf("exit %d: %s", code, problemText(got))
	}
	r2 := newEvRepo(t, "a.go")
	mustOK(t, e, "assets", "check", "--repo", r2.dir, "--base", "main")
}

func TestAssetsPushWritesToTheOrphanBranchAndReturnsPinnedURLs(t *testing.T) {
	remote := t.TempDir()
	git(t, remote, "init", "-q", "--bare")
	r := newEvRepo(t, "a.go")
	git(t, r.dir, "remote", "add", "origin", remote)
	e := realGitEnv(t)
	img := filepath.Join(t.TempDir(), "after.png")
	writePNG(t, img, 4, 4)
	got := mustOK(t, e, "assets", "push", "--repo", r.dir, "--remote", "origin", "--slug", "giovaniif/crew", "--dir", "42", img)
	urls := got["urls"].([]any)
	commit := git(t, remote, "rev-parse", "pr-assets")
	want := "https://raw.githubusercontent.com/giovaniif/crew/" + commit + "/42/after.png"
	if len(urls) != 1 || urls[0] != want {
		t.Errorf("urls %v, want %s", urls, want)
	}
	if git(t, r.dir, "rev-parse", "--abbrev-ref", "HEAD") != "fix" {
		t.Error("the checkout moved")
	}
	if strings.TrimSpace(git(t, r.dir, "status", "--porcelain")) != "" {
		t.Error("the work tree changed")
	}
	img2 := filepath.Join(t.TempDir(), "before.png")
	writePNG(t, img2, 4, 4)
	mustOK(t, e, "assets", "push", "--repo", r.dir, "--remote", "origin", "--slug", "giovaniif/crew", "--dir", "42", img2)
	files := git(t, remote, "ls-tree", "-r", "--name-only", "pr-assets")
	if files != "42/after.png\n42/before.png" && files != "42/after.png\n42/before.png\n" {
		if !strings.Contains(files, "42/after.png") || !strings.Contains(files, "42/before.png") {
			t.Errorf("branch files %q", files)
		}
	}
	if parents := git(t, remote, "rev-list", "--max-parents=0", "pr-assets"); strings.Contains(parents, r.base) {
		t.Error("pr-assets is not an orphan branch")
	}
}

func TestAssetsCheckKeepsAnExemptFileNameWithASpace(t *testing.T) {
	r := newEvRepo(t, "web/public/my shot.png")
	mustOK(t, realGitEnv(t), "assets", "check", "--repo", r.dir, "--base", "main")
}

func TestAssetsPushLeavesOtherIndexFilesAndEscapesURLs(t *testing.T) {
	remote := t.TempDir()
	git(t, remote, "init", "-q", "--bare")
	r := newEvRepo(t, "a.go")
	git(t, r.dir, "remote", "add", "origin", remote)
	e := realGitEnv(t)
	other := filepath.Join(e.state, "assets-index")
	write(t, other, "another push")
	img := filepath.Join(t.TempDir(), "after#1.png")
	writePNG(t, img, 4, 4)
	got := mustOK(t, e, "assets", "push", "--repo", r.dir, "--remote", "origin", "--slug", "giovaniif/crew", "--dir", "42", img)
	commit := git(t, remote, "rev-parse", "pr-assets")
	want := "https://raw.githubusercontent.com/giovaniif/crew/" + commit + "/42/after%231.png"
	if urls := got["urls"].([]any); len(urls) != 1 || urls[0] != want {
		t.Errorf("urls %v, want %s", urls, want)
	}
	if b, err := os.ReadFile(other); err != nil || string(b) != "another push" {
		t.Errorf("the push changed a file it does not own: %q %v", b, err)
	}
}

func TestAnnotateMakesABeforeAfterPairWithAHighlightBox(t *testing.T) {
	e, _ := testEnv(t)
	dir := t.TempDir()
	for _, n := range []string{"before.png", "after.png"} {
		im := image.NewRGBA(image.Rect(0, 0, 200, 100))
		for y := 0; y < 100; y++ {
			for x := 0; x < 200; x++ {
				im.Set(x, y, color.White)
			}
		}
		f, _ := os.Create(filepath.Join(dir, n))
		_ = png.Encode(f, im)
		_ = f.Close()
	}
	out := filepath.Join(dir, "pair.png")
	got := mustOK(t, e, "annotate", "--before", filepath.Join(dir, "before.png"), "--after", filepath.Join(dir, "after.png"), "--crop", "10,10,110,60", "--box", "20,20,60,40", "--caption-before", "Before", "--caption-after", "After: fixed", "--out", out)
	if got["sha256"] == "" {
		t.Error("no hash")
	}
	f, err := os.Open(out)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	im, err := png.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	b := im.Bounds()
	if b.Dx() <= 200 || b.Dy() <= 50 {
		t.Errorf("size %v is not two crops with captions", b)
	}
	red := 0
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			r, g, bl, _ := im.At(x, y).RGBA()
			if r > 0xc000 && g < 0x6000 && bl < 0x6000 {
				red++
			}
		}
	}
	if red == 0 {
		t.Error("no highlight box")
	}
}

func TestAnnotateRejectsACropOutsideTheImage(t *testing.T) {
	e, _ := testEnv(t)
	dir := t.TempDir()
	writePNG(t, filepath.Join(dir, "a.png"), 50, 50)
	_, code := runJSON(t, e, "annotate", "--before", filepath.Join(dir, "a.png"), "--after", filepath.Join(dir, "a.png"), "--crop", "0,0,500,500", "--out", filepath.Join(dir, "o.png"))
	if code != 1 {
		t.Errorf("exit %d", code)
	}
}

func TestAnnotateRejectsAnEmptyCrop(t *testing.T) {
	e, _ := testEnv(t)
	dir := t.TempDir()
	writePNG(t, filepath.Join(dir, "a.png"), 50, 50)
	_, code := runJSON(t, e, "annotate", "--before", filepath.Join(dir, "a.png"), "--after", filepath.Join(dir, "a.png"), "--crop", "500,500,500,500", "--out", filepath.Join(dir, "o.png"))
	if code != 1 {
		t.Errorf("exit %d", code)
	}
	if _, err := os.Stat(filepath.Join(dir, "o.png")); err == nil {
		t.Error("an empty crop wrote a pair")
	}
}

func TestAnnotateNeverOverwritesAnInput(t *testing.T) {
	e, _ := testEnv(t)
	dir := t.TempDir()
	a, b := filepath.Join(dir, "a.png"), filepath.Join(dir, "b.png")
	writePNG(t, a, 50, 50)
	writePNG(t, b, 50, 50)
	for _, out := range []string{a, filepath.Join(dir, "x", "..", "b.png")} {
		_, code := runJSON(t, e, "annotate", "--before", a, "--after", b, "--out", out)
		if code == 0 {
			t.Errorf("--out %s: exit 0", out)
		}
		if im, err := readPNG(filepath.Clean(out)); err != nil || im.Bounds().Dx() != 50 {
			t.Errorf("--out %s replaced the input", out)
		}
	}
}
