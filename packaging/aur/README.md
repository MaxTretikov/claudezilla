# AUR packaging

This directory contains the [AUR](https://aur.archlinux.org) packaging for
Claudezilla, deployed automatically by `.github/workflows/aur-publish.yml`.

## Files

- `PKGBUILD.in` — PKGBUILD template. `@PKGVER@` and `@REPO@` are substituted
  by the workflow; `sha256sums` are filled in by `updpkgsums` during the run.
- `claudezilla.install` — pacman install hooks (post-install instructions).
- `claudezilla-setup` — per-user setup script shipped in the package as
  `/usr/bin/claudezilla-setup`. It configures `~/.claude` and creates the
  Firefox headless profile with the bundled XPI sideloaded.

## What the package installs

| Path | Purpose |
|---|---|
| `/usr/lib/claudezilla/host/` | Native messaging host |
| `/usr/lib/claudezilla/mcp/` | MCP server with vendored `node_modules` |
| `/usr/lib/claudezilla/claudezilla.xpi` | Built extension (unsigned) |
| `/usr/bin/claudezilla-host` | Native messaging host entry point |
| `/usr/bin/claudezilla-mcp` | MCP server entry point |
| `/usr/bin/claudezilla-setup` | Per-user setup |
| `/usr/lib/mozilla/native-messaging-hosts/claudezilla.json` | System-wide native messaging manifest |
| `/usr/lib/systemd/user/claudezilla-browser.service` | Headless browser user service |

## Releasing

Push a tag of the form `v<version>` (matching `package.json`), e.g.:

```
git tag v0.6.9
git push origin v0.6.9
```

The workflow builds the package from the tag's GitHub tarball, test-builds it
with `makepkg` in an Arch container, regenerates `.SRCINFO`, and pushes to the
`claudezilla` AUR repository. It can also be run manually from the Actions tab
(`workflow_dispatch`) against an existing tag.

## Required repository secrets

| Secret | Value |
|---|---|
| `AUR_USERNAME` | Your AUR account username |
| `AUR_EMAIL` | Email for the AUR git commits |
| `AUR_SSH_PRIVATE_KEY` | Private SSH key whose public half is registered in your AUR account |

Setup: create an account on aur.archlinux.org, generate a dedicated key with
`ssh-keygen -t ed25519 -f aur -C aur@github-actions`, paste `aur.pub` into
AUR → My Account → SSH Public Key, and add the private key file contents as
the `AUR_SSH_PRIVATE_KEY` secret. The first workflow run creates the AUR
package `claudezilla` (the name is unclaimed as of 2026-08).
