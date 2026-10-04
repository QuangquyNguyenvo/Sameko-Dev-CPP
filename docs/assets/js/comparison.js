(function () {
    'use strict';
    const section = document.getElementById('comparison');
    const table = section && section.querySelector('.cmp__table');
    const frame = section && section.querySelector('.cmp');
    if (!table || !frame || !table.tHead || !table.tBodies.length) return;

    const headers = Array.from(table.tHead.rows[0].cells);
    const rows = Array.from(table.rows);
    const compact = window.matchMedia('(max-width: 1100px)');
    if (headers.length < 3) return;

    const controls = document.createElement('div');
    controls.className = 'cmp__controls';
    controls.hidden = true;
    const label = document.createElement('label');
    label.htmlFor = 'compare-ide';
    label.textContent = 'Compare Sameko with';
    const select = document.createElement('select');
    select.id = 'compare-ide';
    select.setAttribute('aria-controls', 'compare-table');
    headers.slice(2).forEach((header, index) => {
        const option = document.createElement('option');
        option.value = String(index + 2);
        option.textContent = header.textContent.trim();
        select.appendChild(option);
    });
    const hint = document.createElement('span');
    hint.className = 'cmp__hint';
    hint.textContent = 'One matchup at a time. Same details, easier to read.';
    controls.append(label, select, hint);
    const status = document.createElement('span');
    status.className = 'sr-only';
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    controls.appendChild(status);
    frame.before(controls);
    table.id = 'compare-table';
    table.setAttribute('role', 'table');
    rows.forEach(row => {
        row.setAttribute('role', 'row');
        Array.from(row.cells).forEach(cell => cell.setAttribute('role',
            cell.tagName === 'TD' ? 'cell' : cell.scope === 'row' ? 'rowheader' : 'columnheader'));
    });
    frame.classList.add('cmp--ready');

    function updateColumns(animate) {
        const selectedColumn = Number(select.value);
        controls.hidden = !compact.matches;
        if (animate) status.textContent = 'Showing Sameko Dev C++ alongside ' + headers[selectedColumn].textContent.trim() + '.';
        frame.classList.toggle('cmp--pair', compact.matches);
        rows.forEach(row => Array.from(row.cells).forEach((cell, index) => {
            cell.hidden = compact.matches && index > 1 && index !== selectedColumn;
            cell.classList.toggle('cmp__opponent', index === selectedColumn);
        }));
        if (animate && window.gsap && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            gsap.fromTo(table.querySelectorAll('.cmp__opponent'), { opacity: 0.55, y: 5 }, {
                opacity: 1, y: 0, duration: 0.25, ease: 'power2.out', overwrite: true,
                clearProps: 'transform,opacity'
            });
        }
        if (window.ScrollTrigger) requestAnimationFrame(() => ScrollTrigger.refresh());
    }
    select.addEventListener('change', () => updateColumns(true));
    if (compact.addEventListener) compact.addEventListener('change', () => updateColumns(false));
    else compact.addListener(() => updateColumns(false));
    updateColumns(false);
})();
