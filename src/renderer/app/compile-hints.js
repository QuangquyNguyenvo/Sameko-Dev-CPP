const CompileHints = (() => {
    const headers = {
        iostream: 'cin cout cerr clog endl',
        vector: 'vector',
        string: 'string to_string stoi stod getline',
        array: 'array',
        deque: 'deque',
        list: 'list',
        map: 'map multimap',
        set: 'set multiset',
        unordered_map: 'unordered_map',
        unordered_set: 'unordered_set',
        queue: 'queue priority_queue',
        stack: 'stack',
        algorithm: 'sort stable_sort reverse min max lower_bound upper_bound find count',
        numeric: 'accumulate iota gcd lcm',
        utility: 'pair make_pair swap move',
        tuple: 'tuple make_tuple',
        cmath: 'pow sqrt floor ceil',
        limits: 'numeric_limits',
        memory: 'unique_ptr shared_ptr make_unique make_shared'
    };
    const headerByName = new Map(Object.entries(headers).flatMap(([header, names]) =>
        names.split(' ').map(name => [name, header])
    ));
    const rules = [
        [/^expected ['‘];/i, 'Add a semicolon where the statement ends. Check the line above the error too.'],
        [/^no matching function/i, 'Check the number and types of the arguments against the function declaration.'],
        [/^invalid conversion/i, 'This conversion is invalid. Check the source and destination types, including pointers and const.'],
        [/^(?:cannot|could not) convert/i, 'The value has a different type from what this assignment, argument or return expects.'],
        [/^redefinition of/i, 'This name is already defined. Look for the earlier definition and remove or rename the duplicate.'],
        [/^lvalue required/i, 'This operation needs a writable location, such as a variable or an array element.'],
        [/undefined (?:reference to|symbol:)\s*['‘\x60"]?(?:_?(?:WinMain|wWinMain)(?:@\d+)?|main)(?=['’'"\s(]|$)/i,
            'The linker cannot find the program entry point. Check that the files being built include an int main() definition.'],
        [/was not declared in this scope/i, 'Check the spelling and make sure the name is declared before use and visible in this scope.'],
        [/^expected .+ before\b/i, 'The compiler reached this token while expecting something else. Check the punctuation and brackets just before it.']
    ];

    function parseDiagnostic(line) {
        const match = /^(.+?):(\d+)(?::(\d+))?:\s*(fatal error|error|warning):\s*(.+)$/.exec(line);
        if (!match) return null;
        return {
            file: match[1], line: Number(match[2]), col: Number(match[3]) || 1,
            type: match[4] === 'warning' ? 'warning' : 'error', message: match[5]
        };
    }

    function explain(message) {
        const missingName = /^['‘](?:std::)?(\w+)['’](?: in namespace ['‘]std['’])?\s+(?:is not a member of ['‘]std['’]|was not declared\b|has not been declared\b|does not name a (?:template )?type\b)/.exec(message);
        const name = missingName?.[1];
        const header = headerByName.get(name);
        if (header) return 'For {0}, check that you included <{1}> and used the std:: prefix.'
            .replace('{0}', name).replace('{1}', header);
        return rules.find(([pattern]) => pattern.test(message))?.[1] || '';
    }

    function firstError(text) {
        const lines = text.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/);
        for (const [index, line] of lines.entries()) {
            const diagnostic = parseDiagnostic(line);
            if (diagnostic?.type === 'warning') continue;
            const message = diagnostic?.message || /(?:^|\s)(undefined reference to|undefined symbol:|multiple definition of)\s+.+/.exec(line)?.[0]?.trim()
                || /^(?:[^:]+:\s*)?(?:fatal )?error:\s*(.+)$/.exec(line)?.[1];
            if (message) return { index, hint: explain(message) };
        }
        return null;
    }

    return { firstError, parseDiagnostic };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CompileHints;
else window.CompileHints = CompileHints;
