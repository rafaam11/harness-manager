"""Refresh bundled setting schemas and the official Claude settings index."""
import json
import pathlib
import re
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1] / 'src/shared/cli-settings/catalog'
ROOT.mkdir(parents=True, exist_ok=True)
def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=30).read().decode()
def save(name, value):
    (ROOT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
if __name__ == '__main__':
    for provider, url in [('codex', 'https://developers.openai.com/codex/config-schema.json'), ('claude', 'https://json.schemastore.org/claude-code-settings.json')]:
        save(provider + '.json', json.loads(fetch(url)))
    text = fetch('https://code.claude.com/docs/en/settings-reference.md?plain=1')
    entries = []
    sections = {m[0]: m[1] for m in re.findall(r'^### `([^`]+)`\s*\n(.*?)(?=^### |\Z)', text, re.M | re.S)}
    for key, description, category, scope in re.findall(r'^\| \[`([^`]+)`\][^|]+\| ([^|]+)\| ([^|]+)\| ([^|]+)\|', text, re.M):
        body = sections.get(key, '')
        kind = re.search(r'\*\*Type\*\*: ([^\n]+)', body)
        version = re.search(r'Requires Claude Code v([\d.]+)', body)
        default = re.search(r'\*\*Default\*\*: ([^\n]+)', body)
        entries.append(dict(key=key, description=re.sub(r'\[([^]]+)\]\([^)]*\)', r'\1', description).strip(), category=category.strip(), scope=scope.strip(), type=kind[1] if kind else '', minimumVersion=version[1].rstrip('.') if version else None, defaultDescription=default[1] if default else 'unset'))
    save('claude-index.json', entries)
    print(f'Claude official index: {len(entries)} entries')
