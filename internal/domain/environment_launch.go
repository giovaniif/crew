package domain

func CodexEnvHookTrustArgs() []string {
	return []string{"--dangerously-bypass-hook-trust"}
}

func EnvLaunchCommand(crew, env string, harness Harness, command []string) []string {
	if env == "" || len(command) == 0 {
		return command
	}
	out := []string{crew, "env", "exec", env, "--", command[0]}
	rest := command[1:]
	if harness == HarnessCodex {
		if len(rest) > 0 && rest[0] == "resume" {
			out = append(out, "resume")
			rest = rest[1:]
		}
		out = append(out, CodexEnvHookTrustArgs()...)
	}
	return append(out, rest...)
}
