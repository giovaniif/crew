package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

const (
	addBot = "xoxb-111-222-zzbotsecretzz"
	addApp = "xapp-1-A0-333-zzappsecretzz"
)

type recordedCall struct {
	method string
	params any
}

type fakeMateCaller struct {
	calls        []recordedCall
	existing     bool
	failSet      error
	mateNewAdded bool
}

func (f *fakeMateCaller) Call(_ context.Context, method string, params, out any) error {
	f.calls = append(f.calls, recordedCall{method, params})
	switch method {
	case rpc.MethodMateShow:
		if f.existing {
			return nil
		}
		return &rpc.Error{Code: rpc.CodeNotFound, Message: "no mate"}
	case rpc.MethodMateSetTokens:
		if f.failSet != nil {
			return f.failSet
		}
		data, _ := json.Marshal(rpc.MateTokenStatus{Name: params.(rpc.MateSetTokensParams).Name, HasBotToken: true, HasAppToken: true})
		return json.Unmarshal(data, out)
	case rpc.MethodMateNew:
		data, _ := json.Marshal(rpc.MateNewResult{Session: domain.Session{ID: "s-1", Mate: &domain.MateSeat{Name: params.(rpc.MateNewParams).Name, Local: true}}, Added: f.mateNewAdded})
		return json.Unmarshal(data, out)
	case rpc.MethodMateClaim:
		data, _ := json.Marshal(rpc.MateClaim{Name: params.(rpc.MateClaimParams).Name, Code: "ABCD2345", ExpiresAt: time.Date(2026, 10, 14, 9, 10, 0, 0, time.UTC)})
		return json.Unmarshal(data, out)
	}
	return nil
}

func (f *fakeMateCaller) methods() []string {
	var out []string
	for _, c := range f.calls {
		out = append(out, c.method)
	}
	return out
}

type addRig struct {
	out     bytes.Buffer
	opened  []string
	openErr error
	asked   []string
	secrets []string
}

func (r *addRig) io() mateAddIO {
	return mateAddIO{
		Out: &r.out,
		Open: func(url string) error {
			r.opened = append(r.opened, url)
			return r.openErr
		},
		ReadSecret: func(label string) (string, error) {
			r.asked = append(r.asked, label)
			if len(r.secrets) == 0 {
				return "", errors.New("no more input")
			}
			s := r.secrets[0]
			r.secrets = r.secrets[1:]
			return s, nil
		},
	}
}

func TestMateAddWritesTheDefinitionAndAsksForNoSlackTokens(t *testing.T) {
	c := &fakeMateCaller{}
	rig := &addRig{}
	if err := mateAdd(context.Background(), c, rig.io(), "demo", mateAddOptions{}); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(c.methods(), " "); got != "mate.show mate.set" {
		t.Fatalf("calls: %s", got)
	}
	set := c.calls[1].params.(rpc.MateSetParams).Mate
	if set.Name != "demo" || set.Agent != "claude" || !set.Enabled || strings.TrimSpace(set.Prompt) == "" {
		t.Errorf("mate %+v", set)
	}
	if len(rig.asked) != 0 || len(rig.opened) != 0 {
		t.Errorf("asked %v, opened %v", rig.asked, rig.opened)
	}
	text := rig.out.String()
	for _, want := range []string{"crew mate new demo", "crew mate slack demo"} {
		if !strings.Contains(text, want) {
			t.Errorf("the output lacks %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "manifest") {
		t.Errorf("add shows no Slack manifest:\n%s", text)
	}
}

func TestMateSlackShowsTheManifestAndStoresTheTokens(t *testing.T) {
	c := &fakeMateCaller{existing: true}
	rig := &addRig{secrets: []string{addBot, addApp}}
	if err := mateSlack(context.Background(), c, rig.io(), "demo", false); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(c.methods(), " "); got != "mate.show mate.set_tokens mate.claim" {
		t.Fatalf("calls: %s", got)
	}
	tokens := c.calls[1].params.(rpc.MateSetTokensParams)
	if tokens != (rpc.MateSetTokensParams{Name: "demo", BotToken: addBot, AppToken: addApp}) {
		t.Errorf("tokens %+v", tokens)
	}
	text := rig.out.String()
	manifest := domain.MateManifest(domain.Mate{Name: "demo"})
	link := domain.MateManifestURL(manifest)
	if !strings.Contains(text, manifest) || !strings.Contains(text, link) {
		t.Errorf("the output lacks the manifest or the link:\n%s", text)
	}
	if len(rig.opened) != 1 || rig.opened[0] != link {
		t.Errorf("opened %v", rig.opened)
	}
	if strings.Contains(text, "zz") {
		t.Errorf("the output shows a token:\n%s", text)
	}
	if len(rig.asked) != 2 || !strings.Contains(rig.asked[0], "xoxb-") || !strings.Contains(rig.asked[1], "xapp-") {
		t.Errorf("asked %v", rig.asked)
	}
}

func TestMateSlackOfAnUnknownMateFails(t *testing.T) {
	c := &fakeMateCaller{}
	if err := mateSlack(context.Background(), c, (&addRig{}).io(), "demo", true); err == nil {
		t.Fatal("no error")
	}
	if got := strings.Join(c.methods(), " "); got != "mate.show" {
		t.Errorf("calls: %s", got)
	}
}

func TestMateAddUsesTheAgentAndPromptOfTheFlags(t *testing.T) {
	c := &fakeMateCaller{}
	rig := &addRig{}
	opts := mateAddOptions{Agent: "codex", Prompt: "Review PRs."}
	if err := mateAdd(context.Background(), c, rig.io(), "demo", opts); err != nil {
		t.Fatal(err)
	}
	set := c.calls[1].params.(rpc.MateSetParams).Mate
	if set.Agent != "codex" || set.Prompt != "Review PRs." {
		t.Errorf("mate %+v", set)
	}
}

func TestMateAddRefusesAMateThatExists(t *testing.T) {
	c := &fakeMateCaller{existing: true}
	rig := &addRig{secrets: []string{addBot, addApp}}
	err := mateAdd(context.Background(), c, rig.io(), "demo", mateAddOptions{})
	if err == nil || !strings.Contains(err.Error(), "crew mate set") {
		t.Fatalf("err = %v", err)
	}
	if got := strings.Join(c.methods(), " "); got != "mate.show" {
		t.Errorf("calls: %s", got)
	}
}

func TestMateSlackWithNoOpenOnlyPrintsTheLink(t *testing.T) {
	c := &fakeMateCaller{existing: true}
	rig := &addRig{secrets: []string{addBot, addApp}}
	if err := mateSlack(context.Background(), c, rig.io(), "demo", true); err != nil {
		t.Fatal(err)
	}
	if len(rig.opened) != 0 {
		t.Errorf("opened %v", rig.opened)
	}
}

func TestMateSlackGoesOnWhenTheLinkCannotOpen(t *testing.T) {
	c := &fakeMateCaller{existing: true}
	rig := &addRig{secrets: []string{addBot, addApp}, openErr: errors.New("no browser")}
	if err := mateSlack(context.Background(), c, rig.io(), "demo", false); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(rig.out.String(), "open this link") {
		t.Errorf("the output does not tell the user to open the link:\n%s", rig.out.String())
	}
}

func TestMateSlackKeepsTheMateWhenATokenIsWrongAndNeverEchoesIt(t *testing.T) {
	c := &fakeMateCaller{existing: true, failSet: &rpc.Error{Code: rpc.CodeBadRequest, Message: "the bot token must start with xoxb-"}}
	rig := &addRig{secrets: []string{addApp, addBot}}
	err := mateSlack(context.Background(), c, rig.io(), "demo", true)
	if err == nil || !strings.Contains(err.Error(), "crew mate tokens demo") {
		t.Fatalf("err = %v", err)
	}
	if strings.Contains(err.Error(), "zz") || strings.Contains(rig.out.String(), "zz") {
		t.Error("a token is in the output")
	}
}

func TestMateTokensAsksForBothTokensOfAnExistingMate(t *testing.T) {
	c := &fakeMateCaller{existing: true}
	rig := &addRig{secrets: []string{addBot, addApp}}
	if err := mateTokens(context.Background(), c, rig.io(), "demo", false); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(c.methods(), " "); got != "mate.show mate.set_tokens mate.claim" {
		t.Errorf("calls: %s", got)
	}
}

func TestMateTokensClearAsksForNothing(t *testing.T) {
	c := &fakeMateCaller{existing: true}
	rig := &addRig{}
	if err := mateTokens(context.Background(), c, rig.io(), "demo", true); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(c.methods(), " "); got != "mate.clear_tokens" {
		t.Errorf("calls: %s", got)
	}
	if len(rig.asked) != 0 {
		t.Errorf("asked %v", rig.asked)
	}
}

func TestParseMateAddTakesANameAndFlagsInAnyOrder(t *testing.T) {
	name, opts, err := parseMateAdd([]string{"demo", "--agent", "codex", "--prompt", "Hi."})
	if err != nil || name != "demo" || opts != (mateAddOptions{Agent: "codex", Prompt: "Hi."}) {
		t.Errorf("got %q %+v %v", name, opts, err)
	}
	name, opts, err = parseMateAdd([]string{"--prompt", "Hi.", "demo"})
	if err != nil || name != "demo" || opts.Prompt != "Hi." {
		t.Errorf("got %q %+v %v", name, opts, err)
	}
	for _, args := range [][]string{{}, {"--prompt", "x"}, {"a", "b"}, {"a", "--bogus"}, {"a", "--no-open"}} {
		if _, _, err := parseMateAdd(args); err == nil {
			t.Errorf("%v: no error", args)
		}
	}
}

func TestLineSecretReaderReadsOneLinePerTokenAndTrimsIt(t *testing.T) {
	in := bufio.NewReader(strings.NewReader("  " + addBot + " \n" + addApp + "\n"))
	read := lineSecretReader(in, &bytes.Buffer{})
	for _, want := range []string{addBot, addApp} {
		got, err := read("token")
		if err != nil || got != want {
			t.Errorf("got %q, %v", got, err)
		}
	}
	if _, err := read("token"); err == nil {
		t.Error("no error at the end of the input")
	}
}

func TestMateSlackShowsTheClaimCodeAfterTheTokens(t *testing.T) {
	c := &fakeMateCaller{existing: true}
	rig := &addRig{secrets: []string{addBot, addApp}}
	if err := mateSlack(context.Background(), c, rig.io(), "demo", true); err != nil {
		t.Fatal(err)
	}
	text := rig.out.String()
	if !strings.Contains(text, "ABCD2345") || !strings.Contains(text, "direct message") || strings.Index(text, "stored the tokens") > strings.Index(text, "ABCD2345") {
		t.Errorf("the output lacks the claim step:\n%s", text)
	}
}

func TestMateClaimPrintsTheCodeAndHowToSendIt(t *testing.T) {
	c := &fakeMateCaller{}
	var out bytes.Buffer
	if err := mateClaim(context.Background(), c, &out, "demo"); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(c.methods(), " "); got != "mate.claim" {
		t.Errorf("calls: %s", got)
	}
	text := out.String()
	for _, want := range []string{"ABCD2345", "@demo", "direct message", "10 minutes"} {
		if !strings.Contains(text, want) {
			t.Errorf("the output lacks %q:\n%s", want, text)
		}
	}
}

func TestRunMateAddAndTokensNeedAName(t *testing.T) {
	for _, args := range [][]string{{"add"}, {"tokens"}, {"claim"}, {"claim", "a", "b"}, {"add", "a", "b"}, {"tokens", "a", "--bogus"}, {"slack"}, {"slack", "a", "--bogus"}, {"new"}, {"memory"}} {
		var out, errOut bytes.Buffer
		if code := runMate(args, &out, &errOut); code != 2 || !strings.Contains(errOut.String(), "usage: crew mate") {
			t.Errorf("%v: code %d, stderr %q", args, code, errOut.String())
		}
	}
}

func TestParseMateNewTakesARepoAndTheRestAsText(t *testing.T) {
	cases := []struct {
		args []string
		want rpc.MateNewParams
		ok   bool
	}{
		{[]string{"demo"}, rpc.MateNewParams{Name: "demo"}, true},
		{[]string{"demo", "fix", "the", "bug"}, rpc.MateNewParams{Name: "demo", Prompt: "fix the bug"}, true},
		{[]string{"--repo", "api", "demo", "fix it"}, rpc.MateNewParams{Name: "demo", Repo: "api", Prompt: "fix it"}, true},
		{[]string{"demo", "--repo", "api"}, rpc.MateNewParams{Name: "demo", Repo: "api"}, true},
		{[]string{}, rpc.MateNewParams{}, false},
		{[]string{"--bogus", "demo"}, rpc.MateNewParams{}, false},
	}
	for _, tc := range cases {
		got, err := parseMateNew(tc.args)
		if (err == nil) != tc.ok || (tc.ok && got != tc.want) {
			t.Errorf("%v: got %+v %v", tc.args, got, err)
		}
	}
}

func TestMateNewSaysWhenItAddsToTheConversation(t *testing.T) {
	c := &fakeMateCaller{mateNewAdded: true}
	var out bytes.Buffer
	if err := mateNew(context.Background(), c, &out, rpc.MateNewParams{Name: "demo", Prompt: "hi"}); err != nil {
		t.Fatal(err)
	}
	if got := out.String(); got != "added to the conversation with demo: session s-1\n" {
		t.Errorf("output %q", got)
	}
}

func TestMateNewStartsAConversationAndPrintsTheSession(t *testing.T) {
	c := &fakeMateCaller{}
	var out bytes.Buffer
	if err := mateNew(context.Background(), c, &out, rpc.MateNewParams{Name: "demo", Prompt: "hi"}); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(c.methods(), " "); got != "mate.new" {
		t.Fatalf("calls: %s", got)
	}
	if p := c.calls[0].params.(rpc.MateNewParams); p != (rpc.MateNewParams{Name: "demo", Prompt: "hi"}) {
		t.Errorf("params %+v", p)
	}
	if !strings.Contains(out.String(), "demo") || !strings.Contains(out.String(), "s-1") {
		t.Errorf("output %q", out.String())
	}
}

func TestMateFromFlagsSetsTheAvatarAndTheColor(t *testing.T) {
	m, err := mateFromFlags(domain.Mate{Name: "demo"}, []string{"--avatar", "robot-2", "--color", "#3a7bd5"})
	if err != nil || m.Avatar != "robot-2" || m.Color != "#3a7bd5" {
		t.Fatalf("mate %+v %v", m, err)
	}
	m, err = mateFromFlags(m, []string{"--avatar", ""})
	if err != nil || m.Avatar != "" || m.Color != "#3a7bd5" {
		t.Fatalf("mate %+v %v", m, err)
	}
}
