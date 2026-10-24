package domain

import "strings"

type MateSource struct {
	Channel    string
	Automation string
}

type MateInput struct {
	Seat  MateSeat
	Reply MateThread
}

func MateConversation(sessions []Session, mate string) (Session, bool) {
	var best Session
	found := false
	for _, s := range sessions {
		if s.Mate == nil || s.Mate.Name != mate || s.Mate.History {
			continue
		}
		if !found || s.StartedAt.After(best.StartedAt) || (s.StartedAt.Equal(best.StartedAt) && s.ID > best.ID) {
			best, found = s, true
		}
	}
	return best, found
}

func MateTurnSeat(current, in MateSeat) MateSeat {
	next := in
	next.Name, next.Owner, next.FreshFrom, next.History = current.Name, current.Owner, current.FreshFrom, false
	if next.Local {
		next.Authority, next.Origin, next.Asked, next.Hops = current.Owner, "", nil, 0
	}
	return next
}

func MateSourcePrompt(src MateSource, text string) string {
	var tag string
	switch {
	case src.Automation != "":
		tag = "Automation " + src.Automation
	case strings.HasPrefix(src.Channel, "D"):
		tag = "DM"
	case src.Channel != "":
		tag = "#" + src.Channel
	default:
		return text
	}
	return "Source: " + tag + "\n\n" + text
}
