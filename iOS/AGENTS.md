# Kualia iOS app

This guide applies to `iOS/`, including `Kualia.xcodeproj`, scheme `Kualia`, and `Kualia/` sources.

## Icons

Use the bundled Lucide artwork (ISC license) through `KualiaIcon`. Preserve accessibility and existing typed names.

## Localization

- Localize every new or changed user-facing string through `L10n` and update `Kualia/Localizable.xcstrings` in the same change.
- Supply translations for every supported app language, including accessibility labels, hints, empty states, filters, and action buttons. Do not leave new keys in English as a fallback for other languages.
- Verify language coverage and interpolation placeholders before delivery.

## Validation

- Use two-component marketing versions (`major.minor`, for example `3.0` or `3.1`) for all future releases. Keep the app and embedded extension targets, App Store Connect draft, metadata version directory, and migration manifest on the same version. Increment the build number separately; do not add a patch component to the marketing version.

- Follow the root guide. Do not launch or test in a simulator unless the user explicitly requests simulator testing for the current work.
- Use Swift formatting/static checks and generic-device build validation by default. Report any unverified runtime behavior.
