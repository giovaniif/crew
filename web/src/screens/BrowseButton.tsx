import { Button } from "../ui";

export type PickFolder = () => Promise<string | null>;

type Props = { pick: PickFolder; onPick: (path: string) => void; onError?: (message: string) => void };

export function BrowseButton({ pick, onPick, onError }: Props) {
  const browse = async () => {
    try {
      const path = await pick();
      if (path) {
        onPick(path);
      }
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    }
  };
  return <Button onClick={browse}>Browse…</Button>;
}
