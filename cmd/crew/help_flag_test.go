package main

import (
	"bytes"
	"io"
	"strings"
	"testing"
)

func TestAHelpFlagInThePlaceOfTheArgumentPrintsTheUsage(t *testing.T) {
	startRemoteDaemon(t)
	for _, c := range []struct {
		args  []string
		usage string
	}{
		{[]string{"focus", "--help"}, "usage: crew focus"},
		{[]string{"focus", "-h"}, "usage: crew focus"},
		{[]string{"remote", "revoke", "--help"}, "usage: crew remote"},
		{[]string{"remote", "revoke", "-h"}, "usage: crew remote"},
		{[]string{"workspace", "add", "--help"}, "usage: crew workspace"},
		{[]string{"workspace", "remove", "-h"}, "usage: crew workspace"},
	} {
		var stderr bytes.Buffer
		if code := run(c.args, io.Discard, &stderr); code != 2 || !strings.Contains(stderr.String(), c.usage) {
			t.Errorf("%v: exit %d, stderr %q", c.args, code, stderr.String())
		}
	}
}
