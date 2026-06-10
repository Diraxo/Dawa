# CareHub — AGENTS.md
# Read this file first before every single task. Follow it strictly.

---

## What Is CareHub?

CareHub is a doctor consultation mobile app and website.
Patients consult doctors via Chat, Phone Call, or Video Call.
There is NO pharmacy. Doctor consultation only.
Doctors must be approved by Admin before they can work.

---

## Platforms

| Platform | Framework | Purpose |
|---|---|---|
| Android App | React Native (Expo) | Google Play Store |
| Website | Next.js 14 (React) | iOS users + Desktop users + Admin dashboard |

Build the Android app first. Build the website second.
Both share the same Supabase backend.

---

## Tech Stack

| Purpose | Tool |
|---|---|
| Mobile App | React Native with Expo |
| Website + Admin | Next.js 14 |
| Authentication | Clerk (email OTP, Google, Facebook) |
| Database + Storage | Supabase (PostgreSQL + file storage + realtime) |
| Video Calls | Agora |
| Audio/Phone Calls | Agora |
| Chat/Messaging | Stream Chat (GetStream) |
| Push Notifications | Firebase Cloud Messaging (FCM) |
| Email | Resend |
| Website Hosting | Vercel |
| State Management | Zustand |
| Styling (mobile) | NativeWind + StyleSheet where needed |
| Styling (web) | Tailwind CSS |
| Navigation (mobile) | Expo Router |
| Payment | Placeholder only — NOT integrated yet |

Do not introduce new libraries without asking first.

---

## Design System — Follow This Exactly

### Colors

```
Care Blue (Primary):       #1A4598
Teal Green (Primary):      #00BFA5
Interactive Blue:          #2962FF
Mist White (Background):   #FFFFFF
Cloud Grey (Light BG):     #F5F7FA
Steel Grey (Border):       #D4D9E1
Ink Black (Text):          #111827
Success:                   #00CB53
Warning:                   #FFC107
Error:                     #D32F2F
Information:               #0288D1
```

### Gradients

```
Hero Gradient:         #1A4598 → #00BFA5  (left to right)
Interactive Gradient:  #2962FF → #00BFA5  (left to right)
Dark BG Gradient:      #070E27 base with #1A4598 glow bottom-left
                       and #00BFA5 glow top-right (splash screen only)
```

### Typography

```
Font: Montserrat (Google Fonts / Expo Google Fonts)

H1  — 32px  Bold      line-height 1.2   Page/Screen Title
H2  — 24px  SemiBold  line-height 1.3   Section Title
H3  — 20px  SemiBold  line-height 1.3   Card/Module Title
H4  — 16px  Medium    line-height 1.4   Subheading
Body Large  — 16px  Regular  line-height 1.6
Body Medium — 14px  Regular  line-height 1.6
Body Small  — 13px  Regular  line-height 1.6
Caption     — 12px  Regular  line-height 1.4
```

### Buttons

```
Primary Button:
  background: gradient #2962FF → #00BFA5
  height: 52px
  border-radius: 16px
  text: white, Montserrat Bold, 16px

Outline Button:
  background: white
  border: 1.5px solid #D4D9E1
  height: 52px
  border-radius: 16px
  text: #111827, Montserrat SemiBold, 16px
```

### Cards

```
background: #FFFFFF
border-radius: 16px
shadow: soft, light gray (elevation 2 on Android)
padding: 16px
```

### Rules

- Font is ALWAYS Montserrat
- Background is ALWAYS #FFFFFF or #F5F7FA
- Primary action is ALWAYS the gradient button
- No pharmacy UI ever
- Payment button exists as placeholder only

---

## Project Folder Structure (React Native / Expo)

```
carehub-mobile/
├── app/
│   ├── (auth)/
│   │   ├── splash.tsx
│   │   ├── country.tsx
│   │   ├── language.tsx
│   │   ├── sign-up.tsx
│   │   ├── sign-in.tsx
│   │   ├── verify.tsx
│   │   └── role.tsx
│   ├── (patient)/
│   │   ├── (tabs)/
│   │   │   ├── home.tsx
│   │   │   ├── doctors.tsx
│   │   │   ├── appointments.tsx
│   │   │   ├── messages.tsx
│   │   │   └── profile.tsx
│   │   ├── doctor-profile.tsx
│   │   ├── booking.tsx
│   │   ├── waiting-room.tsx
│   │   ├── chat-consultation.tsx
│   │   ├── phone-consultation.tsx
│   │   ├── video-consultation.tsx
│   │   └── consultation-summary.tsx
│   ├── (doctor)/
│   │   ├── registration/
│   │   │   ├── step-1.tsx  (name, license)
│   │   │   ├── step-2.tsx  (specialty, experience)
│   │   │   ├── step-3.tsx  (documents upload)
│   │   │   ├── step-4.tsx  (pricing)
│   │   │   └── under-review.tsx
│   │   └── (tabs)/
│   │       ├── home.tsx
│   │       ├── consultations.tsx
│   │       ├── schedule.tsx
│   │       ├── messages.tsx
│   │       └── profile.tsx
│   └── _layout.tsx
├── components/
│   ├── ui/
│   │   ├── GradientButton.tsx
│   │   ├── OutlineButton.tsx
│   │   ├── GradientText.tsx
│   │   ├── CareHubLogo.tsx
│   │   ├── OTPInput.tsx
│   │   └── DoctorCard.tsx
│   └── shared/
│       ├── Header.tsx
│       └── LoadingSpinner.tsx
├── constants/
│   ├── colors.ts
│   ├── fonts.ts
│   ├── images.ts
│   └── config.ts
├── hooks/
│   ├── useAuth.ts
│   ├── useDoctor.ts
│   └── useConsultation.ts
├── lib/
│   ├── supabase.ts
│   ├── agora.ts
│   ├── stream.ts
│   └── clerk.ts
├── store/
│   ├── authStore.ts
│   ├── consultationStore.ts
│   └── appStore.ts
├── types/
│   └── index.ts
└── assets/
    └── images/
```

---

## Three User Types

### Patient
- Signs up with email (Clerk OTP) or Google or Facebook
- Browses doctors, books chat/phone/video consultations
- Pays per consultation (payment is placeholder for now)
- Gets consultation summary after session ends
- 5 tabs: Home · Doctors · Appointments · Messages · Profile

### Doctor (Healthcare Professional)
- Signs up with email
- Fills multi-step registration (license, specialty, documents, pricing)
- Account is LOCKED until Admin approves it
- After approval: goes online, receives consultation requests
- Has 30 seconds to accept each incoming request
- 5 tabs: Home · Consultations · Schedule · Messages · Profile

### Admin
- Web only — no mobile app for admin
- Logs in at /admin on the website
- Reviews and approves or rejects doctor applications
- Manages all users, consultations, payments

---

## Onboarding Screens (Shared Flow)

```
Splash → Country → Language → Sign Up or Login → OTP Verify → Which One Are You → Patient Home OR Doctor Registration
```

---

## Screen Descriptions

### Splash Screen
- Dark navy background (#070E27)
- Bottom left: deep blue radial glow (#1A4598)
- Top right: teal radial glow (#00BFA5)
- Faint outline medical icons at edges (opacity 8-10%)
- Center: CareHub logo icon (dark rounded square, DC monogram)
- "CAREHUB" — CARE in white, HUB in teal (#00BFA5), Montserrat Bold 42px
- "TRUSTED CARE. ANYWHERE. ALWAYS." — white, all caps, 13px, opacity 70%
- Animated gradient spinner below text
- "Loading your care experience..." — white, 14px, opacity 60%
- Auto-navigates to Country screen after 2500ms

### Country Screen
- CareHub gradient header (Hero Gradient)
- Title: "Pick your country" H1 Bold
- Subtitle: "We will use it to provide you services and recommendations."
- Country list: Ethiopia (selected by default, gradient background + checkmark), Rwanda, United States, Afghanistan
- Bottom: Login button (outline) + Sign Up button (gradient) side by side

### Language Screen
- Same gradient header
- Title: "Pick your language" H1 Bold
- List: English (selected), አማርኛ, Afaan Oromoo, ትግርኛ, English [US]
- Selected item: gradient background, white text
- Bottom: "Continue →" gradient button full width

### Sign Up Screen
- White background
- Top: back arrow left, "English ▼" right
- CareHub logo (small icon + CARE white HUB teal text) centered
- "TRUSTED CARE. ANYWHERE. ALWAYS." tagline small gray
- Title: "Sign Up" H1 Bold black
- Subtitle: "Create account and access all health services" gray
- Email input: envelope icon left, placeholder "Type your email", gray bottom border only
- "Continue →" gradient button full width
- "OR" divider with lines
- "Continue with Google" — white bg, gray border #D4D9E1, Google G icon, dark text
- "Continue with Facebook" — white bg, gray border #D4D9E1, Facebook F icon blue, dark text
- BOTH social buttons must have identical style
- Bottom: "Have an account? Login" — Login in teal #00BFA5

### Login Screen
- Identical layout to Sign Up
- Title: "Welcome Back"
- Subtitle: "Sign In to your account"
- Button: "Sign In" gradient
- Bottom: "Don't have an account? Sign Up for Free"

### Verify Code Screen
- White background
- Top: back arrow, "English ▼" right
- Title: "Verify Code" H1 Bold
- Subtitle gray: "Please enter the code we just sent to"
- Email shown bold below subtitle
- 6 OTP input boxes: rounded rectangle, gray border #D4D9E1, white fill, EMPTY (no placeholder numbers)
- "Resend code in 00:25" gray text below boxes
- Info card: light blue background (#EFF6FF), info circle icon (#2962FF), "Check your spam folder if you didn't receive the email"
- "Continue →" gradient button pinned to bottom

### Which One Are You Screen
- Light gray background #F5F7FA
- Back arrow top left
- Title: "Which one are you?" H1 Bold
- Subtitle: "We will use it to provide you services and recommendations"
- Two white cards side by side (16px radius, soft shadow):
  - Left card: patient illustration, "Patient" label dark bold
  - Right card: doctor illustration, "Healthcare Professional" label teal bold
- Selected card: gradient border + slight scale animation
- "Continue →" gradient button pinned to bottom, disabled until selection made

---

## Consultation Types

| Type | Icon | How It Works |
|---|---|---|
| Chat | 💬 | Real-time text + image + voice notes via Stream Chat |
| Phone Call | 📞 | Audio only call via Agora |
| Video Call | 🎥 | Video call via Agora |

### How Every Consultation Ends
1. Doctor taps "End Consultation"
2. Doctor fills notes form: Chief Complaint, Diagnosis, Prescription (optional), Follow-up, Referral
3. Patient receives push notification: "Your consultation summary is ready"
4. Patient sees summary screen: doctor name, date, duration, diagnosis, prescription, follow-up
5. Patient rates doctor 1-5 stars + comment
6. Consultation moves to history, chat becomes read-only

### Doctor Accept Flow
- Patient books → Doctor gets FCM push notification
- 30-second countdown timer on incoming request screen
- Doctor taps Accept or Decline
- If no response in 30 seconds: auto-decline, patient notified

---

## Supabase Database Tables

```sql
users
  id, clerk_id, email, full_name, phone, profile_photo_url,
  role (patient/doctor/admin), country, language,
  created_at, updated_at

patient_profiles
  id, user_id, date_of_birth, gender

doctor_profiles
  id, user_id, license_number, specialty, years_experience,
  hospital_name, bio, license_doc_url, id_doc_url,
  status (pending/approved/rejected/suspended),
  rejection_reason, approved_at,
  chat_price, phone_price, video_price,
  is_online, rating_average, total_consultations

consultations
  id, patient_id, doctor_id,
  type (chat/phone/video),
  status (pending/active/completed/cancelled),
  scheduled_at, started_at, ended_at, duration_minutes,
  patient_amount, doctor_amount, platform_amount,
  payment_status (pending/paid),
  created_at

consultation_summaries
  id, consultation_id, chief_complaint, diagnosis,
  prescription, followup_recommendation, referral_needed,
  created_at

messages
  id, consultation_id, sender_id, content,
  type (text/image/voice), file_url, created_at, read_at

reviews
  id, consultation_id, patient_id, doctor_id,
  rating (1-5), comment, created_at

notifications
  id, user_id, title, body, type, data_json,
  read_at, created_at

withdrawals
  id, doctor_id, amount, status (pending/approved/paid),
  bank_details, requested_at, processed_at
```

---

## Environment Variables

```
# Clerk
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=

# Supabase
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Agora
EXPO_PUBLIC_AGORA_APP_ID=
AGORA_APP_CERTIFICATE=

# Stream Chat
EXPO_PUBLIC_STREAM_API_KEY=
STREAM_API_SECRET=

# Firebase
FIREBASE_PROJECT_ID=
FIREBASE_PRIVATE_KEY=
FIREBASE_CLIENT_EMAIL=

# Resend
RESEND_API_KEY=
```

---

## Styling Rules (NativeWind)

Use NativeWind Tailwind classes as the primary styling method.

Use StyleSheet ONLY for:
- SafeAreaView (className not supported)
- Animated.View (animated values)
- Dynamic runtime styles
- Platform-specific styles (iOS vs Android)
- Shadow (different syntax per platform)
- Transform arrays
- LinearGradient (always needs style prop)

Do NOT use StyleSheet for anything that NativeWind can handle.

---

## Component Rules

Only create a reusable component when:
- It is used in more than one screen
- It makes a screen significantly easier to read
- It represents a clear UI concept

Reusable components that must exist:
- GradientButton — the primary gradient button used everywhere
- OutlineButton — the white + gray border button
- CareHubLogo — the logo used in headers
- OTPInput — the 6-box OTP input
- DoctorCard — doctor listing card
- LoadingSpinner — animated gradient spinner

---

## Image Rule

All images go in assets/images/
All image imports go through constants/images.ts

```ts
// constants/images.ts
import logo from '@/assets/images/logo.png'
import patientIllustration from '@/assets/images/patient-illustration.png'
import doctorIllustration from '@/assets/images/doctor-illustration.png'

export const images = {
  logo,
  patientIllustration,
  doctorIllustration,
}
```

Always use images like:
```tsx
import { images } from '@/constants/images'
<Image source={images.logo} />
```

---

## Constants File

```ts
// constants/colors.ts
export const colors = {
  careBlue: '#1A4598',
  tealGreen: '#00BFA5',
  interactiveBlue: '#2962FF',
  mistWhite: '#FFFFFF',
  cloudGrey: '#F5F7FA',
  steelGrey: '#D4D9E1',
  inkBlack: '#111827',
  success: '#00CB53',
  warning: '#FFC107',
  error: '#D32F2F',
  information: '#0288D1',
}

export const gradients = {
  hero: ['#1A4598', '#00BFA5'],
  interactive: ['#2962FF', '#00BFA5'],
}
```

---

## State Management

Use Zustand for:
- Selected country and language
- Logged-in user info and role
- Current consultation state
- Doctor online/offline status
- App-wide settings

Use local useState for:
- Form inputs
- UI toggles
- Temporary screen state

Persist with AsyncStorage when needed (country, language, auth token).

---

## Important Rules — Never Break These

1. Font is ALWAYS Montserrat
2. No pharmacy features — ever
3. Payment is placeholder only — show "Coming Soon" toast
4. Doctor account must be approved by Admin before access
5. Doctor has exactly 30 seconds to accept a consultation request
6. Admin has NO mobile app — web only
7. All 3 consultation types (chat, phone, video) must work on both Android app AND website
8. When a design image is provided, replicate it pixel-perfectly
9. Never expose secret keys in the mobile app
10. Always read AGENTS.md before starting any task

---

## How to Use This File

Every time you start a new screen or feature:

1. Read this entire file first
2. Check which screen you are building
3. Follow the design system exactly
4. Follow the folder structure
5. Use the correct tools from the tech stack
6. Replicate the provided image pixel-perfectly
7. Keep code clean, simple, and readable
8. Do not add features not asked for
9. Ask before adding any new library

---

## Communication Style

Be concise. Tell the developer:
- What files you created or changed
- How to test the screen
- Any decisions you made and why

## Development Rules

* Always check existing files before creating new ones.
* Reuse components whenever possible.
* Do not duplicate business logic.
* Keep files under 300 lines when possible.
* Use TypeScript strict mode.
* Fix TypeScript errors before completing a task.
* Run lint checks after major changes.
* Keep code clean, simple, and readable.

---

## Before Adding New Dependencies

* Always use existing project libraries first.
* Ask for approval before installing any new package.
* Explain why the package is needed.
* Prefer Expo-supported libraries when possible.
* Do not add libraries that duplicate existing functionality.

---

## Git Workflow

Before committing code:

1. Run npm run lint
2. Run npm run typecheck
3. Verify the application builds successfully
4. Verify no secrets are committed
5. Use descriptive commit messages
6. Ensure all new features follow AGENTS.md requirements

---

## Supabase Rules

* Use Row Level Security (RLS) on all tables.
* Never expose service role keys in client applications.
* Use Clerk user IDs for authentication mapping.
* Create migrations instead of manual database changes.
* Validate all database writes.
* Use Supabase Storage for uploaded files.
* Follow least-privilege access principles.

---

## Security Rules

* Never hardcode API keys.
* Never expose secret keys in React Native or web clients.
* Store secrets only in environment variables.
* Validate all user input before database writes.
* Sanitize uploaded file metadata.
* Protect all sensitive operations behind authentication and authorization checks.
* Follow OWASP security best practices.

---

## AI Agent Instructions

Before starting any task:

1. Read AGENTS.md completely.
2. Review the existing codebase structure.
3. Explain the implementation plan.
4. List files that will be created or modified.
5. Reuse existing components whenever possible.
6. Ask for approval before:

   * Adding new dependencies
   * Making architectural changes
   * Modifying database schemas
   * Changing authentication flows

After completing a task provide:

* Files created
* Files modified
* Summary of work completed
* Testing instructions
* Any concerns or recommended follow-up work

---

## Expo / React Native Rules

* Use Expo Router for navigation.
* Use NativeWind as the primary styling solution.
* Use StyleSheet only when AGENTS.md allows it.
* Prefer functional components and hooks.
* Use Zustand for global state management.
* Use AsyncStorage only for persistent local preferences.
* Follow Expo best practices and supported libraries.
* Optimize for Android first, then web compatibility.

---

## Code Quality Rules

* Avoid unnecessary re-renders.
* Use TypeScript types for all API responses.
* Keep components focused on a single responsibility.
* Extract reusable logic into hooks when appropriate.
* Avoid large monolithic screens.
* Prefer composition over duplication.
* Remove unused imports, variables, and code before completing a task.
