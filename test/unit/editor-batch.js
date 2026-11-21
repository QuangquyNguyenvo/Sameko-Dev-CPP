'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { searchInFiles } = require('../../app/services/file-search');
const { firstError, parseDiagnostic } = require('../../src/renderer/app/compile-hints');
const { punctuationEdits, toRange } = require('../../src/features/suggestions/cpp-language-tools');

async function main() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sameko-find-files-'));
    try {
        for (const dir of ['src', 'node_modules', '.git', 'build', 'cmake-build-release']) {
            await fs.mkdir(path.join(root, dir));
            await fs.writeFile(path.join(root, dir, 'a.txt'), 'first\r\nα Widget.7\r\nwidgetx8\r\nwidget.9');
        }
        await fs.writeFile(path.join(root, 'binary'), Buffer.from('\0Widget.7'));
        await fs.writeFile(path.join(root, 'artifact.o'), 'Widget.7');
        await fs.writeFile(path.join(root, 'large.txt'), 'Widget.7' + ' '.repeat(2 * 1024 * 1024));
        const search = options => searchInFiles({ folder: root, ...options });

        const plain = await search({ query: 'Widget.' });
        assert.equal(plain.status, 'ok');
        assert.equal(plain.count, 2);
        assert.equal(plain.files[0].relativePath, path.join('src', 'a.txt'));
        assert.deepEqual(plain.files[0].matches.map(({ line, column }) => [line, column]), [[2, 3], [4, 1]]);
        assert.equal((await search({ query: 'Widget.', caseSensitive: true })).count, 1);
        assert.equal((await search({ query: 'widget.\\d$', regex: true })).count, 3);
        assert.equal((await search({ query: '[', regex: true })).status, 'invalid-regex');
        assert.equal((await search({ query: 'not here' })).count, 0);
        console.log('  PASS  file search modes, Unicode coordinates and exclusions');

        await fs.writeFile(path.join(root, 'many.txt'), 'match\n'.repeat(2001));
        const capped = await search({ query: '^match$', regex: true });
        assert.equal(capped.count, 2000);
        assert.equal(capped.capped, true);
        assert.equal(capped.files[0].matches.at(-1).line, 2000);
        console.log('  PASS  file search cap');
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }

    const line = 'print（“x”）； // ；';
    const edits = punctuationEdits(line, [{ offset: 0, type: 'identifier.cpp' }, { offset: 13, type: 'comment.cpp' }], 4);
    assert.deepEqual(edits.map(edit => [edit.range.startLineNumber, edit.range.startColumn, edit.text]),
        [[4, 6, '('], [4, 7, '"'], [4, 9, '"'], [4, 10, ')'], [4, 11, ';']]);
    assert.equal(punctuationEdits('";；"', [{ offset: 0, type: 'string.cpp' }], 1).length, 0);
    assert.deepEqual(toRange({ start: { line: 0, character: 3 }, end: { line: 1, character: 0 } }),
        { startLineNumber: 1, startColumn: 4, endLineNumber: 2, endColumn: 1 });
    assert.equal(toRange({ start: { line: 1, character: 0 }, end: { line: 0, character: 0 } }), null);
    console.log('  PASS  LSP ranges and punctuation edits');

    const examples = [
        ["expected ';' before '}' token", /^Add a semicolon/],
        ['‘foo’ was not declared in this scope', /^Check the spelling/],
        ['no matching function for call to ‘foo()’', /^Check the number/],
        ['expected ‘)’ before ‘x’', /^The compiler reached/],
        ['invalid conversion from ‘int’ to ‘int*’', /^This conversion/],
        ['redefinition of ‘int x’', /^This name/],
        ['cannot convert ‘int*’ to ‘int’', /^The value/],
        ['lvalue required as left operand of assignment', /^This operation/],
        ['‘cout’ was not declared in this scope', /<iostream>/],
        ['‘vector’ is not a member of ‘std’', /<vector>/]
    ];
    for (const [message, pattern] of examples) {
        const output = ['D:\\a.cpp:2:1: warning: unused', 'D:\\a.cpp:3:2: error: ' + message, 'D:\\a.cpp:3:2: error: more'].join('\r\n');
        assert.equal(firstError(output).index, 1);
        assert.match(firstError(output).hint, pattern, message);
    }
    assert.match(firstError("ld: code.o: undefined reference to \x60WinMain'\ncollect2: error: ld returned 1").hint, /int main\(\)/);
    assert.match(firstError('ld.lld: error: undefined symbol: main').hint, /int main\(\)/);
    assert.equal(firstError("a.cpp:3:5: fatal error: unrelated\nb.cpp:4:2: error: expected ';'").hint, '');
    assert.deepEqual(parseDiagnostic('D:\\a.cpp:12:34: error: problem'),
        { file: 'D:\\a.cpp', line: 12, col: 34, type: 'error', message: 'problem' });
    console.log('  PASS  explanations cover common diagnostics and use only the first error');
}

main().catch(error => {
    console.error('  FAIL ', error);
    process.exitCode = 1;
});
