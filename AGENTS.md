# ArduLoops agent instructions

Standing conventions are in `.cursor/rules/`. Follow the rule file. Do not copy it back into this document.

- `.cursor/rules/localization.mdc` — English source phrases and Ukrainian translations for UI text.
- `.cursor/rules/dev-server.mdc` — start and check the web app and the MAVLink bridge.
- `.cursor/rules/database.mdc` — catalog migrations.
- `.cursor/rules/vehicle.mdc` — what may be sent to a real vehicle, and what counts as a check.
- `.cursor/rules/instruction-maintainer.mdc` — how to edit skills and tool descriptions. ArduLoops skills state what a result means and do not assign a procedure.
- `.cursor/rules/release-notes.mdc` — GitHub release notes: key changes only, ASD-STE100.
- Upstream synchronization: run `node scripts/check-upstream.mjs` (or `npm run check:upstream`) to inspect or update synchronization status against tracked upstream projects and components. Updating baseline records in that script marks a completed synchronization.
