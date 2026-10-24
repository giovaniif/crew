package daemon_test

import "sync"

type fakeTrust struct {
	mu      sync.Mutex
	trusted map[string]bool
}

func (f *fakeTrust) Trusted(dir string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.trusted[dir], nil
}

func (f *fakeTrust) TrustDir(dir string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.trusted == nil {
		f.trusted = map[string]bool{}
	}
	f.trusted[dir] = true
	return nil
}
