package domain

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

var (
	configWord = regexp.MustCompile(`^[A-Za-z0-9._:/\[\]-]+$`)
)

func ConfigKeys() []string {
	keys := []string{"fallback.threshold", "push.away_after", "mates.hop_limit", "mates.turns_per_hour", "mates.daily_turns", "mates.daily_tokens"}
	for _, h := range Harnesses() {
		keys = append(keys, "defaults."+string(h)+".model", "defaults."+string(h)+".effort")
	}
	return keys
}

func ConfigLiteral(key, value string) (string, error) {
	if !slices.Contains(ConfigKeys(), key) {
		return "", fmt.Errorf("%q is not a setting crew can change", key)
	}
	if value == "" {
		return "", nil
	}
	switch {
	case key == "fallback.threshold":
		return intLiteral(key, value, 0, 100)
	case strings.HasPrefix(key, "mates."):
		return intLiteral(key, value, 0, math.MaxInt32)
	case key == "push.away_after":
		d, err := time.ParseDuration(value)
		if err != nil || d < 0 {
			return "", fmt.Errorf("%s: %q is not a duration such as \"2m\" or \"0\"", key, value)
		}
	case strings.HasSuffix(key, ".effort"):
		h := Harness(strings.TrimSuffix(strings.TrimPrefix(key, "defaults."), ".effort"))
		if efforts := Spec(h).Efforts; !slices.Contains(efforts, value) {
			return "", fmt.Errorf("%s: %q is not one of %s", key, value, strings.Join(efforts, ", "))
		}
	default:
		if !configWord.MatchString(value) {
			return "", fmt.Errorf("%s: %q is not a model name", key, value)
		}
	}
	return `"` + value + `"`, nil
}

func intLiteral(key, value string, lo, hi int) (string, error) {
	n, err := strconv.Atoi(value)
	if err != nil || n < lo || n > hi {
		return "", errors.New(key + ": " + strconv.Quote(value) + " is not a whole number from " + strconv.Itoa(lo) + " to " + strconv.Itoa(hi))
	}
	return strconv.Itoa(n), nil
}

func SetTOMLValue(src, key, literal string) string {
	dot := strings.LastIndex(key, ".")
	table, name := key[:dot], key[dot+1:]
	lines := strings.SplitAfter(src, "\n")
	if lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	start, end := -1, len(lines)
	for i, l := range lines {
		header, ok := tomlHeader(l)
		if !ok {
			continue
		}
		if start >= 0 {
			end = i
			break
		}
		if header == table {
			start = i
		}
	}
	entry := name + " = " + literal + "\n"
	if start < 0 {
		if literal == "" {
			return src
		}
		out := src
		if out != "" && !strings.HasSuffix(out, "\n") {
			out += "\n"
		}
		if out != "" {
			out += "\n"
		}
		return out + "[" + table + "]\n" + entry
	}
	last := start
	for i := start + 1; i < end; i++ {
		trimmed := strings.TrimSpace(lines[i])
		if trimmed != "" && !strings.HasPrefix(trimmed, "#") {
			last = i
		}
		k, _, ok := strings.Cut(trimmed, "=")
		if !ok || strings.TrimSpace(k) != name {
			continue
		}
		if literal == "" {
			return strings.Join(slices.Delete(lines, i, i+1), "")
		}
		lines[i] = entry
		return strings.Join(lines, "")
	}
	if literal == "" {
		return src
	}
	if !strings.HasSuffix(lines[last], "\n") {
		lines[last] += "\n"
	}
	return strings.Join(slices.Insert(lines, last+1, entry), "")
}

func tomlHeader(line string) (string, bool) {
	t := strings.TrimSpace(line)
	if strings.HasPrefix(t, "[[") {
		return "", true
	}
	if !strings.HasPrefix(t, "[") {
		return "", false
	}
	closing := strings.Index(t, "]")
	if closing < 0 {
		return "", false
	}
	return strings.TrimSpace(t[1:closing]), true
}
