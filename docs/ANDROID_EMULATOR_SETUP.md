# Android emulator setup — for the first real Waggles call test

**Why this exists:** WAGGLES_EMULATOR_TEST1 wants the first real Waggles call run on
an Android emulator. The build box (this Windows 11 machine, 8 GB RAM) has **no
Android tooling installed** — measured 2026-09-29: no `ANDROID_HOME`/`ANDROID_SDK_ROOT`,
no `adb`, no `emulator`, no SDK at `%LOCALAPPDATA%\Android\Sdk`, no Android Studio in
`Program Files`, no AVD in `%USERPROFILE%\.android\avd`, no `java` on PATH. Installing
it is an owner action (multi-GB download, license acceptance, GUI). These are the
exact steps.

> **RAM reality (8 GB):** one AVD + Metro + the OS is already tight. A **two-AVD**
> call test will likely thrash or fail to launch the second emulator. Plan for a
> one-device test and read "What one device can and cannot prove" at the bottom
> BEFORE interpreting the result.

---

## 1. Install Android Studio (bundles the SDK + emulator + JDK)

1. Download **Android Studio** (latest stable) from
   https://developer.android.com/studio and run the installer.
2. Accept the default install path (`C:\Program Files\Android\Android Studio`).
3. On first launch, choose the **Standard** setup — it downloads the Android SDK,
   the platform tools (`adb`), the emulator, and a bundled JDK (JBR). Accept the SDK
   license when prompted.

This installs the SDK to `%LOCALAPPDATA%\Android\Sdk` by default.

## 2. Point the shell at the SDK

Set these (System → Environment Variables, or PowerShell as below), then open a NEW
terminal so they take effect:

```powershell
setx ANDROID_HOME  "$env:LOCALAPPDATA\Android\Sdk"
# add platform-tools (adb) + emulator to PATH:
setx PATH "$env:PATH;$env:LOCALAPPDATA\Android\Sdk\platform-tools;$env:LOCALAPPDATA\Android\Sdk\emulator"
```

Verify in the new terminal: `adb version` and `emulator -version` both print.

## 3. Create ONE AVD (Pixel, Google APIs, x86_64)

In Android Studio → **Device Manager** → **Create device**:
- Device: **Pixel 6** (or any Pixel).
- System image: a recent stable API level (e.g. **API 34**), **Google APIs**,
  **x86_64** ABI. (Google APIs — not "Google Play" — is enough and lighter.)
- Finish. Name it e.g. `Pixel_API34`.

Launch it once from Device Manager to confirm it boots.

## 4. Build + install the Waggles dev client against the fork

Waggles' native modules (LiveKit WebRTC, secure store) require a **dev build**, not
Expo Go. From the repo root, with the fork backend values set:

```powershell
$env:EXPO_PUBLIC_WAGGLES_HOST_URL = "https://<FORK_PROJECT_REF>.supabase.co"
$env:EXPO_PUBLIC_SUPABASE_ANON_KEY = "<fork project PUBLIC anon key only>"
npx expo run:android
```

`expo run:android` compiles the native app, installs it on the running AVD, and
starts Metro. (Only the **public anon key** — never a service-role key — goes in the
client, per the repo's secrets rule.)

## 5. What to record from the call test

Per WAGGLES_EMULATOR_TEST1, capture each of:
- LiveKit **token mint** OK (the `livekit-token` edge fn returns a token).
- **Room join** OK.
- **E2EE enabled** on the room (insertable-streams / RN E2EE key set — not a
  cleartext room).
- **Audio/video flows** between two participants.
- **No plaintext fallback** (the call refuses to proceed unencrypted).

## What one device can and cannot prove

If RAM only allows ONE emulator, a single-device test **can** prove: the app builds
and installs, sign-in + identity publish work, the `livekit-token` edge fn mints a
token, and a room can be created/joined by one participant with E2EE requested.

It **cannot** prove the thing the test is really for: that **two** participants
exchange **encrypted** audio/video and that there is no plaintext fallback — that is
inherently a two-party property. Two accounts on the *same* emulator, one after the
other, is **not** a valid two-party test (same WebRTC stack, same clock, no real
peer connection across the network). A real result needs either a second AVD (RAM
permitting) or a second physical device / a second machine.
