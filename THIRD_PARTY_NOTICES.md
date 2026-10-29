# Third-party notices

## 외부 API 카탈로그 (jk-external-api에서 흡수)

- `src/shared/external-api/generated/skills.json`과 앱의 "스냅샷 새로고침"이 받는 목록은
  [NomaDamas/k-skill](https://github.com/NomaDamas/k-skill)의 `SKILL.md` frontmatter(이름·설명·분류)를 요약한 것이다.
  k-skill은 MIT 라이선스이며, 저작권과 원문은 그 저장소와 기여자에게 있다. 앱은 각 스킬의 원문 링크를 함께 보여 준다.
- 정보원 기록은 각 제공기관의 공개 메타데이터를 요약하고 공식 링크로 안내한다. 원 데이터와 이용조건은 각 기관의 약관을 따른다.
  실제 서비스에 쓰기 전에 기관별 최신 이용조건·호출 한도·표시 의무를 다시 확인하라.
- jk-external-api 자체 코드와 문서(MIT, Copyright (c) 2026 Rafaam11)는 `docs/external-api/LICENSE`를 따른다.
  원 사이트가 번들하던 웹 폰트는 앱에 포함하지 않는다.

## CLI 설정 카탈로그

- `src/shared/cli-settings/catalog/codex.json`은 [OpenAI Codex 공식 설정 스키마](https://developers.openai.com/codex/config-schema.json)의 스냅샷이다. OpenAI 및 Codex 기여자, Apache-2.0. [라이선스 사본](docs/licenses/openai-codex.txt)을 포함한다.
- `claude.json`은 [SchemaStore의 Claude Code 설정 스키마](https://github.com/SchemaStore/schemastore/blob/master/src/schemas/json/claude-code-settings.json)다. SchemaStore 기여자, Apache-2.0. [라이선스 사본](docs/licenses/schemastore.txt)을 포함한다. JSON 들여쓰기만 정규화했다.
- `claude-index.json`은 [Claude Code 공식 설정 참조](https://code.claude.com/docs/en/settings-reference)의 키·형식·범위·기본값 메타데이터를 추출했다. 스키마가 다루지 않는 항목도 표시하며 원문 링크로 안내한다. 전체 문서는 포함하지 않는다.
- 카탈로그 출처와 생성 절차는 [SOURCES.md](src/shared/cli-settings/catalog/SOURCES.md)를 따른다. 공급자 이름·상표는 해당 소유자에게 있다.
