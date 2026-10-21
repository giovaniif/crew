package serve

import (
	"net"
	"net/http"

	"github.com/giovaniif/crew/internal/rpc"
)

type handler = func(r *http.Request, d Daemon) (any, error)

func ownerOnly(h handler) handler {
	return func(r *http.Request, d Daemon) (any, error) {
		if !fromOwner(r) {
			return nil, &rpc.Error{Code: codeForbidden, Message: "only the owner device, the app on the computer that runs crew, can do this"}
		}
		return h(r, d)
	}
}

func fromOwner(r *http.Request) bool {
	addr := clientAddr(r)
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		host = addr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
