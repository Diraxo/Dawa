# Dawa — Google Play Medical App Declaration

Google requires medical and health apps to complete a **Health Apps** declaration inside Play Console.
Navigate to: **Policy → App Content → Health Apps**

---

## Declaration Answers

| Question | Answer |
|---|---|
| Does your app provide medical advice? | **Yes — through licensed healthcare professionals only** |
| Does your app claim to diagnose, cure, or treat conditions? | **No — our doctors provide consultations and advice only** |
| Do you have licensed medical professionals on your platform? | **Yes — all doctors are verified with valid medical licenses** |
| Do you have a process to verify healthcare providers? | **Yes — admin manually reviews license documents before approval** |

---

## Required Disclaimer

Should appear in:

1. **Onboarding** — one-time dismissible banner (`components/shared/MedicalDisclaimer.tsx`, dismissible mode — wired into `app/(auth)/sign-up.tsx`)
2. **Before every consultation starts** — non-dismissible banner (same component, non-dismissible mode — wired into `components/ui/BookingModal.tsx`)
3. **Play Store full description** — included (see `store-listing.md`)

### Disclaimer Text (as implemented in `MedicalDisclaimer.tsx`)

```
Dawa consultations are not a substitute for emergency care. Call emergency
services for life-threatening conditions.
```

---

## Supporting Documentation to Keep Ready

Google may request these during review:

- [ ] Sample medical license of an approved doctor on the platform
- [ ] Screenshot of the admin approval workflow
- [ ] Privacy Policy URL (must be live before submission)
- [ ] Terms of Service URL (must be live before submission)
- [ ] Contact email for health-related inquiries

---

## Privacy Policy Requirements for Medical Apps

Your Privacy Policy must explicitly state:

- What health data is collected (diagnoses, prescriptions, consultation notes)
- How health data is stored and protected
- Who can access health data (patient + assigned doctor only)
- How users can request deletion of their health data
- That data is not sold or shared with advertisers

---

## Before Submitting to Play Store

- [ ] Privacy Policy hosted at a live URL
- [ ] Terms of Service hosted at a live URL
- [ ] Medical disclaimer visible in-app
- [ ] Health Apps declaration completed in Play Console
- [ ] Data Safety section completed in Play Console
- [ ] Content rating questionnaire completed (select "Medical" category)
