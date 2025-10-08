# Mandatory Onboarding Flow

The Phloat onboarding experience ensures that every authenticated user has a complete
profile before they can access the rest of the application. The flow is triggered for
any user document that is missing a username, date of birth, survey results, or plan
choice, and it runs both for first-time sign-ins and for existing accounts that are
still incomplete.

## Trigger logic
- The browser gatekeeper lives in `frontend/js/auth.js`. It redirects users to
  `onboarding.html` whenever `needsMandatoryOnboarding` returns `true`.
- `needsMandatoryOnboarding` checks the cached `/api/user/me` response for:
  - `username`
  - `dateOfBirth`
  - at least one `profileInterests` entry
  - onboarding survey signals (`valueSignals`, `tierSignals`, and `planChoice`)
  - the `onboardingComplete` boolean flag
- Protected pages call `Auth.enforce()` during bootstrap and `Auth.requireAuth()` once
the page has loaded. Both helpers reroute to the onboarding page if the requirements
above are not met.

## User model fields
The MongoDB user schema (see `backend/models/User.js`) stores the captured details in
three dedicated structures:

```js
{
  username: String,
  dateOfBirth: Date,
  profileInterests: [String],
  onboardingComplete: Boolean,
  onboardingSurvey: {
    interests: [String],
    motivations: [String],
    valueSignals: [{ id, question, response }],
    tierSignals: [{ id, question, response }],
    recommendedTier: 'starter' | 'growth' | 'premium' | null,
    recommendedSummary: String,
    planChoice: { selection, interval, paymentMethod, trialAccepted },
    completedAt: Date
  }
}
```

The API keeps username uniqueness at the application layer rather than via a unique
index. The `/api/user/username-available` endpoint exposes the check to the frontend
wizard.

## HTTP endpoints
- `GET /api/user/me` – baseline account fetch used by the guard logic and the profile
  screen. Newly added fields are included in the safe response payload.
- `GET /api/user/username-available?username=<candidate>` – returns
  `{ available: boolean, reason?: string }` so the onboarding wizard can provide instant
  feedback.
- `POST /api/user/onboarding/complete` – submits the wizard payload. The handler
  normalises dates, validates username uniqueness, stores survey answers, updates trial
  metadata, and marks `onboardingComplete: true` when successful.

All onboarding routes require an authenticated bearer token. When the payload is
accepted the response body echoes the updated `user` document together with any
subscription information so the UI can hydrate without an additional request.

## Frontend wizard
`frontend/onboarding.html` hosts a fullscreen multi-step wizard implemented in
`frontend/js/onboarding.js`. Notable characteristics:

- Steps use a progress indicator and full-height layout to keep focus on the wizard.
- Username selection performs live availability checks against the endpoint above.
- Date of birth entry uses semantic `<input type="date">` controls backed by custom
  validation and friendly error copy.
- Interests, motivations, and the tier-qualification questions are rendered as rich
  tiles/pills to keep engagement high.
- Five "value signal" questions reinforce the benefits of Phloat. Answers are stored as
  structured objects (`id`, `question`, `response`).
- Five additional tier differentiation questions help the backend recommend either the
  starter or premium tier based on the user’s selections.
- Plan selection summarises the recommended tier, highlights premium upsell features,
  captures fake billing details for now, and allows the user to opt into a 30-day trial.
- The final step records the EULA and privacy policy acceptance timestamps and posts the
  payload to `/api/user/onboarding/complete`.

The wizard blocks navigation until submission succeeds. Upon completion the user is
redirected to `home.html` and subsequent page loads reuse the `onboardingComplete`
flag to avoid rerouting.

## Profile screen
`frontend/js/profile.js` now initialises immediately, ensuring profile fields render as
soon as `/api/user/me` resolves. Newly captured onboarding fields appear alongside the
existing profile metadata.
