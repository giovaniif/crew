import { useEffect, useState } from "react";

export type CompleteDir = { Name: string };
export type Completion = { dir: string; dirs: CompleteDir[] | null };
export type Complete = (path: string) => Promise<Completion>;

export function pathSuggestions(typed: string, dirs: CompleteDir[]): string[] {
  if (!typed) {
    return [];
  }
  const head = typed.slice(0, typed.lastIndexOf("/") + 1);
  return dirs.map((d) => head + d.Name + "/");
}

export function usePathSuggestions(complete: Complete | null, text: string, delay = 150): string[] {
  const [found, setFound] = useState<string[]>([]);
  useEffect(() => {
    if (!complete || !text.trim()) {
      setFound([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      complete(text).then(
        (out) => live && setFound(pathSuggestions(text, out.dirs ?? [])),
        () => live && setFound([]),
      );
    }, delay);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [complete, text, delay]);
  return found;
}
