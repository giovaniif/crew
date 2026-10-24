package daemon

import "testing"

func TestMachineNameIsCrewMachineNameWhenItIsSet(t *testing.T) {
	t.Setenv("CREW_MACHINE_NAME", "devbox")
	if got := machineName(); got != "devbox" {
		t.Errorf("machineName() = %q, want devbox", got)
	}
}
