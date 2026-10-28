// Generated from mods/guard/hooks/rules.ts; regenerate with scripts/build-codex-mod.mjs.
// 셸 명령 한 줄에서 되돌리기 어려운 명령을 찾는다. 순수 함수, IO 없음.
// 따옴표 안 문자열을 같은 길이의 공백으로 지워, 따옴표 속 "rm -rf" 같은 글자에 걸리지 않게 한다.
function blankQuotes(command) {
    return command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, match => ' '.repeat(match.length));
}
function unquote(token) {
    return token.replace(/^(['"])(.*)\1$/, '$2');
}
// 원문을 ; && || | 줄바꿈으로 나누되, 위치는 따옴표를 지운 사본에서 찾는다.
function segments(command) {
    const bare = blankQuotes(command);
    const out = [];
    let start = 0;
    const re = /;|&&|\|\||\||\r?\n/g;
    for (let match = re.exec(bare); match; match = re.exec(bare)) {
        out.push({ raw: command.slice(start, match.index), bare: bare.slice(start, match.index) });
        start = match.index + match[0].length;
    }
    out.push({ raw: command.slice(start), bare: bare.slice(start) });
    return out.filter(one => one.bare.trim() !== '');
}
// 공백 기준 토큰. 따옴표로 묶인 토큰은 원문에서 그대로 가져온다.
function tokens(raw) {
    return raw.match(/'[^']*'|"(?:[^"\\]|\\.)*"|\S+/g) ?? [];
}
const PREFIXES = new Set(['sudo', 'command', 'builtin', 'exec', 'time', 'nohup', '&', 'env']);
function stripPrefixes(list) {
    let i = 0;
    while (i < list.length && (PREFIXES.has((list[i] ?? '').toLowerCase()) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(list[i] ?? ''))) {
        i += 1;
    }
    return list.slice(i);
}
function detectRm(words, segment) {
    const name = (words[0] ?? '').toLowerCase().replace(/\.exe$/, '');
    const isPosixRm = name === 'rm';
    const isRemoveItem = ['remove-item', 'ri', 'rmdir', 'rd', 'del', 'erase'].includes(name);
    if (!isPosixRm && !isRemoveItem) {
        return null;
    }
    const flags = words.slice(1).filter(word => word.startsWith('-'));
    const isRecursive = isPosixRm
        ? flags.some(flag => flag === '--recursive' || (/^-[a-zA-Z]+$/.test(flag) && /[rR]/.test(flag)))
        : flags.some(flag => /^-r(e(c(u(r(s(e)?)?)?)?)?)?$/i.test(flag)) || ((name === 'rmdir' || name === 'rd') && words.some(word => /^\/s$/i.test(word)));
    if (!isRecursive) {
        return null;
    }
    const valueFlags = new Set(['-path', '-literalpath', '-include', '-exclude', '-filter']);
    const targets = [];
    const rest = words.slice(1);
    for (let i = 0; i < rest.length; i += 1) {
        const word = rest[i] ?? '';
        if (valueFlags.has(word.toLowerCase())) {
            if (word.toLowerCase() === '-path' || word.toLowerCase() === '-literalpath') {
                targets.push(unquote(rest[i + 1] ?? ''));
            }
            i += 1;
        }
        else if (!word.startsWith('-') && !word.startsWith('/')) {
            targets.push(unquote(word));
        }
        else if (isPosixRm === false && word.startsWith('/') && !/^\/[a-z]$/i.test(word)) {
            targets.push(unquote(word));
        }
    }
    return {
        kind: 'rm',
        summary: `재귀 삭제: ${targets.join(', ') || '(대상 없음)'}`,
        segment,
        targets: targets.filter(Boolean),
        gitDir: null,
        flags,
    };
}
function detectGit(words, segment) {
    if ((words[0] ?? '').toLowerCase().replace(/\.exe$/, '') !== 'git') {
        return null;
    }
    // git 전역 옵션(-C dir, -c k=v, --no-pager 등)을 건너뛰고 하위 명령을 찾는다.
    let i = 1;
    let gitDir = null;
    while (i < words.length && (words[i] ?? '').startsWith('-')) {
        const word = words[i] ?? '';
        if (word === '-C') {
            gitDir = unquote(words[i + 1] ?? '');
            i += 2;
        }
        else if (word === '-c') {
            i += 2;
        }
        else {
            i += 1;
        }
    }
    const sub = words[i] ?? '';
    const args = words.slice(i + 1).map(unquote);
    const flags = args.filter(arg => arg.startsWith('-'));
    const positional = args.filter(arg => !arg.startsWith('-'));
    const base = { segment, gitDir, flags };
    if (sub === 'push') {
        const isForce = flags.some(flag => flag === '--force' || flag === '--force-with-lease' || flag.startsWith('--force-with-lease=') || flag === '--mirror' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(flag)) ||
            positional.slice(1).some(ref => ref.startsWith('+'));
        const isDelete = flags.includes('--delete') || flags.includes('-d') || positional.slice(1).some(ref => ref.startsWith(':'));
        if (isForce || isDelete) {
            return { ...base, kind: 'push-force', summary: isDelete ? '원격 브랜치 삭제 push' : '강제 push(원격 기록 덮어쓰기)', targets: positional };
        }
    }
    if (sub === 'reset' && flags.includes('--hard')) {
        return { ...base, kind: 'reset-hard', summary: `git reset --hard ${positional[0] ?? 'HEAD'}`, targets: positional };
    }
    if (sub === 'clean' && flags.some(flag => flag === '--force' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(flag)) && !flags.some(flag => flag === '-n' || flag === '--dry-run' || /^-[a-zA-Z]*n[a-zA-Z]*$/.test(flag))) {
        return { ...base, kind: 'clean', summary: '추적 안 되는 파일 삭제(git clean)', targets: positional };
    }
    if ((sub === 'checkout' && (args.includes('--') || positional.includes('.'))) || (sub === 'restore' && !flags.includes('--staged') && positional.length > 0)) {
        const paths = sub === 'checkout' && args.includes('--') ? args.slice(args.indexOf('--') + 1) : positional;
        if (sub === 'restore' || paths.length > 0) {
            return { ...base, kind: 'discard', summary: `작업 중인 변경 되돌리기: ${paths.join(' ') || '.'}`, targets: paths };
        }
    }
    if (sub === 'branch' && (flags.includes('-D') || (flags.includes('--delete') && flags.includes('--force')))) {
        return { ...base, kind: 'branch-delete', summary: `브랜치 강제 삭제: ${positional.join(', ')}`, targets: positional };
    }
    if (sub === 'stash' && (positional[0] === 'drop' || positional[0] === 'clear')) {
        return { ...base, kind: 'stash', summary: positional[0] === 'clear' ? 'stash 전부 삭제' : `stash 삭제: ${positional[1] ?? 'stash@{0}'}`, targets: positional.slice(1) };
    }
    return null;
}
export function detect(command) {
    const found = [];
    for (const { raw } of segments(command)) {
        const words = stripPrefixes(tokens(raw.trim()));
        const danger = detectRm(words, raw.trim()) ?? detectGit(words, raw.trim());
        if (danger) {
            found.push(danger);
        }
    }
    return found;
}
