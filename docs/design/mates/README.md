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
- A mate has one conversation (ADR [0064](../../adr/0064-one-conversation-per-mate.md)). Slack channel mentions, Slack DMs, automation runs and the app composer all go into it. Each message has a source tag: App, #channel, DM or Automation. The answer to a Slack message also goes back to its Slack thread or DM.
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

## Environments are machine plus identity (frames 11 and 12)

The owner approved frames 11 and 12 on 2026-10-23. They replace the environment part of frames 9a and 9b, the Settings › Servers pane of frame 5 and the server chip in the sidebar. [ADR 0063](../../adr/0063-environments-are-machine-plus-identity.md) has the model and the data. The Claude Design files are `11 Environments = machine + accounts.dc.html`, `12 Env first run and picker.dc.html` and `env.css`.

| File | Frames | What it shows |
|---|---|---|
| [env.css](env.css) | | The new classes for frames 11 and 12. It uses only the tokens of `crew.css`. |
| [11-environments.html](11-environments.html), [11.png](11.png) | 11a to 11h | Environments: machines, identities, + Machine, copy an identity, the phone |
| [12-first-run-picker.html](12-first-run-picker.html), [12.png](12.png) | 12a to 12g | The first run, the environment menu, the picker on the mate page, copy a mate, the model |

The HTML files open alone in a browser. They use `crew.css` and `canvas.css` from [../redesign/](../redesign/), and `mates.css` and `env.css` from this folder.

### Rules

1. An environment is one machine plus one identity. Its name is "machine · identity", for example "devbox · work-bot".
2. A machine is This Mac or a server that you connect over SSH. Each machine runs its own crew.
3. Each machine has one "Your accounts" identity. It is always there. It shows the logins that crew found. crew does not change them. You can add extra secret variables.
4. A separate identity has its own git name, SSH key, tokens and harness accounts. It is on one machine.
5. A mate has one environment. The mate is on the machine of that environment.
6. A mate does not move. The picker on the mate page shows only the environments on the same machine. To use a mate on a different machine, use "Copy to another machine…" in the ⋯ menu. crew makes a new mate on the target machine with the same role, memory and look, and an environment there. If the name is in use, crew gives a new name. The original mate stays.
7. You can copy a separate identity to a different machine. The git name, the tokens and the variables copy. The target machine makes a new SSH key. Add that key on GitHub.
8. The app shows one merged list of all machines. The "This computer ▾" switcher goes away. The phone pairs with each machine.
9. When no mates run on This Mac, This Mac is hidden.
10. Do not use the words "Local", "Custom" or "Servers" in the UI.
11. When crew runs on a server, the first run does not show "This Mac".

### Frame to screen

| Frame | Screen |
|---|---|
| 11a | Environments, a machine is selected: the connection and the found logins |
| 11b | The separate identity editor (it replaces the Custom editor, 9a) |
| 11c | Your accounts on This Mac (it replaces Local, 9b) |
| 11d | + Machine: connect a server over SSH (it replaces Settings › Servers) |
| 11g | Copy a separate identity to a different machine |
| 11h | The copied identity: a new SSH key to add on GitHub |
| 11e | Phone: the Environments list, grouped by machine |
| 11f | Phone: the machine detail |
| 12a | First run, step 1: where (This Mac or a server) |
| 12b | First run, step 2: the machine becomes "devbox · your accounts" |
| 12c | First run, step 3: the first mate, with the environment already selected |
| 12d | New mate: the environment menu, grouped by machine |
| 12e | The rail of the mate page: the picker states (server, identity, This Mac, login missing, not reachable, the open picker with the same machine only) |
| 12g | Copy a mate to a different machine (⋯ menu) |
| 12f | The model, the decisions and the word table |

Frame 5 (Settings and Servers) stays in the redesign for history. Do not build Settings › Servers. Use 11a and 11d.
