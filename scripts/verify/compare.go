package main

import (
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
)

var frameNumber = regexp.MustCompile(`^[1-9][0-9]?$`)

func design(e *env, args []string, r *result) {
	if len(args) == 0 || args[0] != "compare" {
		r.bad("design needs the subcommand compare", "go run ./scripts/verify design compare shot.png 1 --crop x0,y0,x1,y1 --out cmp.png")
		return
	}
	designCompare(e, args[1:], r)
}

func pixelDiffers(a, b color.Color) bool {
	ar, ag, ab, _ := a.RGBA()
	br, bg, bb, _ := b.RGBA()
	d := func(x, y uint32) uint32 {
		if x > y {
			return x - y
		}
		return y - x
	}
	const tol = 24 * 0x101
	return d(ar, br) > tol || d(ag, bg) > tol || d(ab, bb) > tol
}

func designCompare(e *env, args []string, r *result) {
	o, ok := parse(args, []string{"crop", "out", "max-diff"}, nil, r)
	if !ok {
		return
	}
	if len(o.pos) != 2 {
		r.bad("design compare needs a shot and a reference", "go run ./scripts/verify design compare shot.png <frame 1-6 or ref.png> [--crop x0,y0,x1,y1] [--out f] [--max-diff 0.2]")
		return
	}
	shotPath, ref := o.pos[0], o.pos[1]
	if frameNumber.MatchString(ref) {
		ref = filepath.Join(e.repo, "docs", "design", "redesign", ref+".png")
	}
	maxDiff := -1.0
	if m := o.get("max-diff", ""); m != "" {
		v, err := strconv.ParseFloat(m, 64)
		if err != nil || v < 0 || v > 1 {
			r.bad("--max-diff "+m+" is not a number from 0 to 1", "--max-diff 0.2")
			return
		}
		maxDiff = v
	}
	out := o.get("out", filepath.Join(filepath.Dir(shotPath), "design-compare.png"))
	shot, err := readPNG(shotPath)
	if err != nil {
		r.fail("cannot read "+shotPath+": "+err.Error(), "give a PNG")
		return
	}
	refImg, err := readPNG(ref)
	if err != nil {
		r.fail("cannot read "+ref+": "+err.Error(), "give a PNG or a frame number of docs/design/redesign")
		return
	}
	crop := refImg.Bounds()
	if c := o.get("crop", ""); c != "" {
		rc, err := parseRect(c)
		if err != nil {
			r.bad(err.Error(), "--crop x0,y0,x1,y1 in reference coordinates")
			return
		}
		if rc.Empty() || !rc.In(refImg.Bounds()) {
			r.fail(fmt.Sprintf("the crop %v is not inside the reference %v", rc, refImg.Bounds()), "use a crop inside the reference")
			return
		}
		crop = rc
	}
	sb := shot.Bounds()
	w, h := sb.Dx(), sb.Dy()
	scaled := image.NewRGBA(image.Rect(0, 0, w, h))
	diff := image.NewRGBA(image.Rect(0, 0, w, h))
	red := color.RGBA{0xd2, 0x0f, 0x39, 0xff}
	differ := 0
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			rc := refImg.At(crop.Min.X+x*crop.Dx()/w, crop.Min.Y+y*crop.Dy()/h)
			scaled.Set(x, y, rc)
			sc := shot.At(sb.Min.X+x, sb.Min.Y+y)
			if pixelDiffers(sc, rc) {
				differ++
				diff.Set(x, y, red)
			} else {
				cr, cg, cb, _ := sc.RGBA()
				g := uint8((cr + cg + cb) / 3 >> 8)
				g = 0xc0 + g/4
				diff.Set(x, y, color.RGBA{g, g, g, 0xff})
			}
		}
	}
	const gap, bar = 16, 40
	canvas := image.NewRGBA(image.Rect(0, 0, w*3+gap*4, h+bar+gap*2))
	draw.Draw(canvas, canvas.Bounds(), image.NewUniform(color.RGBA{0xef, 0xf1, 0xf5, 0xff}), image.Point{}, draw.Src)
	text := color.RGBA{0x4c, 0x4f, 0x69, 0xff}
	panels := []image.Image{shot, scaled, diff}
	origins := []image.Point{sb.Min, {}, {}}
	for i, caption := range []string{"Shot", "Design", "Diff"} {
		x0 := gap + i*(w+gap)
		draw.Draw(canvas, image.Rect(x0, bar+gap, x0+w, bar+gap+h), panels[i], origins[i], draw.Src)
		drawText(canvas, x0, gap/2+4, caption, text)
	}
	f, err := os.Create(out)
	if err != nil {
		r.fail(err.Error(), "check --out")
		return
	}
	if err := png.Encode(f, canvas); err != nil {
		_ = f.Close()
		r.fail(err.Error(), "check --out")
		return
	}
	_ = f.Close()
	ratio := 0.0
	if w*h > 0 {
		ratio = float64(differ) / float64(w*h)
	}
	r.set("out", out)
	r.set("reference", ref)
	r.set("crop", []int{crop.Min.X, crop.Min.Y, crop.Max.X, crop.Max.Y})
	r.set("size", []int{w, h})
	r.set("diff_ratio", ratio)
	if maxDiff >= 0 && ratio > maxDiff {
		r.fail(fmt.Sprintf("%.1f%% of the pixels differ from the design, more than %.1f%%", ratio*100, maxDiff*100), "open "+out+" and fix the red areas, or give a tighter --crop")
	}
}
