# MiraCode iOS Sideloading & Offline Model Guide

MiraCode iOS combines PocketPal AI's native Apple Metal `llama.rn` inference engine (with iOS Extended RAM entitlements) and MiraCode's split-screen AI coding studio, live offline React/Tailwind/HTML preview, full-screen preview toggle, and offline workspace storage.

---

## 1. Download `MiraCode-Sideload.ipa`

1. Open your GitHub repository (`FeAlias/MiraCode-iOS`) -> **Actions** -> **Build MiraCode Sideload IPA**.
2. Open the latest completed run on `main` (or trigger **Run workflow**).
3. Under **Artifacts**, download **MiraCode-Sideload-IPA** and unzip it to get `MiraCode-Sideload.ipa`.

---

## 2. Enable Developer Mode on iPhone (One-Time)

1. Open **Settings** -> **Privacy & Security** -> **Developer Mode** -> toggle **ON**.
2. Restart the iPhone when prompted and tap **Turn On** after reboot.
3. Also make sure iTunes / Apple Devices (on Windows) or Finder (on macOS) trusts your iPhone when connected over USB-C.

---

## 3. Sideloading & Cable-Free 7-Day Auto-Refresh

Free Apple ID certificates expire every 7 days. Pick either method below so you never have to plug the USB-C cable back in each week.

### Method A (Recommended): SideStore + LocalDevVPN + iOS Shortcuts (100% On-Device Auto-Refresh)

**One-time USB-C Setup (Windows or macOS):**
1. Install **iTunes** (non-Microsoft-Store installer on Windows) + **iCloud** or **AltServer**, OR use **SideServer** from `https://sidestore.io` to install **SideStore** onto your iPhone via USB-C.
2. Generate and import your pairing file following SideStore's first-time instructions (`JitStreamer / idevice_pair`).
3. On your iPhone, install **LocalDevVPN** (or **StosVPN**) from the App Store — it creates the local loopback VPN required by SideStore to re-sign apps without a computer.
4. Send `MiraCode-Sideload.ipa` to your iPhone (AirDrop, iCloud Drive, or USB-C Files), open **SideStore** -> **My Apps** -> **+** -> select `MiraCode-Sideload.ipa`.
   - Keep **App IDs / Extensions** when SideStore prompts you, so Extended RAM entitlements stay active.
5. Trust your Apple ID certificate under **Settings** -> **General** -> **VPN & Device Management**.

**Set Up Automatic Refresh (No USB-C Needed After Initial Install):**
1. Open Apple's built-in **Shortcuts** app -> **Automation** -> **+** -> **Time of Day** (e.g., 9:00 AM every 3 days, or Daily).
2. Choose **Run Immediately**.
3. Add actions:
   - **Connect VPN** -> select **LocalDevVPN** (or **StosVPN**).
   - **Wait** `3 seconds`.
   - **Refresh All Apps** (provided by SideStore).
4. Once installed, you can toggle off Developer Certificate prompts and refresh anywhere on Wi-Fi without touching your PC.

### Method B: Sideloadly (USB-C First Install + Automatic Wi-Fi Refresh)

1. Install **Sideloadly** on your Windows PC (`https://sideloadly.io`).
2. Plug your iPhone 17 Pro Max into your Windows PC via USB-C and tap **Trust**.
3. Drag `MiraCode-Sideload.ipa` into Sideloadly, enter your Apple ID, keep **Normal Install** and **Wi-Fi Refresh** checked, and click **Start**.
4. In Apple Devices / iTunes on Windows, make sure **"Sync with this iPhone over Wi-Fi"** is enabled so Sideloadly can automatically refresh MiraCode in the background whenever your iPhone and PC share home Wi-Fi.

---

## 4. Loading 3B & 7B Coding Models (Online or 100% Offline via USB-C)

MiraCode is configured with **Extended Memory Limit** + **Extended Virtual Addressing** and includes curated presets for your iPhone 17 Pro Max (12 GB unified RAM):

- **`Qwen2.5 Coder 7B Instruct (Q4_K_M)`** (~4.68 GB) — Best coding accuracy for multi-component React apps on 12 GB iPhone 17 Pro Max.
- **`Qwen2.5 Coder 3B Instruct (Q4_K_M)`** (~2.10 GB) — Faster token generation and lower heat for quick iterations.

### Option 1: Download Inside the App (Once on Wi-Fi)
1. Open MiraCode -> tap the **Model Pill** in the top bar (or open the left drawer -> **Models**).
2. Tap **Download** on **Qwen2.5 Coder 7B Instruct** or **Qwen2.5 Coder 3B Instruct**, then tap **Load**.
3. After downloading once, turn on Airplane Mode anytime — inference and live preview run 100% offline.

### Option 2: Transfer `.gguf` Files 100% Offline Over USB-C
`UIFileSharingEnabled` is enabled in `Info.plist`, so you can copy GGUF files directly from your computer without internet on your phone:
1. Download `qwen2.5-coder-7b-instruct-q4_k_m.gguf` or `qwen2.5-coder-3b-instruct-q4_k_m.gguf` on your PC.
2. Plug your iPhone into USB-C, open **Apple Devices** (Windows) or **Finder** (macOS) -> **Files** -> **MiraCode** -> drag in the `.gguf` file (or save it into **Files app -> On My iPhone -> MiraCode**).
3. In MiraCode -> **Models** -> **+ Add Local Model**, pick the `.gguf` file and tap **Load**.

