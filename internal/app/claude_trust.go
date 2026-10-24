package app

type ClaudeTrust interface {
	Trusted(dir string) (bool, error)
	TrustDir(dir string) error
}
