package domain

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"time"
)

const (
	IdentityCopyTTL     = 5 * time.Minute
	identityCopyInfo    = "crew identity copy v1"
	identityCopyKeySize = 32
	identityCopyNonce   = 12
)

var (
	ErrCopyUnknown = errors.New("no such copy: start the copy again")
	ErrCopyExpired = errors.New("the copy expired: start the copy again")
	ErrCopyBundle  = errors.New("the bundle does not open with the key of this copy")
)

type IdentityBundle struct {
	Identity Environment       `json:"identity"`
	GitName  string            `json:"git_name,omitempty"`
	GitEmail string            `json:"git_email,omitempty"`
	Secrets  map[string]string `json:"secrets,omitempty"`
}

func identityCopyKey(shared, ephemeral, recipient []byte) ([]byte, error) {
	salt := append(append([]byte{}, ephemeral...), recipient...)
	return hkdf.Key(sha256.New, shared, salt, identityCopyInfo, identityCopyKeySize)
}

func identityCopyAEAD(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func SealIdentityBundle(recipient []byte, b IdentityBundle, random io.Reader) ([]byte, error) {
	pub, err := ecdh.X25519().NewPublicKey(recipient)
	if err != nil {
		return nil, err
	}
	eph, err := ecdh.X25519().GenerateKey(random)
	if err != nil {
		return nil, err
	}
	shared, err := eph.ECDH(pub)
	if err != nil {
		return nil, err
	}
	key, err := identityCopyKey(shared, eph.PublicKey().Bytes(), recipient)
	if err != nil {
		return nil, err
	}
	aead, err := identityCopyAEAD(key)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, identityCopyNonce)
	if _, err := io.ReadFull(random, nonce); err != nil {
		return nil, err
	}
	plain, err := json.Marshal(b)
	if err != nil {
		return nil, err
	}
	out := append(append([]byte{}, eph.PublicKey().Bytes()...), nonce...)
	return aead.Seal(out, nonce, plain, out), nil
}

func OpenIdentityBundle(private, sealed []byte) (IdentityBundle, error) {
	var b IdentityBundle
	priv, err := ecdh.X25519().NewPrivateKey(private)
	if err != nil {
		return b, err
	}
	head := identityCopyKeySize + identityCopyNonce
	if len(sealed) <= head {
		return b, ErrCopyBundle
	}
	pub, err := ecdh.X25519().NewPublicKey(sealed[:identityCopyKeySize])
	if err != nil {
		return b, ErrCopyBundle
	}
	shared, err := priv.ECDH(pub)
	if err != nil {
		return b, ErrCopyBundle
	}
	key, err := identityCopyKey(shared, sealed[:identityCopyKeySize], priv.PublicKey().Bytes())
	if err != nil {
		return b, err
	}
	aead, err := identityCopyAEAD(key)
	if err != nil {
		return b, err
	}
	plain, err := aead.Open(nil, sealed[identityCopyKeySize:head], sealed[head:], sealed[:head])
	if err != nil {
		return b, ErrCopyBundle
	}
	if err := json.Unmarshal(plain, &b); err != nil {
		return IdentityBundle{}, ErrCopyBundle
	}
	return b, nil
}

type copySlot struct {
	key     []byte
	expires time.Time
}

type CopyKeys struct {
	keys map[string]copySlot
}

func NewCopyKeys() *CopyKeys {
	return &CopyKeys{keys: map[string]copySlot{}}
}

func (c *CopyKeys) Begin(id string, key []byte, now time.Time) {
	for k, v := range c.keys {
		if !now.Before(v.expires) {
			delete(c.keys, k)
		}
	}
	c.keys[id] = copySlot{key: key, expires: now.Add(IdentityCopyTTL)}
}

func (c *CopyKeys) Take(id string, now time.Time) ([]byte, error) {
	k, ok := c.keys[id]
	if !ok {
		return nil, ErrCopyUnknown
	}
	delete(c.keys, id)
	if !now.Before(k.expires) {
		return nil, ErrCopyExpired
	}
	return k.key, nil
}
