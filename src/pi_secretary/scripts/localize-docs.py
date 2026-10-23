"""Render current documentation in English, Japanese, and French from reviewed units.

Chinese source files stay in place; README.zh-CN.md is the project README source.
Code fences (except Mermaid labels), paths, and machine-readable contracts are kept.
Run with --check to detect source/catalog changes or stale generated translations.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import sys

ROOT = Path(__file__).resolve().parents[3]
CATALOG = ROOT / 'docs/i18n/translations.json'
LANGUAGES = ('en', 'ja', 'fr')
SOURCES = ['README.zh-CN.md'] + [
    'docs/' + name + '.md' for name in (
        'README', 'architecture', 'data-flow', 'invariants', 'memory-and-prompts',
        'operations', 'data-model', 'state-machines', 'database',
        'api/v1/README', 'api/v1/push', 'api/v1/attachments',
    )
] + sorted(str(p.relative_to(ROOT)) for p in (ROOT / 'docs/frontend').glob('*.md')) + sorted(str(p.relative_to(ROOT)) for p in (ROOT / 'docs/data').glob('*.md')) + [
    'test_case/README.md',
    'test_case/offline/README.md', 'test_case/online/README.md',
    'test_case/offline/issue2/README.md', 'test_case/offline/issue5/README.md',
]


def destination(source, language):
    if source == 'README.zh-CN.md':
        return {'en': 'README.md', 'ja': 'README.ja.md', 'fr': 'README.fr.md'}[language]
    if source.startswith('docs/'):
        return f'docs/{language}/' + source[5:]
    return f'docs/{language}/' + source


def relative(origin, target):
    return os.path.relpath(ROOT / target, (ROOT / origin).parent)


def slug(text):
    text = re.sub(r'\[([^]]+)\]\([^)]*\)', r'\1', text).replace('`', '').lower()
    return re.sub(r'[^\w\- ]', '', text).replace(' ', '-')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    translations = json.loads(CATALOG.read_text())
    if any(not k or len(v) != 3 or not all(isinstance(x, str) and x for x in v)
           for k, v in translations.items()):
        sys.exit('Invalid translation unit')
    if any(k.count('`') % 2 or any(v.count('`') % 2 for v in values)
           for k, values in translations.items()):
        sys.exit('Unpaired inline-code delimiter in translation catalog')
    pattern = re.compile('|'.join(re.escape(k) for k in sorted(translations, key=len, reverse=True)))
    sources = {s: (ROOT / s).read_text() for s in SOURCES}
    # The root README link in existing guides denotes the project README.
    aliases = {'README.md': 'README.zh-CN.md'}
    outputs = {}
    errors = []
    for language_index, language in enumerate(LANGUAGES):
        def translate(text):
            return pattern.sub(lambda m: translations[m[0]][language_index], text)

        anchor_maps = {}
        for source, content in sources.items():
            anchor_maps[source] = {
                slug(h): slug(translate(h))
                for h in re.findall(r'^#{1,6} (.+)$', content, re.M)
            }
        for source, content in sources.items():
            output = destination(source, language)
            def link(match):
                value = match[1]
                if re.match(r'\w+://', value) or value.startswith(('mailto:', 'data:')):
                    return match[0]
                path, sep, anchor = value.partition('#')
                resolved = os.path.normpath(os.path.join(os.path.dirname(source), path)) if path else source
                resolved = aliases.get(resolved, resolved)
                if resolved in sources:
                    target = destination(resolved, language)
                    anchor = anchor_maps[resolved].get(anchor, anchor)
                else:
                    target = resolved
                url = relative(output, target) if path else ''
                return '](' + url + (('#' + anchor) if sep else '') + ')'

            lines = []
            fence = None
            for line in content.splitlines():
                if line.startswith('[English]('):
                    continue
                if line.startswith('```'):
                    fence = None if fence is not None else line[3:].strip()
                    lines.append(line)
                    continue
                if fence is not None and fence != 'mermaid':
                    lines.append(line)
                    continue
                rendered = translate(line)
                # Keep inline code and link URLs byte-for-byte while normalizing prose punctuation.
                parts = re.split(r'(`[^`]*`|\]\([^)]*\))', rendered)
                for i in range(0, len(parts), 2):
                    if language == 'ja':
                        parts[i] = parts[i].replace('，', '、').replace('；', '、')
                    else:
                        colon = ' : ' if language == 'fr' else ': '
                        parts[i] = (parts[i].replace('、', ', ').replace('；', '; ')
                                    .replace('。', '. ').replace('，', ', ').replace('：', colon))
                rendered = ''.join(parts).replace(':[', ': [')
                if language in ('en', 'fr'):
                    residue = re.sub(r'\]\([^)]*\)', '', rendered)
                    residue = re.sub(r'`[^`]*`', '', residue)
                    if re.search('[\u4e00-\u9fff]', residue):
                        errors.append(f'{source}: untranslated {language}: {line}')
                # Preserve inbound links from existing Chinese and historical guides.
                if source == 'README.zh-CN.md' and language == 'en' and line.startswith('## '):
                    lines.extend([f'<a id="{slug(line[3:])}"></a>', ''])
                lines.append(re.sub(r'\]\(([^)\s]+)\)', link, rendered).rstrip())
            navigation = []
            for code, label in [('en', 'English'), ('ja', '日本語'), ('fr', 'Français'), ('zh', '中文')]:
                target = source if code == 'zh' else destination(source, code)
                navigation.append(f'[{label}]({relative(output, target)})')
            while len(lines) > 1 and not lines[1]:
                lines.pop(1)
            lines[1:1] = ['', ' | '.join(navigation), '',
                           '<!-- Generated by npm run docs:localize; edit docs/i18n/translations.json. -->', '']
            outputs[output] = '\n'.join(lines) + '\n'
    manifest = {
        'languages': list(LANGUAGES),
        'scope': 'Current guides and generated references; historical designs, fix records, dated acceptance evidence, and the upstream submodule remain in their original languages.',
        'source_sha256': {s: hashlib.sha256(v.encode()).hexdigest() for s, v in sources.items()},
        'catalog_sha256': hashlib.sha256(CATALOG.read_bytes()).hexdigest(),
        'outputs': sorted(outputs),
    }
    outputs['docs/i18n/manifest.json'] = json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        return 1
    stale = []
    for name, content in outputs.items():
        path = ROOT / name
        if args.check:
            if not path.exists() or path.read_text() != content:
                stale.append(name)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
    if stale:
        print('Stale localized documentation: ' + ', '.join(stale), file=sys.stderr)
        return 1
    print(f'{len(SOURCES)} sources, {len(outputs) - 1} localized pages, {len(translations)} translation units: ' + ('current' if args.check else 'generated'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
