# Dawa — Play Store Assets Checklist

Use this checklist to prepare and upload all required assets to Google Play Console.

---

## App Icon

- [ ] **Size:** 512 × 512 px
- [ ] **Format:** PNG, no transparency
- [ ] **Target file:** `assets/images/play-store-icon.png`
- [ ] Uploaded to Play Console → Store Listing → App Icon

---

## Feature Graphic

Shown at the top of the store listing page.

- [ ] **Size:** 1024 × 500 px
- [ ] **Format:** JPG or PNG
- [ ] **Content:** Dawa logo centered on Hero Gradient (#1A4598 → #00BFA5, left to right)
- [ ] **Target file:** `assets/images/feature-graphic.png`
- [ ] Uploaded to Play Console → Store Listing → Feature Graphic

---

## Screenshots (minimum 2, maximum 8)

- [ ] **Size:** minimum 320 px, maximum 3840 px on any side
- [ ] **Format:** JPG or PNG
- [ ] **Aspect ratio:** must be between 16:9 and 9:16

### Required Screens to Screenshot

| # | Screen | Description |
|---|---|---|
| 1 | Splash Screen | Dark navy background with Dawa logo and glow effects |
| 2 | Browse Doctors | Doctor listing cards with search/filter |
| 3 | Doctor Profile | Full doctor profile with consultation type options |
| 4 | Chat Consultation | Active chat session with doctor |
| 5 | Video Call | Video consultation in progress |
| 6 | Consultation Summary | Post-consultation summary with diagnosis |

### How to Take Screenshots

1. Run the app in a physical Android device or emulator at 1080 × 1920 resolution.
2. Navigate to each screen listed above.
3. Use Android's built-in screenshot (Power + Volume Down).
4. Export from device and crop/resize if needed.

---

## Short Promo Video (Optional but Recommended)

- [ ] **Duration:** 30 seconds
- [ ] **Format:** MP4
- [ ] **Flow to record:** Splash → Country Selection → Sign Up → Browse Doctors → Book Consultation → Active Chat/Video

---

## Android App Bundle / APK

- [ ] Built with `eas build --platform android --profile production`
- [ ] Version: 1.0.0
- [ ] Version Code: 1
- [ ] Package: `com.carehub.app`
- [ ] Signed with your upload keystore

---

## Asset Notes

> `adaptive-icon.png` is referenced in app.json but does not yet exist in `assets/images/`.
> Rename `android-icon-foreground.png` → `adaptive-icon.png`, or create a new 1024 × 1024 px foreground layer.

> `splash.png` is referenced in app.json but does not yet exist in `assets/images/`.
> Create a splash image (recommend 1284 × 2778 px to cover largest iPhone/Android screens) and place it at `assets/images/splash.png`.
