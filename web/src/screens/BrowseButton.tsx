import { Button } from "../ui";

export type PickFolder = (near?: string) => Promise<string | null>;

type Props = { pick: PickFolder; near?: string; onPick: (path: string) => void; onError?: (message: string) => void };

export function BrowseButton({ pick, near, onPick, onError }: Props) {
  const browse = async () => {
    document.documentElement.dataset.picking = "true";
    try {
      const path = await pick(near);
      if (path) {
        onPick(path);
      }
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      delete document.documentElement.dataset.picking;
    }
  };
  return <Button onClick={browse}>Browse…</Button>;
}
