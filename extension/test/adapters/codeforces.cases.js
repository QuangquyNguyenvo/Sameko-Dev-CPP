'use strict';
// Codeforces adapter cases. Fixtures: test/fixtures/codeforces/ — each says at the top whether it is a
// REAL page (fetched anonymously, trimmed) or RECONSTRUCTED (login-only page) and from what.

const CF = 'https://codeforces.com';
const statusRow = (id) => `${CF}/problemset/submission/${id}`;

module.exports = {
    adapter: 'codeforces',
    pure: [
        // classify: problem pages
        { fn: 'classify', args: [`${CF}/contest/1900/problem/A`], expect: { kind: 'problem' } },
        { fn: 'classify', args: [`${CF}/contest/1916/problem/H2`], expect: { kind: 'problem' } },
        { fn: 'classify', args: [`${CF}/problemset/problem/4/A`], expect: { kind: 'problem' } },
        { fn: 'classify', args: [`${CF}/gym/102942/problem/A`], expect: { kind: 'problem' } },
        { fn: 'classify', args: [`${CF}/problemset/gymProblem/102942/A`], expect: { kind: 'problem' } },
        { fn: 'classify', args: [`${CF}/group/MWSDmqGsZm/contest/219158/problem/B`], expect: { kind: 'problem' } },
        { fn: 'classify', args: [`${CF}/edu/course/2/lesson/6/1/practice/contest/283911/problem/A`], expect: { kind: 'problem' } },
        { fn: 'classify', args: [`${CF}/problemsets/acmsguru/problem/99999/100`], expect: { kind: 'problem' } },
        { fn: 'classify', args: ['https://m1.codeforces.com/contest/1900/problem/A?locale=en#x'], expect: { kind: 'problem' } },
        // classify: submit pages (also the form re-shown after a rejected POST)
        { fn: 'classify', args: [`${CF}/contest/1900/submit`], expect: { kind: 'submit' } },
        { fn: 'classify', args: [`${CF}/contest/1900/submit?csrf_token=abc`], expect: { kind: 'submit' } },
        { fn: 'classify', args: [`${CF}/problemset/submit`], expect: { kind: 'submit' } },
        { fn: 'classify', args: [`${CF}/gym/102942/submit`], expect: { kind: 'submit' } },
        { fn: 'classify', args: [`${CF}/group/MWSDmqGsZm/contest/219158/submit`], expect: { kind: 'submit' } },
        { fn: 'classify', args: [`${CF}/problemsets/acmsguru/submit/99999/100`], expect: { kind: 'submit' } },
        // classify: status pages
        { fn: 'classify', args: [`${CF}/contest/1900/my`], expect: { kind: 'status' } },
        { fn: 'classify', args: [`${CF}/contest/1900/status`], expect: { kind: 'status' } },
        { fn: 'classify', args: [`${CF}/problemset/status?my=on`], expect: { kind: 'status' } },
        { fn: 'classify', args: [`${CF}/gym/102942/my`], expect: { kind: 'status' } },
        { fn: 'classify', args: [`${CF}/group/MWSDmqGsZm/contest/219158/my`], expect: { kind: 'status' } },
        { fn: 'classify', args: [`${CF}/submissions/tourist`], expect: { kind: 'status' } },
        { fn: 'classify', args: [`${CF}/contest/1900/submission/398099775`], expect: { kind: 'status' } },
        { fn: 'classify', args: [statusRow('161/398103511')], expect: { kind: 'status' } },
        // classify: everything else
        { fn: 'classify', args: [`${CF}/contest/1900`], expect: { kind: 'other' } },
        { fn: 'classify', args: [`${CF}/problemset`], expect: { kind: 'other' } },
        { fn: 'classify', args: [`${CF}/blog/entry/1`], expect: { kind: 'other' } },
        { fn: 'classify', args: ['not a url'], expect: { kind: 'other' } },

        // submitUrl
        { fn: 'submitUrl', args: [`${CF}/contest/1900/problem/A`], expect: `${CF}/contest/1900/submit` },
        { fn: 'submitUrl', args: [`${CF}/problemset/problem/4/A`], expect: `${CF}/problemset/submit` },
        { fn: 'submitUrl', args: [`${CF}/gym/102942/problem/A`], expect: `${CF}/gym/102942/submit` },
        { fn: 'submitUrl', args: [`${CF}/problemset/gymProblem/102942/A`], expect: `${CF}/gym/102942/submit` },
        { fn: 'submitUrl', args: [`${CF}/group/MWSDmqGsZm/contest/219158/problem/B`], expect: `${CF}/group/MWSDmqGsZm/contest/219158/submit` },
        { fn: 'submitUrl', args: [`${CF}/edu/course/2/lesson/6/1/practice/contest/283911/problem/A`], expect: `${CF}/edu/course/2/lesson/6/1/practice/contest/283911/submit` },
        { fn: 'submitUrl', args: [`${CF}/problemsets/acmsguru/problem/99999/100`], expect: `${CF}/problemsets/acmsguru/submit/99999/100` },
        { fn: 'submitUrl', args: ['https://m2.codeforces.com/contest/1900/problem/A'], expect: 'https://m2.codeforces.com/contest/1900/submit' },
        { fn: 'submitUrl', args: [`${CF}/contest/1900`], expect: null },
        { fn: 'submitUrl', args: [`${CF}/contest/1900/my`], expect: null }
    ],
    dom: [
        // parseProblem — real pages
        { name: 'parseProblem 1900A (test-example-line input, multi-test)', fixture: 'codeforces/contest-1900A.html', url: `${CF}/contest/1900/problem/A#top`, fn: 'parseProblem',
            expect: { name: 'A. Cover in Water', group: 'Codeforces - Codeforces Round 911 (Div. 2)', url: `${CF}/contest/1900/problem/A`, timeLimit: 1000, memoryLimit: 256,
                tests: [{ input: '5\n3\n...\n7\n##....#\n7\n..#.#..\n4\n####\n10\n#...#..#.#\n', output: '2\n2\n5\n0\n2\n' }] } },
        { name: 'parseProblem 4A (<br> samples)', fixture: 'codeforces/problemset-4A.html', url: `${CF}/problemset/problem/4/A`, fn: 'parseProblem',
            expect: { name: 'A. Watermelon', group: /^Codeforces - Codeforces Beta Round/, timeLimit: 1000, memoryLimit: 64, tests: [{ input: '8\n', output: 'YES\n' }] } },
        { name: 'parseProblem 1352G (plain newlines, trailing spaces kept)', fixture: 'codeforces/contest-1352G.html', url: `${CF}/contest/1352/problem/G`, fn: 'parseProblem',
            expect: { name: 'G. Special Permutation', timeLimit: 2000, memoryLimit: 256,
                tests: [{ input: '6\n10\n2\n4\n6\n7\n13\n', output: /^9 6 10 8 4 7 3 1 5 2 \n-1\n3 1 4 2 \n[\s\S]*12\n$/ }] } },
        { name: 'parseProblem gym 102942A', fixture: 'codeforces/gym-102942A.html', url: `${CF}/gym/102942/problem/A`, fn: 'parseProblem',
            expect: { name: 'A. Directional Move', group: 'Codeforces - Noobs Round #2 (Div. 4) by Rudro25', timeLimit: 1000, memoryLimit: 256,
                tests: [{ input: '3\n4\n1010\n5\n00000\n3\n111\n', output: 'E\nS\nS\n' }] } },
        { name: 'parseProblem acmsguru 100', fixture: 'codeforces/acmsguru-100.html', url: `${CF}/problemsets/acmsguru/problem/99999/100`, fn: 'parseProblem',
            expect: { name: '100. A+B', group: 'Codeforces - acm.sgu.ru archive', timeLimit: 250, memoryLimit: 64, tests: [{ input: '5 3\n', output: '8\n' }] } },
        { name: 'parseProblem on a status page → null', fixture: 'codeforces/contest-1900-status.html', url: `${CF}/contest/1900/status`, fn: 'parseProblem', expect: null },

        // isLoggedIn
        { name: 'isLoggedIn false (real anonymous page)', fixture: 'codeforces/contest-1900A.html', url: `${CF}/contest/1900/problem/A`, fn: 'isLoggedIn', expect: false },
        { name: 'isLoggedIn true (reconstructed header)', fixture: 'codeforces/submit-contest.html', url: `${CF}/contest/1900/submit`, fn: 'isLoggedIn', expect: true },

        // language choice on the submit form (what fillAndSubmit selects)
        { name: 'language cpp, no std → newest GCC', fixture: 'codeforces/submit-contest.html', url: `${CF}/contest/1900/submit`, fn: 'chooseLanguage', job: { language: 'cpp' }, expect: { value: '91' } },
        { name: 'language cpp c++17', fixture: 'codeforces/submit-contest.html', url: `${CF}/contest/1900/submit`, fn: 'chooseLanguage', job: { language: 'cpp', std: 'c++17' }, expect: { value: '54' } },
        { name: 'language cpp c++20 → GCC, not Clang', fixture: 'codeforces/submit-contest.html', url: `${CF}/contest/1900/submit`, fn: 'chooseLanguage', job: { language: 'cpp', std: 'c++20' }, expect: { value: '89' } },
        { name: 'language c', fixture: 'codeforces/submit-contest.html', url: `${CF}/contest/1900/submit`, fn: 'chooseLanguage', job: { language: 'c', std: 'c11' }, expect: { value: '43' } },
        { name: 'language python', fixture: 'codeforces/submit-contest.html', url: `${CF}/contest/1900/submit`, fn: 'chooseLanguage', job: { language: 'python' }, expect: { value: '31' } },
        { name: 'language java', fixture: 'codeforces/submit-contest.html', url: `${CF}/contest/1900/submit`, fn: 'chooseLanguage', job: { language: 'java' }, expect: { value: '87' } },
        { name: 'language rust', fixture: 'codeforces/submit-contest.html', url: `${CF}/contest/1900/submit`, fn: 'chooseLanguage', job: { language: 'rust' }, expect: { value: '98' } },
        { name: 'language javascript', fixture: 'codeforces/submit-contest.html', url: `${CF}/contest/1900/submit`, fn: 'chooseLanguage', job: { language: 'javascript' }, expect: { value: '55' } },
        { name: 'language kotlin', fixture: 'codeforces/submit-contest.html', url: `${CF}/contest/1900/submit`, fn: 'chooseLanguage', job: { language: 'kotlin' }, expect: { value: '99' } },
        { name: 'language pascal', fixture: 'codeforces/submit-contest.html', url: `${CF}/contest/1900/submit`, fn: 'chooseLanguage', job: { language: 'pascal' }, expect: { value: '4' } },
        { name: 'language old labels, cpp → G++23', fixture: 'codeforces/submit-problemset-error.html', url: `${CF}/problemset/submit`, fn: 'chooseLanguage', job: { language: 'cpp' }, expect: { value: '91' } },
        { name: 'language old labels, cpp c++20', fixture: 'codeforces/submit-problemset-error.html', url: `${CF}/problemset/submit`, fn: 'chooseLanguage', job: { language: 'cpp', std: 'c++20' }, expect: { value: '89' } },

        // readSubmitError
        { name: 'readSubmitError duplicate code', fixture: 'codeforces/submit-problemset-error.html', url: `${CF}/problemset/submit?csrf_token=0ada58a5a400251f3e15027bbc8f52b4`, fn: 'readSubmitError', expect: 'You have submitted exactly the same code before' },
        { name: 'readSubmitError clean form → null', fixture: 'codeforces/submit-contest.html', url: `${CF}/contest/1900/submit`, fn: 'readSubmitError', expect: null },
        { name: 'readSubmitError not a submit page → null', fixture: 'codeforces/contest-1900-my.html', url: `${CF}/contest/1900/my`, fn: 'readSubmitError', expect: null },

        // readVerdict — real public status rows (same table as "my")
        { name: 'readVerdict in queue', fixture: 'codeforces/problemset-status.html', url: `${CF}/problemset/status`, fn: 'readVerdict', job: { url: `${CF}/problemset/problem/161/D` },
            expect: { final: false, code: null, text: 'In queue', submissionUrl: statusRow('161/398103511') } },
        { name: 'readVerdict running on test 1', fixture: 'codeforces/problemset-status.html', url: `${CF}/problemset/status`, fn: 'readVerdict', job: { url: `${CF}/contest/2020/problem/C` },
            expect: { final: false, code: null, text: 'Running on test 1', test: 1 } },
        { name: 'readVerdict accepted', fixture: 'codeforces/problemset-status.html', url: `${CF}/problemset/status`, fn: 'readVerdict', job: { url: `${CF}/problemset/problem/1872/F` },
            expect: { final: true, code: 'AC', text: 'Accepted', test: null, submissionUrl: statusRow('1872/398103506') } },
        { name: 'readVerdict wrong answer on test 4', fixture: 'codeforces/problemset-status.html', url: `${CF}/problemset/status`, fn: 'readVerdict', job: { url: `${CF}/problemset/problem/1380/D` },
            expect: { final: true, code: 'WA', text: 'Wrong answer on test 4', test: 4 } },
        { name: 'readVerdict compilation error', fixture: 'codeforces/problemset-status.html', url: `${CF}/problemset/status`, fn: 'readVerdict', job: { url: `${CF}/problemset/problem/2218/B` },
            expect: { final: true, code: 'CE', text: 'Compilation error', test: null } },
        { name: 'readVerdict TLE on test 17', fixture: 'codeforces/problemset-status.html', url: `${CF}/problemset/status`, fn: 'readVerdict', job: { url: `${CF}/problemset/problem/593/D` },
            expect: { final: true, code: 'TLE', test: 17 } },
        { name: 'readVerdict MLE on test 5', fixture: 'codeforces/problemset-status.html', url: `${CF}/problemset/status`, fn: 'readVerdict', job: { url: `${CF}/problemset/problem/1904/F` },
            expect: { final: true, code: 'MLE', test: 5 } },
        { name: 'readVerdict RE on test 13', fixture: 'codeforces/problemset-status.html', url: `${CF}/problemset/status`, fn: 'readVerdict', job: { url: `${CF}/problemset/problem/510/C` },
            expect: { final: true, code: 'RE', test: 13 } },
        { name: 'readVerdict contest table: newest row of the problem, time+memory', fixture: 'codeforces/contest-1900-status.html', url: `${CF}/contest/1900/status`, fn: 'readVerdict', job: { url: `${CF}/contest/1900/problem/A` },
            expect: { final: true, code: 'AC', timeMs: 46, memoryKb: 0, submissionUrl: `${CF}/contest/1900/submission/398099775` } },
        { name: 'readVerdict other problem only → null', fixture: 'codeforces/contest-1900-status.html', url: `${CF}/contest/1900/status`, fn: 'readVerdict', job: { url: `${CF}/contest/1900/problem/B` }, expect: null },
        { name: 'readVerdict rows older than the submit time → null', fixture: 'codeforces/contest-1900-status.html', url: `${CF}/contest/1900/status`, fn: 'readVerdict',
            job: { url: `${CF}/contest/1900/problem/A`, submittedAt: Date.UTC(2026, 10, 11, 7, 0) }, expect: null },          // 10:00 MSK; rows are ≤ 09:44
        { name: 'readVerdict row just after the submit time', fixture: 'codeforces/contest-1900-status.html', url: `${CF}/contest/1900/status`, fn: 'readVerdict',
            job: { url: `${CF}/contest/1900/problem/A`, submittedAt: Date.UTC(2026, 10, 11, 6, 45) }, expect: { final: true, code: 'AC' } },

        // readVerdict — reconstructed "my" page
        { name: 'readVerdict my: new running row, old AC ignored', fixture: 'codeforces/contest-1900-my.html', url: `${CF}/contest/1900/my`, fn: 'readVerdict',
            job: { url: `${CF}/contest/1900/problem/A`, baselineId: 398100001 }, expect: { final: false, text: 'Running on test 7', test: 7, submissionUrl: `${CF}/contest/1900/submission/398200105` } },
        { name: 'readVerdict my: only rows from before the submit → null', fixture: 'codeforces/contest-1900-my.html', url: `${CF}/contest/1900/my`, fn: 'readVerdict',
            job: { url: `${CF}/contest/1900/problem/A`, baselineId: 398200105 }, expect: null },
        { name: 'readVerdict my: partial points', fixture: 'codeforces/contest-1900-my.html', url: `${CF}/contest/1900/my`, fn: 'readVerdict',
            job: { url: `${CF}/contest/1900/problem/B` }, expect: { final: true, code: 'PARTIAL', points: 30, timeMs: 187, memoryKb: 3584 } },
        { name: 'readVerdict on a problem page → null', fixture: 'codeforces/contest-1900A.html', url: `${CF}/contest/1900/problem/A`, fn: 'readVerdict', job: { url: `${CF}/contest/1900/problem/A` }, expect: null }
    ]
};
