// CSES adapter cases. Fixtures: task-* are real (anonymous fetch); submit-* and result-* are
// RECONSTRUCTED (login-only) — see the comment at the top of each file.
const T = 'https://cses.fi/problemset/task/1068';
const JOB = { url: T, language: 'cpp' };

module.exports = {
    adapter: 'cses',
    pure: [
        { fn: 'classify', args: ['https://cses.fi/problemset/task/1068'], expect: { kind: 'problem' } },
        { fn: 'classify', args: ['https://cses.fi/problemset/task/1068/'], expect: { kind: 'problem' } },
        { fn: 'classify', args: ['https://cses.fi/dt/task/1058'], expect: { kind: 'problem' } },
        { fn: 'classify', args: ['https://cses.fi/problemset/submit/1068/'], expect: { kind: 'submit' } },
        { fn: 'classify', args: ['https://cses.fi/problemset/submit/1068'], expect: { kind: 'submit' } },
        { fn: 'classify', args: ['https://cses.fi/problemset/result/9876543/'], expect: { kind: 'status' } },
        { fn: 'classify', args: ['https://cses.fi/problemset/result/9876543'], expect: { kind: 'status' } },
        { fn: 'classify', args: ['https://cses.fi/problemset/list/'], expect: { kind: 'other' } },
        { fn: 'classify', args: ['https://cses.fi/problemset/stats/1068/'], expect: { kind: 'other' } },
        { fn: 'classify', args: ['https://cses.fi/'], expect: { kind: 'other' } },
        { fn: 'classify', args: ['not a url'], expect: { kind: 'other' } },
        { fn: 'submitUrl', args: ['https://cses.fi/problemset/task/1068'], expect: 'https://cses.fi/problemset/submit/1068/' },
        { fn: 'submitUrl', args: ['https://cses.fi/problemset/task/1068/#x'], expect: 'https://cses.fi/problemset/submit/1068/' },
        { fn: 'submitUrl', args: ['https://cses.fi/problemset/submit/1068/'], expect: 'https://cses.fi/problemset/submit/1068/' },
        { fn: 'submitUrl', args: ['https://cses.fi/dt/task/1058'], expect: 'https://cses.fi/dt/submit/1058/' },
        { fn: 'submitUrl', args: ['https://cses.fi/problemset/list/'], expect: null }
    ],
    dom: [
        { name: 'parseProblem single example (real 1068)', fixture: 'cses/task-1068.html', url: T, fn: 'parseProblem',
          expect: { name: 'Weird Algorithm', group: 'CSES Problem Set', url: T, timeLimit: 1000, memoryLimit: 512,
              tests: [{ input: '3\n', output: '3 10 5 16 8 4 2 1\n' }] } },
        { name: 'parseProblem multi-line example (real 1071)', fixture: 'cses/task-1071.html', url: 'https://cses.fi/problemset/task/1071/', fn: 'parseProblem',
          expect: { name: 'Number Spiral', timeLimit: 1000, memoryLimit: 512,
              tests: [{ input: '3\n2 3\n1 1\n4 2\n', output: '8\n1\n15\n' }] } },
        { name: 'parseProblem course task (real dt/1058)', fixture: 'cses/task-course-dt-1058.html', url: 'https://cses.fi/dt/task/1058', fn: 'parseProblem',
          expect: { name: 'Permutaatiot', group: 'Datatähti-valmennus', timeLimit: 1000, memoryLimit: 128,
              tests: [{ input: '4\n', output: '2\n' }] } },
        { name: 'parseProblem several examples (synthetic)', fixture: 'cses/task-multi-example.html', url: T, fn: 'parseProblem',
          expect: { name: 'Weird Algorithm',
              tests: [{ input: '3\n', output: '3 10 5 16 8 4 2 1\n' }, { input: '1\n', output: '1\n' }] } },
        { name: 'parseProblem no example (synthetic)', fixture: 'cses/task-no-example.html', url: T, fn: 'parseProblem',
          expect: { name: 'Weird Algorithm', timeLimit: 1000, tests: [] } },
        { name: 'parseProblem on a submit page is null', fixture: 'cses/submit-form.html', url: 'https://cses.fi/problemset/submit/1068/', fn: 'parseProblem', expect: null },

        { name: 'isLoggedIn false (real, Login link)', fixture: 'cses/task-1068.html', url: T, fn: 'isLoggedIn', expect: false },
        { name: 'isLoggedIn false (logged-out submit page)', fixture: 'cses/submit-logged-out.html', url: 'https://cses.fi/problemset/submit/1068/', fn: 'isLoggedIn', expect: false },
        { name: 'isLoggedIn true (reconstructed)', fixture: 'cses/submit-form.html', url: 'https://cses.fi/problemset/submit/1068/', fn: 'isLoggedIn', expect: true },

        { name: 'readSubmitError none on a clean form', fixture: 'cses/submit-form.html', url: 'https://cses.fi/problemset/submit/1068/', fn: 'readSubmitError', expect: null },
        { name: 'readSubmitError message', fixture: 'cses/submit-error.html', url: 'https://cses.fi/problemset/submit/1068/', fn: 'readSubmitError', expect: /once per minute/ },

        { name: 'readVerdict pending', fixture: 'cses/result-pending.html', url: 'https://cses.fi/problemset/result/9876543/', fn: 'readVerdict', job: JOB,
          expect: { final: false, code: null, text: 'PENDING', submissionUrl: 'https://cses.fi/problemset/result/9876543/' } },
        { name: 'readVerdict testing', fixture: 'cses/result-testing.html', url: 'https://cses.fi/problemset/result/9876543/', fn: 'readVerdict', job: JOB,
          expect: { final: false, text: 'TESTING' } },
        { name: 'readVerdict accepted', fixture: 'cses/result-ac.html', url: 'https://cses.fi/problemset/result/9876543/', fn: 'readVerdict', job: JOB,
          expect: { final: true, code: 'AC', text: 'ACCEPTED', test: null, timeMs: 340, memoryKb: null, submissionUrl: 'https://cses.fi/problemset/result/9876543/' } },
        { name: 'readVerdict wrong answer', fixture: 'cses/result-wa.html', url: 'https://cses.fi/problemset/result/9876543/', fn: 'readVerdict', job: JOB,
          expect: { final: true, code: 'WA', text: 'WRONG ANSWER', test: 3, timeMs: 1000 } },
        { name: 'readVerdict compile error', fixture: 'cses/result-ce.html', url: 'https://cses.fi/problemset/result/9876543/', fn: 'readVerdict', job: JOB,
          expect: { final: true, code: 'CE', test: null, timeMs: null } },
        { name: 'readVerdict ignores a result page of another task', fixture: 'cses/result-ac.html', url: 'https://cses.fi/problemset/result/9876543/', fn: 'readVerdict',
          job: { url: 'https://cses.fi/problemset/task/1071', language: 'cpp' }, expect: null },
        { name: 'readVerdict only on a result URL', fixture: 'cses/result-ac.html', url: 'https://cses.fi/problemset/submit/1068/', fn: 'readVerdict', job: JOB, expect: null }
    ]
};
