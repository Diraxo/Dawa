# Dawa — Google Play Data Safety Form Answers

Copy these answers into the Play Console **Data Safety** section.

---

## Does your app collect or share user data?

**Yes**

---

## Data Types Collected

### Personal Info

| Data Type | Collected | Shared | Encrypted | Required |
|---|---|---|---|---|
| Name | ✅ Yes | ❌ No | ✅ Yes | Required |
| Email address | ✅ Yes | ❌ No | ✅ Yes | Required |
| Phone number | ✅ Yes | ❌ No | ✅ Yes | Optional |
| User IDs | ✅ Yes | ❌ No | ✅ Yes | Required |

### Health and Fitness

| Data Type | Collected | Shared | Encrypted | Required |
|---|---|---|---|---|
| Health info | ✅ Yes | ❌ No | ✅ Yes | Required |

> Health info includes: consultation descriptions, diagnoses, prescriptions provided by doctors.

### Photos and Videos

| Data Type | Collected | Shared | Encrypted | Required |
|---|---|---|---|---|
| Photos | ✅ Yes | ❌ No | ✅ Yes | Optional |

> Profile photos and symptom photos uploaded by the user.

### Files and Docs

| Data Type | Collected | Shared | Encrypted | Required |
|---|---|---|---|---|
| Files | ✅ Yes | ❌ No | ✅ Yes | Optional |

> Medical license and government ID documents for doctor registration only.

### Financial Info

| Data Type | Collected | Shared | Encrypted | Required |
|---|---|---|---|---|
| Purchase history | ✅ Yes | ❌ No | ✅ Yes | Required (patients) |
| Bank account / payout details | ✅ Yes | ❌ No | ✅ Yes | Required (doctors, for withdrawals) |

> Patient payment card details are entered directly with Chapa (our payment processor) and are never collected or stored by Dawa. Doctors provide a bank account/name for withdrawal payouts, stored by Dawa.

### App Activity

**Not collected.** Dawa does not use any third-party analytics or crash-reporting SDK and does not track screen views, feature usage, or session activity.

---

## Security Practices

| Question | Answer |
|---|---|
| Is data encrypted in transit? | **Yes — TLS 1.2 or higher** |
| Is data encrypted at rest? | **Yes — AES-256** |
| Can users request data deletion? | **Yes — via Profile Settings or by emailing support** |
| Do you follow Families Policy? | **No — app is not directed at children** |

---

## Notes for Play Console Reviewer

- Authentication is handled by Clerk (SOC 2 Type II certified).
- File and media storage is handled by Supabase Storage (encrypted at rest).
- No data is sold to third parties.
- Health data is only accessible to the patient and the assigned doctor during an active consultation.
