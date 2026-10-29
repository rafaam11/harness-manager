# Bundled settings catalog

Snapshot date: 2026-10-29. Regenerate with `python scripts/update-settings-catalog.py` from the repository root; review upstream changes, schema compatibility and the snapshot date before committing.

- `codex.json`: https://developers.openai.com/codex/config-schema.json (official OpenAI Codex schema, Apache-2.0).
- `claude.json`: https://json.schemastore.org/claude-code-settings.json (SchemaStore, Apache-2.0; community schema, not an Anthropic compatibility guarantee).
- `claude-index.json`: key/type/scope/default/minimum-version metadata extracted from https://code.claude.com/docs/en/settings-reference.md?plain=1 (official reference). Contains 247 index entries at this snapshot; not the full documentation.

JSON indentation is normalized. Runtime code combines the schemas with reference metadata and independently restricts writable fields. Schema absence, unsupported types and unknown versions never imply compatibility. No network request runs from the renderer. See repository `THIRD_PARTY_NOTICES.md` for licenses.
