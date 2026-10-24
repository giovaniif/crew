package serve

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/giovaniif/crew/internal/rpc"
)

const (
	corsMethods = "GET, POST, DELETE, OPTIONS"
	corsHeaders = "Authorization, Content-Type"
	corsMaxAge  = "600"
)

func CheckAllowedOrigins(list []string) error {
	_, err := allowedOrigins(list)
	return err
}

func allowedOrigins(list []string) (map[string]bool, error) {
	out := map[string]bool{}
	for _, raw := range list {
		raw = strings.TrimSpace(raw)
		if strings.Contains(raw, "*") {
			return nil, fmt.Errorf("[serve] allowed_origins: %q is not allowed; list exact origins such as https://mac.example.ts.net", raw)
		}
		u, err := url.Parse(raw)
		if err == nil && (u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil) {
			return nil, fmt.Errorf("[serve] allowed_origins: %q is not an origin; give only the scheme, the host and the port", raw)
		}
		origin, err := originOf(raw)
		if err != nil {
			return nil, fmt.Errorf("[serve] allowed_origins: %q: %w", raw, err)
		}
		out[origin] = true
	}
	return out, nil
}

func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Origin")
		if header == "" || !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		origin, err := originOf(header)
		switch {
		case err == nil && s.allowed[origin]:
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", origin)
			h.Add("Vary", "Origin")
			if r.Method == http.MethodOptions {
				h.Set("Access-Control-Allow-Methods", corsMethods)
				h.Set("Access-Control-Allow-Headers", corsHeaders)
				h.Set("Access-Control-Max-Age", corsMaxAge)
				w.WriteHeader(http.StatusNoContent)
				return
			}
		case err == nil && (origin == s.origin || sameHost(origin, r.Host)):
		default:
			writeError(w, &rpc.Error{Code: codeForbidden, Message: "this Origin is not in [serve] allowed_origins"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func sameHost(origin, host string) bool {
	_, rest, ok := strings.Cut(origin, "://")
	return ok && strings.EqualFold(rest, host)
}
