'use strict';
// AtCoder adapter cases. Fixtures: test/fixtures/atcoder/ — each says at the top whether it is a REAL
// page (fetched anonymously, trimmed) or RECONSTRUCTED (login-only page) and from what.

const AC = 'https://atcoder.jp';
const TASK = `${AC}/contests/abc380/tasks/abc380_a`;
const ME = `${AC}/contests/abc380/submissions/me`;
const SUBMIT = `${AC}/contests/abc380/submit?taskScreenName=abc380_a`;
// Submitted at 21:30:00 JST; the new row in the me-*.html fixtures is 21:30:05 JST (id 59813377),
// the older rows are 21:20:40 (task B) and 21:03:12 (an earlier AC on task A).
const SUBMITTED_AT = Date.UTC(2024, 10, 16, 12, 30, 0);
const job = { id: 's_1731760190000_1', url: TASK, submittedAt: SUBMITTED_AT };
const NEW_URL = `${AC}/contests/abc380/submissions/59813377`;

module.exports = {
    adapter: 'atcoder',
    pure: [
        { fn: 'classify', args: [TASK], expect: { kind: 'problem' } },
        { fn: 'classify', args: [`${TASK}?lang=en`], expect: { kind: 'problem' } },
        { fn: 'classify', args: [`${AC}/contests/abc001/tasks/abc001_1`], expect: { kind: 'problem' } },
        { fn: 'classify', args: [`${AC}/contests/abc380/tasks`], expect: { kind: 'other' } },
        { fn: 'classify', args: [SUBMIT], expect: { kind: 'submit' } },
        { fn: 'classify', args: [`${AC}/contests/abc380/submit`], expect: { kind: 'submit' } },
        { fn: 'classify', args: [ME], expect: { kind: 'status' } },
        { fn: 'classify', args: [`${ME}?f.Task=abc380_a`], expect: { kind: 'status' } },
        { fn: 'classify', args: [NEW_URL], expect: { kind: 'status' } },
        { fn: 'classify', args: [`${AC}/contests/abc380/submissions`], expect: { kind: 'other' } },
        { fn: 'classify', args: [`${AC}/login?continue=x`], expect: { kind: 'other' } },
        { fn: 'classify', args: [`${AC}/contests/abc380`], expect: { kind: 'other' } },
        { fn: 'classify', args: ['not a url'], expect: { kind: 'other' } },
        { fn: 'submitUrl', args: [TASK], expect: SUBMIT },
        { fn: 'submitUrl', args: [`${TASK}?lang=ja#sample`], expect: SUBMIT },
        { fn: 'submitUrl', args: [SUBMIT], expect: SUBMIT },
        { fn: 'submitUrl', args: [`${AC}/contests/abc001/tasks/abc001_1`], expect: `${AC}/contests/abc001/submit?taskScreenName=abc001_1` },
        { fn: 'submitUrl', args: [`${AC}/contests/abc380/submit`], expect: null },
        { fn: 'submitUrl', args: [ME], expect: null }
    ],
    dom: [
        // parseProblem — real pages
        { name: 'parseProblem recent task, both languages, 4 samples taken once', fixture: 'atcoder/task-abc380_a-en.html', url: `${TASK}?lang=en`, fn: 'parseProblem',
            expect: { name: 'A - 123233', group: 'AtCoder - AtCoder Beginner Contest 380', url: TASK, timeLimit: 2000, memoryLimit: 1024,
                tests: [{ input: '123233\n', output: 'Yes\n' }, { input: '123234\n', output: 'No\n' }, { input: '323132\n', output: 'Yes\n' }, { input: '500000\n', output: 'No\n' }] } },
        { name: 'parseProblem Japanese UI, multi-line samples', fixture: 'atcoder/task-abc430_c-ja.html', url: `${AC}/contests/abc430/tasks/abc430_c?lang=ja`, fn: 'parseProblem',
            expect: { name: 'C - Truck Driver', group: 'AtCoder - AtCoder Beginner Contest 430', timeLimit: 2000, memoryLimit: 1024,
                tests: [{ input: '11 4 2\nabbaaabaaba\n', output: '3\n' }, { input: '13 1 2\nbbbbbbbbbbbbb\n', output: '0\n' }] } },
        { name: 'parseProblem old Japanese-only task', fixture: 'atcoder/task-abc001_1-old.html', url: `${AC}/contests/abc001/tasks/abc001_1`, fn: 'parseProblem',
            expect: { name: 'A - 積雪深差', group: 'AtCoder - AtCoder Beginner Contest 001', timeLimit: 2000, memoryLimit: 64,
                tests: [{ input: '15\n10\n', output: '5\n' }, { input: '0\n0\n', output: '0\n' }, { input: '5\n20\n', output: '-15\n' }] } },
        { name: 'parseProblem not a task page', fixture: 'atcoder/me-ac.html', url: ME, fn: 'parseProblem', expect: null },

        // isLoggedIn
        { name: 'isLoggedIn logged-out task page', fixture: 'atcoder/task-abc380_a-en.html', url: TASK, fn: 'isLoggedIn', expect: false },
        { name: 'isLoggedIn login page', fixture: 'atcoder/login.html', url: `${AC}/login?continue=x`, fn: 'isLoggedIn', expect: false },
        { name: 'isLoggedIn submit page', fixture: 'atcoder/submit-abc380_a.html', url: SUBMIT, fn: 'isLoggedIn', expect: true },

        // language choice on the (reconstructed) submit form
        { name: 'language cpp → GCC C++23', fixture: 'atcoder/submit-abc380_a.html', url: SUBMIT, fn: 'chooseLanguage', job: { url: TASK, language: 'cpp' }, expect: { value: '6017' } },
        { name: 'language cpp c++20 → GCC, not IOI-Style GNU++20', fixture: 'atcoder/submit-abc380_a.html', url: SUBMIT, fn: 'chooseLanguage', job: { url: TASK, language: 'cpp', std: 'c++20' }, expect: { value: '6017' } },
        { name: 'language cpp c++23 → GCC, not Clang', fixture: 'atcoder/submit-abc380_a.html', url: SUBMIT, fn: 'chooseLanguage', job: { url: TASK, language: 'cpp', std: 'c++23' }, expect: { value: '6017' } },
        { name: 'language c → GCC', fixture: 'atcoder/submit-abc380_a.html', url: SUBMIT, fn: 'chooseLanguage', job: { url: TASK, language: 'c', std: 'c11' }, expect: { value: '6014' } },
        { name: 'language python → CPython', fixture: 'atcoder/submit-abc380_a.html', url: SUBMIT, fn: 'chooseLanguage', job: { url: TASK, language: 'python' }, expect: { value: '6082' } },
        { name: 'language java', fixture: 'atcoder/submit-abc380_a.html', url: SUBMIT, fn: 'chooseLanguage', job: { url: TASK, language: 'java' }, expect: { value: '6034' } },
        { name: 'language go → go, not gccgo', fixture: 'atcoder/submit-abc380_a.html', url: SUBMIT, fn: 'chooseLanguage', job: { url: TASK, language: 'go' }, expect: { value: '6026' } },
        { name: 'language csharp → not AOT', fixture: 'atcoder/submit-abc380_a.html', url: SUBMIT, fn: 'chooseLanguage', job: { url: TASK, language: 'csharp' }, expect: { value: '6001' } },
        { name: 'language javascript → Node.js', fixture: 'atcoder/submit-abc380_a.html', url: SUBMIT, fn: 'chooseLanguage', job: { url: TASK, language: 'javascript' }, expect: { value: '6038' } },
        { name: 'language rust', fixture: 'atcoder/submit-abc380_a.html', url: SUBMIT, fn: 'chooseLanguage', job: { url: TASK, language: 'rust' }, expect: { value: '6088' } },
        { name: 'language pascal', fixture: 'atcoder/submit-abc380_a.html', url: SUBMIT, fn: 'chooseLanguage', job: { url: TASK, language: 'pascal' }, expect: { value: '6055' } },
        { name: 'language kotlin', fixture: 'atcoder/submit-abc380_a.html', url: SUBMIT, fn: 'chooseLanguage', job: { url: TASK, language: 'kotlin' }, expect: { value: '6040' } },
        { name: 'language of task B (its own list)', fixture: 'atcoder/submit-abc380_a.html', url: `${AC}/contests/abc380/submit?taskScreenName=abc380_b`, fn: 'chooseLanguage', job: { url: `${AC}/contests/abc380/tasks/abc380_b`, language: 'python' }, expect: null },

        // readSubmitError
        { name: 'readSubmitError alert on the re-shown form', fixture: 'atcoder/submit-error.html', url: SUBMIT, fn: 'readSubmitError', job, expect: 'You cannot submit the same code twice in a row.' },
        { name: 'readSubmitError clean form', fixture: 'atcoder/submit-abc380_a.html', url: SUBMIT, fn: 'readSubmitError', job, expect: null },
        { name: 'readSubmitError not on status pages', fixture: 'atcoder/me-ac.html', url: ME, fn: 'readSubmitError', job, expect: null },

        // readVerdict on /submissions/me
        { name: 'readVerdict WJ', fixture: 'atcoder/me-wj.html', url: ME, fn: 'readVerdict', job,
            expect: { final: false, code: null, text: 'Waiting for Judging', submissionUrl: NEW_URL } },
        { name: 'readVerdict judging 3/12', fixture: 'atcoder/me-judging.html', url: ME, fn: 'readVerdict', job,
            expect: { final: false, text: 'Judging 3/12', submissionUrl: NEW_URL } },
        { name: 'readVerdict judging 5/12 TLE is not final', fixture: 'atcoder/me-judging-tle.html', url: ME, fn: 'readVerdict', job,
            expect: { final: false, text: 'Judging 5/12 TLE' } },
        { name: 'readVerdict AC', fixture: 'atcoder/me-ac.html', url: ME, fn: 'readVerdict', job,
            expect: { final: true, code: 'AC', text: 'Accepted', timeMs: 12, memoryKb: 3456, points: 100, test: null, submissionUrl: NEW_URL } },
        { name: 'readVerdict WA', fixture: 'atcoder/me-wa.html', url: ME, fn: 'readVerdict', job,
            expect: { final: true, code: 'WA', text: 'Wrong Answer', timeMs: 3, memoryKb: 3584, points: 0, submissionUrl: NEW_URL } },
        { name: 'readVerdict CE (no time/memory)', fixture: 'atcoder/me-ce.html', url: ME, fn: 'readVerdict', job,
            expect: { final: true, code: 'CE', text: 'Compilation Error', timeMs: null, memoryKb: null, points: 0, submissionUrl: NEW_URL } },
        { name: 'readVerdict only older rows → null (never the earlier AC)', fixture: 'atcoder/me-old-only.html', url: ME, fn: 'readVerdict', job, expect: null },
        { name: 'readVerdict anchor from the job id when submittedAt is missing', fixture: 'atcoder/me-old-only.html', url: ME, fn: 'readVerdict', job: { id: job.id, url: TASK }, expect: null },
        { name: 'readVerdict other task → its own row', fixture: 'atcoder/me-ac.html', url: ME, fn: 'readVerdict',
            job: { id: 's_1_1', url: `${AC}/contests/abc380/tasks/abc380_b`, submittedAt: Date.UTC(2024, 10, 16, 12, 20, 0) },
            expect: { final: true, code: 'AC', points: 200, submissionUrl: `${AC}/contests/abc380/submissions/59811002` } },
        { name: 'readVerdict not on the list page', fixture: 'atcoder/me-ac.html', url: SUBMIT, fn: 'readVerdict', job, expect: null }
    ]
};
