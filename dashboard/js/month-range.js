/**
 * Month Range Filter Module
 *
 * A month-granularity range filter for the analytics page: a start month and
 * an end month, each adjustable with "previous"/"next" stepper buttons
 * (e.g. "‹ Sep 2025 ›"), plus quick presets (Last 3/6/12 Months, All Time).
 *
 * Deliberately avoids a per-month dropdown or checkbox list - with a dataset
 * spanning many months, stepping one month at a time (or jumping via a
 * preset) is far faster to operate than scanning a long list of months.
 *
 * Month keys are "YYYY-MM" strings (zero-padded), which sort/compare
 * correctly with plain string comparison.
 */

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const state = {
    availableMin: null,
    availableMax: null,
    start: null,
    end: null,
};

let changeCallback = null;

/**
 * Build a "YYYY-MM" key from a transaction's end date (local time), matching
 * the date-bucketing convention used elsewhere on the dashboard.
 * @param {Date} date - Date to key
 * @returns {string} Month key
 */
function monthKeyOf(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Split a "YYYY-MM" key into numeric year/month (month is 1-indexed).
 * @param {string} key - Month key
 * @returns {{year: number, month: number}}
 */
function monthKeyToParts(key) {
    const [year, month] = key.split('-').map(Number);
    return { year, month };
}

/**
 * Add (or subtract) whole months from a month key.
 * @param {string} key - Starting month key
 * @param {number} delta - Number of months to add (negative to subtract)
 * @returns {string} Resulting month key
 */
function addMonths(key, delta) {
    const { year, month } = monthKeyToParts(key);
    const d = new Date(year, month - 1 + delta, 1);
    return monthKeyOf(d);
}

/**
 * Number of whole months between two month keys (b - a).
 * @param {string} a - Earlier month key
 * @param {string} b - Later month key
 * @returns {number} Month count difference
 */
function monthDiff(a, b) {
    const pa = monthKeyToParts(a);
    const pb = monthKeyToParts(b);
    return (pb.year - pa.year) * 12 + (pb.month - pa.month);
}

/**
 * Clamp a month key to an inclusive [min, max] range.
 * @param {string} key - Month key to clamp
 * @param {string} min - Minimum allowed month key
 * @param {string} max - Maximum allowed month key
 * @returns {string} Clamped month key
 */
function clampKey(key, min, max) {
    if (key < min) {
        return min;
    }
    if (key > max) {
        return max;
    }
    return key;
}

/**
 * Format a month key as a short label, e.g. "Sep 2025".
 * @param {string} key - Month key
 * @returns {string} Human-readable label
 */
function formatMonthLabel(key) {
    const { year, month } = monthKeyToParts(key);
    return `${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * Set text content of an element if it exists (no-op otherwise).
 * @param {string} id - Element ID
 * @param {string} text - Text to set
 */
function setText(id, text) {
    const el = document.getElementById(id);
    if (el) {
        el.textContent = text;
    }
}

/**
 * Get the current filter range.
 * @returns {{start: string, end: string}} Current range (month keys)
 */
function getRange() {
    return { start: state.start, end: state.end };
}

/**
 * Compute the month range for a "last N months" preset, anchored to the
 * most recent month present in the data (not necessarily the current
 * calendar month), and clamped to the available data range.
 * @param {number} months - Number of months to include
 * @returns {{start: string, end: string}}
 */
function presetRange(months) {
    const end = state.availableMax;
    const start = clampKey(addMonths(end, -(months - 1)), state.availableMin, end);
    return { start, end };
}

/**
 * Re-render the stepper labels, disabled states, summary text and preset
 * active-state to match the current range.
 */
function renderControls() {
    setText('start-month-value', formatMonthLabel(state.start));
    setText('end-month-value', formatMonthLabel(state.end));

    const startPrev = document.querySelector('#start-month-stepper [data-direction="-1"]');
    const startNext = document.querySelector('#start-month-stepper [data-direction="1"]');
    const endPrev = document.querySelector('#end-month-stepper [data-direction="-1"]');
    const endNext = document.querySelector('#end-month-stepper [data-direction="1"]');

    if (startPrev) {
        startPrev.disabled = state.start <= state.availableMin;
    }
    if (startNext) {
        startNext.disabled = state.start >= state.end;
    }
    if (endPrev) {
        endPrev.disabled = state.end <= state.start;
    }
    if (endNext) {
        endNext.disabled = state.end >= state.availableMax;
    }

    const isFullRange = state.start === state.availableMin && state.end === state.availableMax;
    const totalMonths = monthDiff(state.start, state.end) + 1;
    setText(
        'month-range-summary',
        isFullRange ? 'Showing all available data' : `Showing ${totalMonths} month${totalMonths === 1 ? '' : 's'}`
    );

    document.querySelectorAll('.month-preset-btn').forEach(btn => {
        const preset = btn.dataset.preset;
        if (preset === 'all') {
            btn.classList.toggle('active', isFullRange);
            return;
        }
        // When the data range is short enough that a numeric preset coincides with
        // "All Time", only "All Time" is highlighted - it's the more meaningful label.
        if (isFullRange) {
            btn.classList.remove('active');
            return;
        }
        const target = presetRange(Number(preset));
        btn.classList.toggle('active', target.start === state.start && target.end === state.end);
    });
}

/**
 * Apply a new range: clamp it to available data, update state, re-render,
 * and notify the caller if the range actually changed.
 * @param {string} start - New start month key
 * @param {string} end - New end month key
 */
function applyRange(start, end) {
    const clampedStart = clampKey(start, state.availableMin, state.availableMax);
    const clampedEnd = clampKey(end, clampedStart, state.availableMax);

    if (clampedStart === state.start && clampedEnd === state.end) {
        return;
    }

    state.start = clampedStart;
    state.end = clampedEnd;
    renderControls();

    if (changeCallback) {
        changeCallback(getRange());
    }
}

/**
 * Attach click handlers for the stepper buttons and preset buttons.
 * Safe to call once at page load.
 */
function attachHandlers() {
    document.querySelectorAll('#start-month-stepper .month-stepper-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const delta = Number(btn.dataset.direction);
            applyRange(addMonths(state.start, delta), state.end);
        });
    });

    document.querySelectorAll('#end-month-stepper .month-stepper-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const delta = Number(btn.dataset.direction);
            applyRange(state.start, addMonths(state.end, delta));
        });
    });

    document.querySelectorAll('.month-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const preset = btn.dataset.preset;
            if (preset === 'all') {
                applyRange(state.availableMin, state.availableMax);
            } else {
                const range = presetRange(Number(preset));
                applyRange(range.start, range.end);
            }
        });
    });
}

/**
 * Initialize the month range filter: compute the available month range from
 * the full transaction set, default to showing all of it, render the
 * controls, and wire up interaction handlers.
 * @param {Array} transactions - All transactions (with endDate)
 * @param {Function} onChange - Called with {start, end} whenever the range changes
 * @returns {{start: string, end: string}} The initial (full) range
 */
export function initMonthRangeFilter(transactions, onChange) {
    changeCallback = onChange;

    const keys = transactions.map(t => monthKeyOf(t.endDate)).sort();
    const fallback = monthKeyOf(new Date());

    state.availableMin = keys.length > 0 ? keys[0] : fallback;
    state.availableMax = keys.length > 0 ? keys[keys.length - 1] : fallback;
    state.start = state.availableMin;
    state.end = state.availableMax;

    attachHandlers();
    renderControls();

    return getRange();
}

/**
 * Filter transactions to those whose end-date month falls within the given
 * range (inclusive on both ends).
 * @param {Array} transactions - Transactions to filter
 * @param {{start: string, end: string}} range - Month range (from initMonthRangeFilter/onChange)
 * @returns {Array} Filtered transactions
 */
export function filterTransactionsByMonthRange(transactions, range) {
    return transactions.filter(txn => {
        const key = monthKeyOf(txn.endDate);
        return key >= range.start && key <= range.end;
    });
}
