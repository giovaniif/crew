# Mates-first app design

This folder has the design of the app after the change to "mates first". The owner approved it on 2026-10-23. It adds to the approved redesign in [../redesign/](../redesign/README.md). Use the tokens and the controls of that redesign. Do not change them.

Claude Design project: <https://claude.ai/design/p/0b297492-6939-4049-b2a2-75e8d6501de3>. The new files are `7 Mates home.dc.html`, `8 Mate page and create.dc.html`, `9 Environments.dc.html`, `10 Sessions first run settings.dc.html` and `mates.css`. The old files 1 to 6 do not change.

## Files

| File | Frames | What it shows |
|---|---|---|
| [mates.css](mates.css) | | The new classes for these frames. It uses only the tokens of `crew.css`. |
| [7-mates-home.html](7-mates-home.html), [7.png](7.png) | 7a, 7b | The app shell with the new nav, and the Mates home (desktop and phone) |
| [8-mate-page-and-create.html](8-mate-page-and-create.html), [8.png](8.png) | 8a, 8b, 8c, 8d | The mate page, New mate, the mate conversation on the phone, and the mate settings sheet on the phone |
| [9-environments.html](9-environments.html), [9.png](9.png) | 9a, 9b, 9c, 9d | The Custom environment editor, the Local environment, the dialog to set a secret, and the confirm step for a new SSH key |
| [10-sessions-first-run-settings.html](10-sessions-first-run-settings.html), [10.png](10.png) | 10a to 10e | Sessions, first run (two steps and phone), Settings: Notifications |

Each frame also has its own PNG (`7a.png`, `8b.png` and so on). The HTML files open alone in a browser. They use `crew.css` and `canvas.css` from [../redesign/](../redesign/). The editable `.dc.html` files are in the Claude Design project.

## Rules

- The Mates home has no "Stop all" button.
- Mates come first. The Mates home is the default screen. Sessions is second. The TUI is gone.
- The nav order is: Mates, Sessions, Approvals, Automations, Environments, Disk. Settings is at the bottom.
- Use the tokens of `crew.css`. Base text is 13px. Controls are 28px high. The phone uses 44px touch targets.
- Do not use native controls. Use Select, Menu, Switch, Segmented, Radio and Dialog of frame 1d.
- Each mate card and mate row shows the harness tag and the environment badge. A grey square is Local. A blue square is Custom.
- A mate that needs you goes first. It has an amber card and a bar on the Mates home.
- Environments is an item in the nav. It is not in Settings.
- An environment is "Local (this Mac)" or "Custom". You select the kind only when you create the environment. The editor has no kind switch.
- Local is read-only. It shows what crew found on the Mac. It can keep extra secret variables. "Duplicate as Custom…" makes a Custom copy.
- Codex and Pi use only an API key in v1. Claude uses a setup token or an API key.
- Secrets are write-only. A secret row shows "set" or "not set". It gives Set, Replace and Remove. It never shows the value.
- The SSH key panel shows the public key, a Copy button and the steps to add the key on GitHub.
- "New key…" shows the new public key and a warning. The old key stays active until the user confirms that the new key is on GitHub (9d).
- Local sessions always use this Mac. The Sessions screen has no environment picker.
- A mate has one conversation (ADR [0063](../../adr/0063-one-conversation-per-mate.md)). Slack channel mentions, Slack DMs, automation runs and the app composer all go into it. Each message has a source tag: App, #channel, DM or Automation. The answer to a Slack message also goes back to its Slack thread or DM.
- Changed on 2026-10-23, after the frames: the mate page has no threads column (8a), and the phone has no thread chips (8c). The conversation fills the middle. The settings rail does not change. The PNG files still show the old threads; this text is correct.
- "Start fresh" is in the ⋯ menu of the mate header, with a confirm. It clears the context and starts a new conversation. The old conversation stays as history: the ⋯ menu lists it, and it opens with no composer.
- On the phone, the ⓘ button of a mate opens its settings as a sheet (8d).
- A change to a mate or to an environment applies when the next conversation starts. The UI tells this.
- In Settings, only the content scrolls. The nav is full height. A notification row has the label at left, and the banner switch and the sound Select at right.

## Map: frame to screen

| Frame | Screen | Replaces or adds |
|---|---|---|
| 7a | Mates home, desktop | `Desktop.tsx` sidebar and nav, `Mates.tsx` list |
| 7b | Mates home, phone | the phone tab bar and `Mates.tsx` |
| 8a | Mate page | `Mates.tsx` profile; the one conversation and the settings rail (no threads column) |
| 8b | New mate | the New mate wizard of `Mates.tsx` (frame 3b) |
| 8c | Mate conversation, phone | `Mates.tsx` conversation on the phone (no thread chips) |
| 8d | Mate settings sheet, phone | new sheet |
| 9a | Environment editor, Custom | new screen |
| 9b | Environment, Local | new screen |
| 9c | Set a secret | new dialog |
| 9d | New SSH key, confirm | new panel state |
| 10a | Sessions | `SessionList.tsx` and the old sidebar session rows |
| 10b, 10c | First run | `FirstRun.tsx` (frames 6a, 6b) |
| 10d | Settings: Notifications | `Settings.tsx` (frame 5b) |
| 10e | First run, phone | `FirstRun.tsx` on the phone |
