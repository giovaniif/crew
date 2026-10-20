package serve

import (
	"encoding/json"
	"net"
	"net/http"
	"strconv"
	"strings"

	"github.com/giovaniif/crew/internal/domain"
	"github.com/giovaniif/crew/internal/rpc"
)

func listAutomations(r *http.Request, d Daemon) (any, error) {
	var out rpc.AutomationList
	if err := d.Call(r.Context(), rpc.MethodAutomationList, rpc.AutomationListParams{}, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func runAutomation(r *http.Request, d Daemon) (any, error) {
	var body struct {
		Context  string `json:"context"`
		WorkItem string `json:"work_item"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, maxBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		return nil, &rpc.Error{Code: rpc.CodeBadRequest, Message: "the body takes only context and work_item: " + err.Error()}
	}
	p := rpc.AutomationRunParams{Name: r.PathValue("name"), Context: body.Context, WorkItem: body.WorkItem}
	var out rpc.AutomationRunResult
	if err := d.Call(r.Context(), rpc.MethodAutomationRun, p, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func ownerOnly(h func(r *http.Request, d Daemon) (any, error)) func(r *http.Request, d Daemon) (any, error) {
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

func saveAutomation(r *http.Request, d Daemon) (any, error) {
	var p rpc.AutomationSaveParams
	if err := decodeOne(r, &p, "automation"); err != nil {
		return nil, err
	}
	if strings.TrimSpace(p.Automation.Name) == "" {
		return nil, &rpc.Error{Code: rpc.CodeBadRequest, Message: "the automation needs a name"}
	}
	var out domain.Automation
	if err := d.Call(r.Context(), rpc.MethodAutomationSave, p, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func rerunAutomation(r *http.Request, d Daemon) (any, error) {
	var out rpc.AutomationRunResult
	if err := d.Call(r.Context(), rpc.MethodAutomationRun, rpc.AutomationRunParams{Rerun: r.PathValue("id")}, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func automationRuns(r *http.Request, d Daemon) (any, error) {
	q := r.URL.Query()
	p := rpc.AutomationRunsParams{Name: q.Get("name")}
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			return nil, &rpc.Error{Code: rpc.CodeBadRequest, Message: "limit is a number of runs: " + v}
		}
		p.Limit = n
	}
	var out rpc.AutomationRuns
	if err := d.Call(r.Context(), rpc.MethodAutomationRuns, p, &out); err != nil {
		return nil, err
	}
	if out.Runs == nil {
		out.Runs = []domain.AutomationRun{}
	}
	return out, nil
}
