# Licensing & Releases

Two things you now run by hand: issuing licence keys, and cutting releases.

---

## Issuing a licence key

Keys are Ed25519-signed claims that a specific machine may run the app. Only
`keys/license-private.pem` can mint one, and the app verifies against the public
key compiled into `src/main/license/verify.ts`.

1. The user installs Phantom Pulse and lands on the activation screen.
2. They copy the **Machine ID** shown there (`XXXX-XXXX-XXXX-XXXX`) and send it to you.
3. You mint a key:

   ```bash
   npm run gen-key -- --machine 6CAC-5B1E-507C-33E7 --name "Mom"
   ```

   Optionally time-limit it:

   ```bash
   npm run gen-key -- --machine 6CAC-... --name "Trial" --expires 2027-01-01
   ```

4. Send them the `PP1....` string. They paste it in and are activated.

The key is stored locally and **re-verified on every launch** against the machine
it is running on — copying the config file to another PC gains nothing, because
the key names a machine.

### Two things to know

- **Back up `keys/`.** It is gitignored and exists only on this PC. Lose it and
  you can never issue another key for the current build. Regenerating the keypair
  invalidates every key already issued.
- **A Windows reinstall changes the Machine ID.** The old key stops verifying and
  the user needs a new one. That is the intended behaviour, but it means a wiped
  PC is a support request.

### Verifying the system still works

```bash
npm run test:license
```

Round-trips a minted key through the real `verify.ts` and asserts the rejection
paths — wrong machine, expired, tampered payload, garbage input.

---

## Cutting a release

**Pushing to `main` does not update anyone.** `electron-updater` polls GitHub
*Releases* for `latest.yml`; commits are invisible to it. To ship an update:

```bash
npm version patch      # or minor / major — bumps package.json, creates a tag
git push --follow-tags # pushes the commit AND the tag
```

The tag push triggers `.github/workflows/release.yml`, which builds on
`windows-latest` and publishes the installer plus `latest.yml` to a GitHub
Release. Installed copies pick it up on their next launch.

To build an installer locally without publishing:

```bash
npm run package        # → dist/Phantom-Pulse-Setup-<version>.exe
```

### Update behaviour

Set in Settings → Updates:

- **Ask** (default) — checks on launch, prompts before downloading.
- **Automatic** — downloads in the background, installs on quit.

Either way the check runs on every launch.

---

## Known gaps

- **The installer is unsigned.** Windows SmartScreen will warn about an unknown
  publisher on first install. Fixing this needs a code-signing certificate
  (~$200–400/yr), added to the workflow as `CSC_LINK` / `CSC_KEY_PASSWORD`.
- **Licence checks run client-side.** Keys cannot be forged without the private
  key, but a determined user can unpack the `asar` and patch the check out. This
  is true of all desktop licensing short of heavy DRM.
- **Activation is manual.** Fine for a couple of users. If this ever goes
  self-serve, the app side does not change: swap the "you run a script" step for
  a server that mints the same token format.
