package domain

import "fmt"

type DaemonUnit struct {
	ExecPath   string
	ExecExists bool
	Self       string
	Active     string
	Sub        string
	Restarts   int
	MainStatus int
}

func DaemonUnitHealth(u DaemonUnit) (execOK bool, reason string) {
	switch {
	case u.ExecPath == "":
		return false, "the service has no ExecStart binary"
	case !u.ExecExists:
		return false, fmt.Sprintf("the service runs %s, which does not exist", u.ExecPath)
	case u.ExecPath != u.Self:
		return false, fmt.Sprintf("the service runs %s, not this crew (%s)", u.ExecPath, u.Self)
	}
	switch {
	case u.Active == "activating" && u.Sub == "auto-restart", u.Restarts > 0 && u.MainStatus != 0:
		return true, fmt.Sprintf("the daemon stops at start, and systemd restarts it again and again (%d restarts, exit status %d)", u.Restarts, u.MainStatus)
	case u.Active == "failed":
		return true, fmt.Sprintf("the daemon stopped with exit status %d", u.MainStatus)
	}
	return true, ""
}
