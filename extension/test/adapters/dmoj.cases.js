'use strict';
// DMOJ-family adapter cases (VNOJ, LQDOJ, DMOJ). Fixtures: test/fixtures/dmoj/ — each says at the top
// whether it is a REAL page (fetched anonymously, trimmed) or RECONSTRUCTED (login-only page) and from what.

const VN = 'https://oj.vnoi.info';
const LQ = 'https://lqdoj.edu.vn';
const DM = 'https://dmoj.ca';
const cpp = (std) => ({ language: 'cpp', std: std || null });

module.exports = {
    adapter: 'dmoj',
    pure: [
        // classify
        { fn: 'classify', args: [`${VN}/problem/nkpath`], expect: { kind: 'problem' } },
        { fn: 'classify', args: [`${VN}/problem/icpc22_mb_b/`], expect: { kind: 'problem' } },
        { fn: 'classify', args: [`${LQ}/problem/aplusb#comments`], expect: { kind: 'problem' } },
        { fn: 'classify', args: [`${DM}/problem/ccc23s1`], expect: { kind: 'problem' } },
        { fn: 'classify', args: [`${VN}/problem/nkpath/submit`], expect: { kind: 'submit' } },
        { fn: 'classify', args: [`${VN}/problem/nkpath/resubmit/13882796`], expect: { kind: 'submit' } },
        { fn: 'classify', args: [`${LQ}/problem/aplusb/submit`], expect: { kind: 'submit' } },
        { fn: 'classify', args: [`${DM}/problem/aplusb/submit`], expect: { kind: 'submit' } },
        { fn: 'classify', args: [`${VN}/submission/13882796`], expect: { kind: 'status' } },
        { fn: 'classify', args: [`${LQ}/submission/9832262`], expect: { kind: 'status' } },
        { fn: 'classify', args: [`${VN}/submissions/user/someone/`], expect: { kind: 'status' } },
        { fn: 'classify', args: [`${VN}/problem/nkpath/submissions/`], expect: { kind: 'status' } },
        { fn: 'classify', args: [`${VN}/problem/nkpath/editorial`], expect: { kind: 'other' } },
        { fn: 'classify', args: [`${VN}/problems/`], expect: { kind: 'other' } },
        { fn: 'classify', args: [`${LQ}/contest/abc`], expect: { kind: 'other' } },
        { fn: 'classify', args: ['not a url'], expect: { kind: 'other' } },

        // submitUrl
        { fn: 'submitUrl', args: [`${VN}/problem/nkpath`], expect: `${VN}/problem/nkpath/submit` },
        { fn: 'submitUrl', args: [`${VN}/problem/icpc22_mb_b?x=1#top`], expect: `${VN}/problem/icpc22_mb_b/submit` },
        { fn: 'submitUrl', args: [`${LQ}/problem/aplusb`], expect: `${LQ}/problem/aplusb/submit` },
        { fn: 'submitUrl', args: [`${DM}/problem/aplusb`], expect: `${DM}/problem/aplusb/submit` },
        { fn: 'submitUrl', args: [`${VN}/problem/nkpath/submit`], expect: `${VN}/problem/nkpath/submit` },
        { fn: 'submitUrl', args: [`${VN}/submission/13882796`], expect: null },
        { fn: 'submitUrl', args: [`${VN}/problems/`], expect: null }
    ],
    dom: [
        // parseProblem — real pages
        { name: 'parseProblem VNOJ nkpath (numbered Sample Input/Output headings)', fixture: 'dmoj/vnoj-problem-nkpath.html', url: `${VN}/problem/nkpath#comments`, fn: 'parseProblem',
            expect: { name: 'VOI 06 Bài 6 - Đường đi trên lưới', group: 'VNOJ', url: `${VN}/problem/nkpath`, timeLimit: 7500, memoryLimit: 512,
                tests: [{ input: '2 2\n2 4\n6 8\n', output: '4\n' }, { input: '2 2\n2 5\n6 7\n', output: '0\n' }] } },
        { name: 'parseProblem VNOJ qbmax (unnumbered headings)', fixture: 'dmoj/vnoj-problem-qbmax.html', url: `${VN}/problem/qbmax`, fn: 'parseProblem',
            expect: { name: 'Đường đi có tổng lớn nhất', tests: [{ input: /^5 7\n9 -2 6 2 1 3 4\n[\s\S]*7 -2 6 2 1 3 7\n$/, output: '41\n' }] } },
        { name: 'parseProblem VNOJ PDF statement (no samples)', fixture: 'dmoj/vnoj-problem-pdf.html', url: `${VN}/problem/icpc22_mb_b`, fn: 'parseProblem',
            expect: { name: /\S/, group: 'VNOJ', tests: [] } },
        { name: 'parseProblem VNOJ table samples (reconstructed statement)', fixture: 'dmoj/vnoj-problem-table.html', url: `${VN}/problem/qbmax`, fn: 'parseProblem',
            expect: { tests: [{ input: '1 2\n3 4\n', output: '3\n7\n' }, { input: '10 20\n', output: '30\n' }] } },
        { name: 'parseProblem LQDOJ aplusb (admonition details)', fixture: 'dmoj/lqdoj-problem-aplusb.html', url: `${LQ}/problem/aplusb`, fn: 'parseProblem',
            expect: { name: 'A cộng B', group: 'LQDOJ', url: `${LQ}/problem/aplusb`, timeLimit: 1000, memoryLimit: 256,
                tests: [{ input: '2\n1 1\n-1 0\n', output: '2\n-1\n' }] } },
        { name: 'parseProblem LQDOJ two tests with Note blocks', fixture: 'dmoj/lqdoj-problem-two-tests.html', url: `${LQ}/problem/26hsg9nanyenthanh1`, fn: 'parseProblem',
            expect: { tests: [{ input: '63\n', output: '1 3\n' }, { input: '67\n', output: '1 1\n2 1\n' }] } },
        { name: 'parseProblem LQDOJ "Sample" heading', fixture: 'dmoj/lqdoj-problem-sample-heading.html', url: `${LQ}/problem/gks2020a1`, fn: 'parseProblem',
            expect: { tests: [{ input: /^3\n4 100\n20 90 40 90\n[\s\S]*999 999 999\n$/, output: 'Case #1: 2\nCase #2: 3\nCase #3: 0\n' }] } },
        { name: 'parseProblem DMOJ aplusb (solution code blocks are not samples)', fixture: 'dmoj/dmoj-problem-aplusb.html', url: `${DM}/problem/aplusb`, fn: 'parseProblem',
            expect: { name: 'A Plus B', group: 'DMOJ', timeLimit: 5000, memoryLimit: 256, tests: [{ input: '2\n1 1\n-1 0\n', output: '2\n-1\n' }] } },
        { name: 'parseProblem on a submission page → null', fixture: 'dmoj/vnoj-status-ac.html', url: `${VN}/submission/13900001`, fn: 'parseProblem', expect: null },

        // isLoggedIn
        { name: 'isLoggedIn VNOJ anonymous', fixture: 'dmoj/vnoj-problem-nkpath.html', url: `${VN}/problem/nkpath`, fn: 'isLoggedIn', expect: false },
        { name: 'isLoggedIn LQDOJ anonymous', fixture: 'dmoj/lqdoj-problem-aplusb.html', url: `${LQ}/problem/aplusb`, fn: 'isLoggedIn', expect: false },
        { name: 'isLoggedIn DMOJ anonymous', fixture: 'dmoj/dmoj-problem-aplusb.html', url: `${DM}/problem/aplusb`, fn: 'isLoggedIn', expect: false },
        { name: 'isLoggedIn VNOJ logged in', fixture: 'dmoj/vnoj-submit.html', url: `${VN}/problem/nkpath/submit`, fn: 'isLoggedIn', expect: true },
        { name: 'isLoggedIn LQDOJ logged in', fixture: 'dmoj/lqdoj-submit.html', url: `${LQ}/problem/aplusb/submit`, fn: 'isLoggedIn', expect: true },
        { name: 'isLoggedIn DMOJ logged in', fixture: 'dmoj/dmoj-submit.html', url: `${DM}/problem/aplusb/submit`, fn: 'isLoggedIn', expect: true },

        // chooseLanguage (what fillAndSubmit selects)
        { name: 'chooseLanguage VNOJ c++17', fixture: 'dmoj/vnoj-submit.html', url: `${VN}/problem/nkpath/submit`, fn: 'chooseLanguage', job: cpp('c++17'), expect: { value: '13', text: 'C++17' } },
        { name: 'chooseLanguage VNOJ cpp, no std → newest', fixture: 'dmoj/vnoj-submit.html', url: `${VN}/problem/nkpath/submit`, fn: 'chooseLanguage', job: cpp(), expect: { value: '17', text: 'C++20' } },
        { name: 'chooseLanguage VNOJ c++23 (absent) → newest C++', fixture: 'dmoj/vnoj-submit.html', url: `${VN}/problem/nkpath/submit`, fn: 'chooseLanguage', job: cpp('c++23'), expect: { text: 'C++20' } },
        { name: 'chooseLanguage VNOJ python', fixture: 'dmoj/vnoj-submit.html', url: `${VN}/problem/nkpath/submit`, fn: 'chooseLanguage', job: { language: 'python' }, expect: { text: 'Python 3' } },
        { name: 'chooseLanguage VNOJ c', fixture: 'dmoj/vnoj-submit.html', url: `${VN}/problem/nkpath/submit`, fn: 'chooseLanguage', job: { language: 'c' }, expect: { text: 'C' } },
        { name: 'chooseLanguage LQDOJ c++14 (not Clang++)', fixture: 'dmoj/lqdoj-submit.html', url: `${LQ}/problem/aplusb/submit`, fn: 'chooseLanguage', job: cpp('c++14'), expect: { value: '5', text: 'C++14' } },
        { name: 'chooseLanguage LQDOJ python → "Python", not PyPy', fixture: 'dmoj/lqdoj-submit.html', url: `${LQ}/problem/aplusb/submit`, fn: 'chooseLanguage', job: { language: 'python' }, expect: { text: 'Python' } },
        { name: 'chooseLanguage LQDOJ javascript', fixture: 'dmoj/lqdoj-submit.html', url: `${LQ}/problem/aplusb/submit`, fn: 'chooseLanguage', job: { language: 'javascript' }, expect: { text: 'Node JS' } },
        { name: 'chooseLanguage LQDOJ rust (not allowed) → null', fixture: 'dmoj/lqdoj-submit.html', url: `${LQ}/problem/aplusb/submit`, fn: 'chooseLanguage', job: { language: 'rust' }, expect: null },
        { name: 'chooseLanguage DMOJ python (not Python 2)', fixture: 'dmoj/dmoj-submit.html', url: `${DM}/problem/aplusb/submit`, fn: 'chooseLanguage', job: { language: 'python' }, expect: { text: 'Python 3' } },
        { name: 'chooseLanguage DMOJ cpp', fixture: 'dmoj/dmoj-submit.html', url: `${DM}/problem/aplusb/submit`, fn: 'chooseLanguage', job: cpp(), expect: { text: 'C++20' } },

        // readSubmitError
        { name: 'readSubmitError VNOJ form error', fixture: 'dmoj/vnoj-submit-error.html', url: `${VN}/problem/nkpath/submit`, fn: 'readSubmitError', expect: /^VNOJ: Source code\/file is missing or redundant/ },
        { name: 'readSubmitError VNOJ clean form → null', fixture: 'dmoj/vnoj-submit.html', url: `${VN}/problem/nkpath/submit`, fn: 'readSubmitError', expect: null },
        { name: 'readSubmitError VNOJ 429 page', fixture: 'dmoj/vnoj-submit-429.html', url: `${VN}/problem/nkpath/submit`, fn: 'readSubmitError', expect: 'VNOJ: You submitted too many submissions.' },
        { name: 'readSubmitError LQDOJ generic message', fixture: 'dmoj/lqdoj-submit-banned.html', url: `${LQ}/problem/aplusb/submit`, fn: 'readSubmitError', expect: /^LQDOJ: You have exceeded the submission limit/ },
        { name: 'readSubmitError on a submission page → null', fixture: 'dmoj/vnoj-status-ac.html', url: `${VN}/submission/13900001`, fn: 'readSubmitError', expect: null },

        // readVerdict — VNOJ
        { name: 'readVerdict VNOJ queued', fixture: 'dmoj/vnoj-status-queued.html', url: `${VN}/submission/13900001`, fn: 'readVerdict',
            expect: { final: false, code: null, submissionUrl: `${VN}/submission/13900001` } },
        { name: 'readVerdict VNOJ grading', fixture: 'dmoj/vnoj-status-grading.html', url: `${VN}/submission/13900001`, fn: 'readVerdict',
            expect: { final: false, code: null, test: 3, text: 'Judging, test 3' } },
        { name: 'readVerdict VNOJ AC', fixture: 'dmoj/vnoj-status-ac.html', url: `${VN}/submission/13900001?x#1`, fn: 'readVerdict',
            expect: { final: true, code: 'AC', test: null, timeMs: 4, memoryKb: 3707, points: 3, submissionUrl: `${VN}/submission/13900001` } },
        // DMOJ's judge takes the most severe case status (SC<AC<WA<MLE<TLE<IR<RTE<OLE) as the result;
        // `test` is the first non-AC case.
        { name: 'readVerdict VNOJ WA+TLE with partial points', fixture: 'dmoj/vnoj-status-wa-partial.html', url: `${VN}/submission/13900001`, fn: 'readVerdict',
            expect: { final: true, code: 'TLE', test: 2, text: 'Quá thời gian (2/4)', timeMs: null, memoryKb: 4198, points: 2 } },
        { name: 'readVerdict VNOJ CE', fixture: 'dmoj/vnoj-status-ce.html', url: `${VN}/submission/13900001`, fn: 'readVerdict',
            expect: { final: true, code: 'CE', test: null } },
        { name: 'readVerdict VNOJ hidden test cases (TLE box)', fixture: 'dmoj/vnoj-status-hidden.html', url: `${VN}/submission/13900001`, fn: 'readVerdict',
            expect: { final: true, code: 'TLE', text: 'Quá thời gian' } },
        { name: 'readVerdict VNOJ internal error', fixture: 'dmoj/vnoj-status-ie.html', url: `${VN}/submission/13900001`, fn: 'readVerdict',
            expect: { final: true, code: 'IE' } },
        { name: 'readVerdict only on /submission/<id>', fixture: 'dmoj/vnoj-status-ac.html', url: `${VN}/problem/nkpath/submit`, fn: 'readVerdict', expect: null },
        { name: 'readVerdict on a login page → null', fixture: 'dmoj/vnoj-problem-nkpath.html', url: `${VN}/submission/13900001`, fn: 'readVerdict', expect: null },

        // readVerdict — DMOJ
        { name: 'readVerdict DMOJ RTE', fixture: 'dmoj/dmoj-status-rte.html', url: `${DM}/submission/7000001`, fn: 'readVerdict',
            expect: { final: true, code: 'RE', test: 2, timeMs: 31, memoryKb: 10363, points: 1 } },

        // readVerdict — LQDOJ
        { name: 'readVerdict LQDOJ queued', fixture: 'dmoj/lqdoj-status-queued.html', url: `${LQ}/submission/9900001`, fn: 'readVerdict',
            expect: { final: false, code: null } },
        { name: 'readVerdict LQDOJ grading (no spinner, no overall row)', fixture: 'dmoj/lqdoj-status-grading.html', url: `${LQ}/submission/9900001`, fn: 'readVerdict',
            expect: { final: false, code: null, test: 2 } },
        { name: 'readVerdict LQDOJ AC', fixture: 'dmoj/lqdoj-status-ac.html', url: `${LQ}/submission/9900001`, fn: 'readVerdict',
            expect: { final: true, code: 'AC', test: null, timeMs: 7, memoryKb: 3891, points: 100, submissionUrl: `${LQ}/submission/9900001` } },
        { name: 'readVerdict LQDOJ TLE 50/100', fixture: 'dmoj/lqdoj-status-tle.html', url: `${LQ}/submission/9900001`, fn: 'readVerdict',
            expect: { final: true, code: 'TLE', test: 2, timeMs: null, memoryKb: 12800, points: 50, text: 'Quá thời gian (50/100)' } },
        { name: 'readVerdict LQDOJ CE', fixture: 'dmoj/lqdoj-status-ce.html', url: `${LQ}/submission/9900001`, fn: 'readVerdict',
            expect: { final: true, code: 'CE' } },
        { name: 'readVerdict LQDOJ graded without overall row (hidden subtasks)', fixture: 'dmoj/lqdoj-status-wa-subtasks.html', url: `${LQ}/submission/9900001`, fn: 'readVerdict',
            expect: { final: true, code: 'WA', test: 2 } }
    ]
};
