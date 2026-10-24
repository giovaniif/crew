import { createContext, useCallback, useContext } from "react";
import type { EnvInfo } from "../api";
import { envTitle } from "../envs";

export const MachineContext = createContext("this Mac");

export function useMachine(): string {
  return useContext(MachineContext);
}

export function useEnvTitle(): (e: EnvInfo) => string {
  const machine = useMachine();
  return useCallback((e: EnvInfo) => envTitle(e, machine), [machine]);
}
