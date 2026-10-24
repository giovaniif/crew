package domain

type DaemonStarter int

const (
	StartFork DaemonStarter = iota
	StartSystemd
	StartLaunchd
)

type DaemonService struct {
	Installed bool
	Home      string
	Exec      string
}

func DaemonStart(goos string, svc DaemonService, home, self string) DaemonStarter {
	if !svc.Installed || svc.Home != home || svc.Exec != self {
		return StartFork
	}
	switch goos {
	case "linux":
		return StartSystemd
	case "darwin":
		return StartLaunchd
	}
	return StartFork
}
