# What's-New Context — <App Name>

<!--
  Copy this file to .github/whats-new-context.md in your repo.

  This file is the ONLY app knowledge the public release summarizer sees —
  it is what makes summaries app-aware instead of generic. Treat it as a
  living document: whenever you add, rename, or remove a user-facing feature
  (or its vocabulary changes), update this file in the same PR.

  Everything in this file may influence PUBLIC text shown to end users.
  Never put internal details here: no service names, architecture,
  dependencies, or anything you wouldn't publish.
-->

## About the app

<One paragraph: what the app is, who uses it, and what they use it for.
Example: "Den is a household management app. Users are families tracking
pantry inventory, meal plans, recipes, and shared todos.">

## Vocabulary

<Feature names exactly as users see them in the UI — the summarizer will
use these words.>

- <Pantry>
- <Meal plan>
- <Collections>

## Tone

<e.g. Friendly and brief. Address the user as "you". No exclamation marks.>

## Deny-list

<!--
  One term per line. Publishing FAILS (mechanically, case-insensitive
  WHOLE-WORD match) if any of these appear in the public summary. Add your
  internal service names, cloud providers, and anything else that must
  never leak. Prefer specific terms — very generic words will block
  legitimate summaries. A few defaults (secret, token, api key, password,
  credential) are always enforced by the workflow.
-->

- internal
- database
- AWS
- <internal-service-name>
