package domain

import (
	"bytes"
	"crypto/ecdh"
	"crypto/rand"
	"errors"
	"reflect"
	"testing"
	"time"
)

func copyKey(t *testing.T) *ecdh.PrivateKey {
	t.Helper()
	k, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return k
}

func testBundle() IdentityBundle {
	return IdentityBundle{
		Identity: Environment{Name: "bot", Label: "bot", Kind: EnvCustom, Parts: []EnvPart{EnvGit, EnvGitHub}, Extra: []string{"TEST_X"}},
		GitName:  "TEST Bot", GitEmail: "bot@example.com",
		Secrets: map[string]string{"GH_TOKEN": "TEST-zzghzz", "TEST_X": "TEST-zzxzz"},
	}
}

func TestSealedIdentityBundleOpensOnlyWithItsKey(t *testing.T) {
	key, other := copyKey(t), copyKey(t)
	sealed, err := SealIdentityBundle(key.PublicKey().Bytes(), testBundle(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(sealed, []byte("zzghzz")) || bytes.Contains(sealed, []byte("TEST Bot")) {
		t.Fatal("the sealed bundle shows a value")
	}
	got, err := OpenIdentityBundle(key.Bytes(), sealed)
	if err != nil || !reflect.DeepEqual(got, testBundle()) {
		t.Fatalf("open %+v %v", got, err)
	}
	if _, err := OpenIdentityBundle(other.Bytes(), sealed); err == nil {
		t.Fatal("a wrong key opened the bundle")
	}
	bad := bytes.Clone(sealed)
	bad[len(bad)-1] ^= 1
	if _, err := OpenIdentityBundle(key.Bytes(), bad); err == nil {
		t.Fatal("a changed bundle opened")
	}
	if _, err := OpenIdentityBundle(key.Bytes(), sealed[:10]); err == nil {
		t.Fatal("a short bundle opened")
	}
	if _, err := SealIdentityBundle([]byte("short"), testBundle(), rand.Reader); err == nil {
		t.Fatal("sealed to a bad public key")
	}
}

func TestCopyKeysAreForOneUseAndFiveMinutes(t *testing.T) {
	now := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
	keys := NewCopyKeys()
	keys.Begin("c1", []byte("k1"), now)
	keys.Begin("c2", []byte("k2"), now)
	keys.Begin("c3", []byte("k3"), now)
	cases := []struct {
		id   string
		at   time.Time
		want []byte
		err  error
	}{
		{"nope", now, nil, ErrCopyUnknown},
		{"c1", now.Add(IdentityCopyTTL - time.Second), []byte("k1"), nil},
		{"c1", now, nil, ErrCopyUnknown},
		{"c2", now.Add(IdentityCopyTTL), nil, ErrCopyExpired},
		{"c2", now, nil, ErrCopyUnknown},
		{"c3", now.Add(IdentityCopyTTL + time.Second), nil, ErrCopyExpired},
	}
	for i, tc := range cases {
		got, err := keys.Take(tc.id, tc.at)
		if !errors.Is(err, tc.err) || !bytes.Equal(got, tc.want) {
			t.Errorf("%d %s: got %q %v, want %q %v", i, tc.id, got, err, tc.want, tc.err)
		}
	}
}

func TestCopyKeysDropExpiredKeysOnBegin(t *testing.T) {
	now := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
	keys := NewCopyKeys()
	keys.Begin("old", []byte("k"), now)
	keys.Begin("new", []byte("k"), now.Add(IdentityCopyTTL+time.Second))
	if _, err := keys.Take("old", now); !errors.Is(err, ErrCopyUnknown) {
		t.Fatalf("old key stays: %v", err)
	}
}
