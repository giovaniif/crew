package main

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func writeFilledPNG(t *testing.T, path string, w, h int, fill func(x, y int) color.Color) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	im := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			im.Set(x, y, fill(x, y))
		}
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	if err := png.Encode(f, im); err != nil {
		t.Fatal(err)
	}
}

func white(int, int) color.Color { return color.White }

func TestDesignCompareGivesTheDiffRatioAndThreePanels(t *testing.T) {
	e, _ := testEnv(t)
	dir := t.TempDir()
	shot, ref, out := filepath.Join(dir, "shot.png"), filepath.Join(dir, "ref.png"), filepath.Join(dir, "cmp.png")
	writeFilledPNG(t, shot, 100, 50, func(x, y int) color.Color {
		if x < 25 {
			return color.Black
		}
		return color.White
	})
	writeFilledPNG(t, ref, 100, 50, white)
	got := mustOK(t, e, "design", "compare", shot, ref, "--out", out)
	if r := got["diff_ratio"].(float64); r < 0.24 || r > 0.26 {
		t.Errorf("diff_ratio %v, want 0.25", r)
	}
	im, err := readPNG(out)
	if err != nil {
		t.Fatal(err)
	}
	if im.Bounds().Dx() < 300 || im.Bounds().Dy() < 50 {
		t.Errorf("size %v is not three panels", im.Bounds())
	}
}

func TestDesignCompareScalesACropOfTheReferenceToTheShot(t *testing.T) {
	e, _ := testEnv(t)
	dir := t.TempDir()
	shot, ref := filepath.Join(dir, "shot.png"), filepath.Join(dir, "ref.png")
	writeFilledPNG(t, shot, 40, 20, white)
	writeFilledPNG(t, ref, 300, 300, func(x, y int) color.Color {
		if x >= 100 && x < 200 && y >= 100 && y < 150 {
			return color.White
		}
		return color.Black
	})
	got := mustOK(t, e, "design", "compare", shot, ref, "--crop", "100,100,200,150", "--out", filepath.Join(dir, "o.png"))
	if got["diff_ratio"].(float64) != 0 {
		t.Errorf("diff_ratio %v, want 0", got["diff_ratio"])
	}
}

func TestDesignCompareTakesAFrameNumberAsTheReference(t *testing.T) {
	e, _ := testEnv(t)
	dir := t.TempDir()
	shot := filepath.Join(dir, "shot.png")
	writeFilledPNG(t, shot, 10, 10, white)
	writeFilledPNG(t, filepath.Join(e.repo, "docs/design/redesign/3.png"), 10, 10, white)
	got := mustOK(t, e, "design", "compare", shot, "3", "--out", filepath.Join(dir, "o.png"))
	if got["reference"] != filepath.Join(e.repo, "docs/design/redesign/3.png") {
		t.Errorf("reference %v", got["reference"])
	}
}

func TestDesignCompareFailsAboveMaxDiffButKeepsTheImage(t *testing.T) {
	e, _ := testEnv(t)
	dir := t.TempDir()
	shot, ref, out := filepath.Join(dir, "shot.png"), filepath.Join(dir, "ref.png"), filepath.Join(dir, "o.png")
	writeFilledPNG(t, shot, 10, 10, func(int, int) color.Color { return color.Black })
	writeFilledPNG(t, ref, 10, 10, white)
	got, code := runJSON(t, e, "design", "compare", shot, ref, "--max-diff", "0.1", "--out", out)
	if code != 1 {
		t.Errorf("exit %d", code)
	}
	if _, err := os.Stat(out); err != nil {
		t.Errorf("no compare image on a failure: %v", err)
	}
	if problemText(got) == "" {
		t.Error("no problem")
	}
}

func TestDesignCompareNeedsAShotAndAReference(t *testing.T) {
	e, _ := testEnv(t)
	if _, code := runJSON(t, e, "design", "compare", "only.png"); code != 2 {
		t.Errorf("exit %d", code)
	}
}
