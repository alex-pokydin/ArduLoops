# ArduLoops agent instructions

## Localization

For every user-visible UI change:

- Use `t("English source phrase")` from `src/i18n/i18n.ts`.
- Add the matching Ukrainian translation to `src/i18n/uk.ts` in the same change.
- Do not introduce Russian UI literals or untranslated fallback strings.
- Include labels, tabs, placeholders, validation and empty-state messages, `aria-label` values, and titles.
- Preserve telemetry, parameter names, firmware IDs, MAVLink text, and user-provided values.

The full Cursor rule is in `.cursor/rules/localization.mdc`.

## Development startup

- Always start the project from the repository root with `npm run dev`. This starts both the Vite web interface and the Rust MAVLink bridge and watches for changes.
- Keep exactly one `npm run dev` instance running. Reuse an existing healthy instance instead of starting another.
- Do not start Vite, `npm run web`, `cargo run`, or the bridge executable separately to run the development application.
- Before restarting, identify and stop only this project's previous dev process tree and any orphaned web or bridge processes. Do not terminate unrelated services to free a port.
- After startup, verify that both the web interface on `http://127.0.0.1:5173/` and the bridge on `http://127.0.0.1:8767/state` respond. Report vehicle connection errors separately; a running web server does not prove that the bridge or vehicle connection is working.
