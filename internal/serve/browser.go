package serve

import (
	"net/http"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

func headlessView(r *http.Request, d Daemon) (any, error) {
	var out rpc.BrowserHeadlessView
	if err := d.Call(r.Context(), rpc.MethodBrowserHeadlessView, rpc.BrowserHeadlessViewParams{Session: r.PathValue("id")}, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func importCookies(r *http.Request, d Daemon) (any, error) {
	var p struct {
		File string `json:"file"`
	}
	if err := decodeOne(r, &p, "file"); err != nil {
		return nil, err
	}
	cookies, err := domain.ParseCookieFile([]byte(p.File))
	if err != nil {
		return nil, &rpc.Error{Code: rpc.CodeBadRequest, Message: err.Error()}
	}
	var out rpc.BrowserCookiesResult
	if err := d.Call(r.Context(), rpc.MethodBrowserCookiesImport, rpc.BrowserCookiesParams{Cookies: cookies}, &out); err != nil {
		return nil, err
	}
	return out, nil
}
