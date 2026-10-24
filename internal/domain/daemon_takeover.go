package domain

import "strings"

type HeldLock int

const (
	HeldLockFail HeldLock = iota
	HeldLockExit
	HeldLockTakeOver
)

func OnHeldLock(underService, sameBuild bool) HeldLock {
	switch {
	case underService:
		return HeldLockTakeOver
	case sameBuild:
		return HeldLockExit
	}
	return HeldLockFail
}

func UnderService(goos string, env func(string) string, agentLabel string) bool {
	switch goos {
	case "linux":
		return env("INVOCATION_ID") != ""
	case "darwin":
		return env("XPC_SERVICE_NAME") == agentLabel
	}
	return false
}

func ReplacedBinary(exe string) bool { return strings.HasSuffix(exe, " (deleted)") }
