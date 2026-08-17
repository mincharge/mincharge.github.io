/**
 * Congestion / Queueing Analysis Module
 *
 * Detects likely queueing at a charging connector: when the same connector
 * (identified by station + charger ID + connector ID) starts a new charging
 * session within a short window of a previous session on that exact connector
 * ending, it is a strong signal that a driver was waiting for it to free up.
 *
 * Connectors on the same physical charger are tracked independently - two
 * connectors can charge different vehicles at the same time, so a session on
 * connector 2 starting while connector 1 is still busy is normal concurrent
 * use, not a queue. Only back-to-back sessions on the *same* connector count.
 *
 * Definitions:
 * - "Eligible session": a transaction with a known charger ID and units_kwh > 0.
 *   Zero-energy sessions (failed connections, RFID test taps, etc.) are excluded
 *   because they do not represent genuine demand for the connector.
 * - "Queued session": an eligible session that started within `thresholdMinutes`
 *   of the previous eligible session ending on the same connector (gap >= 0,
 *   i.e. not overlapping - overlapping sessions are a data anomaly on the same
 *   connector, since two vehicles cannot occupy one connector simultaneously),
 *   UNLESS it is the same customer/vehicle repeating (see below), in which case
 *   it is not counted as queueing at all.
 * - "Same customer/vehicle repeat": consecutive sessions on the same connector
 *   sharing the same `customer_key` (a hashed customer+vehicle identity computed
 *   at build time - see `scripts/build_dashboard_data.py`). A driver whose
 *   session ends early and who immediately reconnects is not a queue of two
 *   different vehicles; their combined occupancy is treated as continuous, and
 *   only a *different* customer/vehicle arriving afterwards counts as queued.
 * - "Queue episode": a maximal run of 2+ consecutive eligible sessions on the
 *   same connector where every consecutive gap is within `thresholdMinutes`
 *   and each represents a different customer/vehicle (or unknown identity).
 *   The episode "depth" is the number of vehicles involved (the first vehicle
 *   was not queued; every subsequent vehicle in the run was).
 */

import { getStationColor } from './charts.js';

/** Default detection threshold, in minutes, per project requirements (2-3 min). */
export const DEFAULT_THRESHOLD_MINUTES = 3;

/**
 * Determine whether a transaction is eligible for congestion analysis.
 * @param {Object} txn - Transaction object
 * @returns {boolean} True if eligible
 */
function isEligible(txn) {
    return Boolean(txn.charger) && txn.units_kwh > 0;
}

/**
 * Build the grouping key for "same connector at same location". Includes
 * connector ID - each connector is tracked as its own independent queue.
 * @param {Object} txn - Transaction object
 * @returns {string} Grouping key
 */
function connectorKey(txn) {
    return `${txn.station}\u0001${txn.charger}\u0001${txn.connector}`;
}

/**
 * Split a connector key back into its station, charger and connector parts.
 * @param {string} key - Key produced by connectorKey()
 * @returns {{station: string, charger: string, connector: string}}
 */
function splitConnectorKey(key) {
    const [station, charger, connector] = key.split('\u0001');
    return { station, charger, connector };
}

/**
 * Count items by a derived key.
 * @param {Array} items - Items to count
 * @param {Function} keyFn - Function mapping an item to a key
 * @returns {Map<string, number>} Map of key -> count
 */
function countByKey(items, keyFn) {
    const map = new Map();
    items.forEach(item => {
        const key = keyFn(item);
        map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
}

/**
 * Determine whether two transactions represent the same customer/vehicle,
 * based on the hashed `customer_key` computed at build time. Returns false
 * (i.e. "treat as different"/unknown) whenever either key is missing, which
 * is the conservative default - the existing customer-unaware detection
 * simply applies in that case.
 * @param {Object} a - First transaction
 * @param {Object} b - Second transaction
 * @returns {boolean} True only if both have the same non-null customer_key
 */
function isSameCustomer(a, b) {
    return Boolean(a.customer_key) && Boolean(b.customer_key) && a.customer_key === b.customer_key;
}

/**
 * Detect queue episodes across all connectors.
 * @param {Array} eligible - Eligible transactions (see isEligible)
 * @param {number} thresholdMinutes - Max gap (minutes) counted as queueing
 * @returns {{episodes: Array, sameCustomerExclusions: number}} Episodes and a
 *   count of same-customer/vehicle repeats that were excluded from queueing
 */
function buildEpisodes(eligible, thresholdMinutes) {
    const groups = new Map();
    eligible.forEach(txn => {
        const key = connectorKey(txn);
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(txn);
    });

    const episodes = [];
    let sameCustomerExclusions = 0;

    groups.forEach(txns => {
        const sorted = [...txns].sort((a, b) => a.startDate - b.startDate);

        let chain = [sorted[0]];
        let waits = [];

        // Tracks the connector's last known occupant for gap comparisons. This
        // rolls forward through same-customer repeats without extending the
        // queue chain, so a returning customer doesn't reset who's "in front".
        let effectiveEnd = sorted[0].endDate;
        let effectiveOccupant = sorted[0];

        const flush = () => {
            if (chain.length >= 2) {
                episodes.push(buildEpisode(chain, waits));
            }
        };

        for (let i = 1; i < sorted.length; i++) {
            const curr = sorted[i];
            const gapMinutes = (curr.startDate - effectiveEnd) / 60000;

            if (gapMinutes >= 0 && gapMinutes <= thresholdMinutes) {
                if (isSameCustomer(effectiveOccupant, curr)) {
                    // Same customer/vehicle immediately reconnecting - not a queue.
                    // Extend the occupancy without touching the chain.
                    sameCustomerExclusions++;
                    if (curr.endDate > effectiveEnd) {
                        effectiveEnd = curr.endDate;
                        effectiveOccupant = curr;
                    }
                } else {
                    chain.push(curr);
                    waits.push({ gapMinutes });
                    effectiveEnd = curr.endDate;
                    effectiveOccupant = curr;
                }
            } else {
                flush();
                chain = [curr];
                waits = [];
                effectiveEnd = curr.endDate;
                effectiveOccupant = curr;
            }
        }
        flush();
    });

    return { episodes, sameCustomerExclusions };
}

/**
 * Build a single episode summary from a chain of transactions.
 * @param {Array} chain - Ordered transactions in the episode
 * @param {Array} waits - Gap details for each transition (length = chain.length - 1)
 * @returns {Object} Episode summary
 */
function buildEpisode(chain, waits) {
    const first = chain[0];
    const last = chain[chain.length - 1];
    const totalWaitMinutes = waits.reduce((sum, w) => sum + w.gapMinutes, 0);
    const maxGapMinutes = Math.max(...waits.map(w => w.gapMinutes));

    return {
        station: first.station,
        charger: first.charger,
        connector: first.connector,
        depth: chain.length,
        queuedCount: chain.length - 1,
        episodeStart: first.startDate,
        episodeEnd: last.endDate,
        spanMinutes: (last.endDate - first.startDate) / 60000,
        avgWaitMinutes: totalWaitMinutes / waits.length,
        maxGapMinutes,
        transactionIds: chain.map(t => t.id),
        chain,
        waits,
    };
}

/**
 * Flatten episodes into individual "queued session" records - one per
 * vehicle that had to wait, with the gap it experienced.
 * @param {Array} episodes - Episodes from buildEpisodes()
 * @returns {Array} Queued session records
 */
function extractQueuedSessions(episodes) {
    const sessions = [];
    episodes.forEach(ep => {
        for (let i = 1; i < ep.chain.length; i++) {
            sessions.push({
                txn: ep.chain[i],
                prevTxn: ep.chain[i - 1],
                gapMinutes: ep.waits[i - 1].gapMinutes,
                station: ep.station,
                charger: ep.charger,
                connector: ep.connector,
            });
        }
    });
    return sessions;
}

/**
 * Run the full congestion analysis over a set of transactions.
 * @param {Array} transactions - All transactions (with startDate/endDate)
 * @param {number} [thresholdMinutes] - Max gap counted as queueing
 * @returns {Object} Analysis result
 */
export function analyzeCongestion(transactions, thresholdMinutes = DEFAULT_THRESHOLD_MINUTES) {
    const eligible = transactions.filter(isEligible);
    const { episodes: unsortedEpisodes, sameCustomerExclusions } = buildEpisodes(eligible, thresholdMinutes);
    const episodes = unsortedEpisodes.sort((a, b) => b.episodeStart - a.episodeStart);
    const queuedSessions = extractQueuedSessions(episodes);

    const longestEpisode = episodes.reduce(
        (longest, ep) => (!longest || ep.depth > longest.depth ? ep : longest),
        null
    );

    return {
        thresholdMinutes,
        totalTransactions: transactions.length,
        eligibleTransactions: eligible,
        eligibleCount: eligible.length,
        excludedCount: transactions.length - eligible.length,
        sameCustomerExclusions,
        episodes,
        queuedSessions,
        queuedCount: queuedSessions.length,
        queueRate: eligible.length > 0 ? queuedSessions.length / eligible.length : 0,
        longestEpisode,
    };
}

/**
 * Aggregate queued sessions and eligible totals by station.
 * @param {Object} analysis - Result of analyzeCongestion()
 * @returns {Array} Rows sorted by queued session count (descending)
 */
export function aggregateByStation(analysis) {
    const totals = countByKey(analysis.eligibleTransactions, t => t.station);
    const queued = countByKey(analysis.queuedSessions, s => s.station);

    const rows = [];
    totals.forEach((total, station) => {
        const queuedCount = queued.get(station) || 0;
        rows.push({
            station,
            totalSessions: total,
            queuedSessions: queuedCount,
            queueRate: total > 0 ? queuedCount / total : 0,
        });
    });

    return rows.sort((a, b) => b.queuedSessions - a.queuedSessions);
}

/**
 * Aggregate queued sessions and eligible totals per physical connector
 * (station + charger + connector).
 * @param {Object} analysis - Result of analyzeCongestion()
 * @returns {Array} Rows sorted by queued session count (descending)
 */
export function aggregateByConnector(analysis) {
    const totals = countByKey(analysis.eligibleTransactions, connectorKey);
    const queued = countByKey(analysis.queuedSessions, s =>
        connectorKey({ station: s.station, charger: s.charger, connector: s.connector })
    );

    const maxDepth = new Map();
    const longestSpan = new Map();
    analysis.episodes.forEach(ep => {
        const key = connectorKey(ep);
        maxDepth.set(key, Math.max(maxDepth.get(key) || 0, ep.depth));
        longestSpan.set(key, Math.max(longestSpan.get(key) || 0, ep.spanMinutes));
    });

    const rows = [];
    totals.forEach((total, key) => {
        const { station, charger, connector } = splitConnectorKey(key);
        const queuedCount = queued.get(key) || 0;
        rows.push({
            station,
            charger,
            connector,
            totalSessions: total,
            queuedSessions: queuedCount,
            queueRate: total > 0 ? queuedCount / total : 0,
            maxDepth: maxDepth.get(key) || 0,
            longestSpanMinutes: longestSpan.get(key) || 0,
        });
    });

    return rows.sort((a, b) => b.queuedSessions - a.queuedSessions);
}

/**
 * Aggregate queued sessions by hour of day (0-23), based on the queued
 * session's own start time.
 * @param {Object} analysis - Result of analyzeCongestion()
 * @returns {Array<number>} Array of 24 counts, index = hour
 */
export function aggregateByHour(analysis) {
    const counts = new Array(24).fill(0);
    analysis.queuedSessions.forEach(s => {
        counts[s.txn.startDate.getHours()] += 1;
    });
    return counts;
}

/**
 * Get the local-time Monday 00:00:00 for the week containing the given date.
 * @param {Date} date - Reference date
 * @returns {Date} Date object for that week's Monday, local midnight
 */
function getWeekStart(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayOfWeek = d.getDay(); // 0 = Sunday
    const diffToMonday = (dayOfWeek + 6) % 7;
    d.setDate(d.getDate() - diffToMonday);
    return d;
}

/**
 * Format a date as YYYY-MM-DD (local time).
 * @param {Date} date - Date to format
 * @returns {string} Formatted date
 */
function formatDateShort(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Aggregate queued sessions per week, broken down by station, so a trend
 * over time can be plotted as a stacked chart.
 * @param {Object} analysis - Result of analyzeCongestion()
 * @returns {{weeks: Array<string>, stations: Array<string>, dataByStation: Object}}
 */
export function aggregateWeeklyTrend(analysis) {
    const byWeekStation = new Map(); // weekLabel -> { station -> count }
    const stations = new Set();

    analysis.queuedSessions.forEach(s => {
        const weekLabel = formatDateShort(getWeekStart(s.txn.startDate));
        if (!byWeekStation.has(weekLabel)) {
            byWeekStation.set(weekLabel, {});
        }
        const bucket = byWeekStation.get(weekLabel);
        bucket[s.station] = (bucket[s.station] || 0) + 1;
        stations.add(s.station);
    });

    const weeks = [...byWeekStation.keys()].sort();
    const stationList = [...stations].sort();

    const dataByStation = {};
    stationList.forEach(station => {
        dataByStation[station] = weeks.map(week => byWeekStation.get(week)[station] || 0);
    });

    return { weeks, stations: stationList, dataByStation };
}

/**
 * Aggregate queue episodes by depth (number of vehicles involved).
 * Depths of 6 or more are grouped into a single "6+" bucket to keep the
 * chart readable, since very deep queues are rare.
 * @param {Object} analysis - Result of analyzeCongestion()
 * @returns {{labels: Array<string>, counts: Array<number>}}
 */
export function aggregateDepthDistribution(analysis) {
    const counts = new Map();
    analysis.episodes.forEach(ep => {
        const label = ep.depth >= 6 ? '6+' : String(ep.depth);
        counts.set(label, (counts.get(label) || 0) + 1);
    });

    const labels = ['2', '3', '4', '5', '6+'].filter(label => counts.has(label));
    return { labels, counts: labels.map(label => counts.get(label)) };
}

/* ==========================================================================
 * Rendering - KPI cards, charts and tables for the Congestion & Queueing
 * section of the analytics page.
 * ========================================================================== */

const congestionChartInstances = {
    byStation: null,
    byHour: null,
    trend: null,
    depth: null,
};

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
 * Format date to YYYY-MM-DD HH:MM:SS (local time)
 * @param {Date} date - Date to format
 * @returns {string} Formatted date-time string
 */
function formatDateTime(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Format a duration given in minutes as M:SS or H:MM:SS.
 * @param {number} minutes - Duration in minutes
 * @returns {string} Formatted duration
 */
function formatMinutesDuration(minutes) {
    const totalSeconds = Math.round(minutes * 60);
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Format a fraction (0-1) as a percentage string with 1 decimal.
 * @param {number} fraction - Value between 0 and 1
 * @returns {string} Formatted percentage
 */
function formatPercent(fraction) {
    return `${(fraction * 100).toFixed(1)}%`;
}

/**
 * Format a charger + connector pair using the project's combined convention
 * (e.g. "1262-1"), matching the main dashboard table.
 * @param {{charger: string, connector: string}} row - Object with charger/connector
 * @returns {string} Combined charger-connector label
 */
function formatConnector(row) {
    return `${row.charger}-${row.connector}`;
}

/**
 * Render the methodology / transparency note above the KPI cards.
 * @param {Object} analysis - Result of analyzeCongestion()
 */
function renderMethodologyNote(analysis) {
    const el = document.getElementById('congestion-methodology');
    if (!el) {
        return;
    }

    const windowLabel = `${analysis.thresholdMinutes} minute${analysis.thresholdMinutes === 1 ? '' : 's'}`;
    const sameCustomerNote =
        analysis.sameCustomerExclusions > 0
            ? ` A further ${analysis.sameCustomerExclusions.toLocaleString('en-IN')} apparent back-to-back ` +
              'session(s) were identified as the same customer/vehicle reconnecting (e.g. a short session ' +
              'followed by an immediate restart) and were not counted as queueing.'
            : '';

    el.innerHTML =
        'Detected when the same connector (charger + connector ID) at the same location starts a new ' +
        `session within <strong>${windowLabel}</strong> of the previous session on that connector ending - a ` +
        'strong signal that a driver was waiting for it to free up. Two connectors on the same charger are ' +
        'tracked independently since they can serve different vehicles at once. Based on ' +
        `${analysis.eligibleCount.toLocaleString('en-IN')} of ${analysis.totalTransactions.toLocaleString('en-IN')} ` +
        `total sessions; ${analysis.excludedCount.toLocaleString('en-IN')} session(s) with no energy delivered ` +
        `(failed connections, test taps) were excluded as they do not reflect genuine demand.${sameCustomerNote}`;
}

/**
 * Render the KPI summary cards.
 * @param {Object} analysis - Result of analyzeCongestion()
 * @param {Array} connectorRanking - Result of aggregateByConnector()
 */
function renderKPIs(analysis, connectorRanking) {
    setText('kpi-queued-sessions', analysis.queuedCount.toLocaleString('en-IN'));
    setText(
        'kpi-queued-rate',
        `${formatPercent(analysis.queueRate)} of ${analysis.eligibleCount.toLocaleString('en-IN')} valid sessions`
    );

    setText('kpi-episode-count', analysis.episodes.length.toLocaleString('en-IN'));

    const busiest = connectorRanking.find(row => row.queuedSessions > 0);
    if (busiest) {
        setText('kpi-busiest-charger', formatConnector(busiest));
        setText('kpi-busiest-charger-sub', `${busiest.station} — ${busiest.queuedSessions} queued sessions`);
    } else {
        setText('kpi-busiest-charger', '—');
        setText('kpi-busiest-charger-sub', 'No queueing detected');
    }

    const longest = analysis.longestEpisode;
    if (longest) {
        setText('kpi-longest-queue', `${longest.depth} vehicles`);
        setText(
            'kpi-longest-queue-sub',
            `${formatConnector(longest)} at ${longest.station} on ${formatDateTime(longest.episodeStart)}`
        );
    } else {
        setText('kpi-longest-queue', '—');
        setText('kpi-longest-queue-sub', 'No queueing detected');
    }
}

/**
 * Render the "Queued Sessions by Station" combo chart (bar + queue rate line).
 * @param {Object} analysis - Result of analyzeCongestion()
 */
function renderCongestionByStationChart(analysis) {
    const canvas = document.getElementById('congestion-station-chart');
    if (!canvas) {
        return;
    }
    const ctx = canvas.getContext('2d');
    if (congestionChartInstances.byStation) {
        congestionChartInstances.byStation.destroy();
    }

    const rows = aggregateByStation(analysis);
    const labels = rows.map(r => r.station);
    const queuedData = rows.map(r => r.queuedSessions);
    const rateData = rows.map(r => r.queueRate * 100);
    const colors = rows.map((r, i) => getStationColor(r.station, i));

    congestionChartInstances.byStation = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    type: 'bar',
                    label: 'Queued Sessions',
                    data: queuedData,
                    backgroundColor: colors,
                    borderColor: colors,
                    borderWidth: 1,
                    yAxisID: 'y',
                },
                {
                    type: 'line',
                    label: 'Queue Rate (%)',
                    data: rateData,
                    borderColor: '#dc2626',
                    backgroundColor: '#dc2626',
                    borderWidth: 2,
                    pointRadius: 4,
                    fill: false,
                    yAxisID: 'y1',
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true, position: 'top' },
                tooltip: {
                    callbacks: {
                        label(context) {
                            if (context.dataset.label === 'Queue Rate (%)') {
                                return `Queue Rate: ${context.parsed.y.toFixed(1)}%`;
                            }
                            return `Queued Sessions: ${context.parsed.y}`;
                        },
                    },
                },
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Queued Sessions' },
                    ticks: { precision: 0 },
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    beginAtZero: true,
                    title: { display: true, text: 'Queue Rate (%)' },
                    grid: { drawOnChartArea: false },
                    ticks: {
                        callback(value) {
                            return `${value}%`;
                        },
                    },
                },
            },
        },
    });
}

/**
 * Render the "Queueing by Hour of Day" chart.
 * @param {Object} analysis - Result of analyzeCongestion()
 */
function renderCongestionByHourChart(analysis) {
    const canvas = document.getElementById('congestion-hour-chart');
    if (!canvas) {
        return;
    }
    const ctx = canvas.getContext('2d');
    if (congestionChartInstances.byHour) {
        congestionChartInstances.byHour.destroy();
    }

    const counts = aggregateByHour(analysis);
    const labels = Array.from({ length: 24 }, (_, h) => `${h}:00`);

    congestionChartInstances.byHour = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Queued Sessions',
                    data: counts,
                    backgroundColor: '#f59e0b',
                    borderColor: '#d97706',
                    borderWidth: 1,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label(context) {
                            const hour = context.dataIndex;
                            const nextHour = (hour + 1) % 24;
                            return `${hour}:00-${nextHour}:00: ${context.parsed.y} queued session(s)`;
                        },
                    },
                },
            },
            scales: {
                x: { title: { display: true, text: 'Hour of Day' } },
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Queued Sessions' },
                    ticks: { precision: 0 },
                },
            },
        },
    });
}

/**
 * Render the weekly congestion trend chart, stacked by station.
 * @param {Object} analysis - Result of analyzeCongestion()
 */
function renderCongestionTrendChart(analysis) {
    const canvas = document.getElementById('congestion-trend-chart');
    if (!canvas) {
        return;
    }
    const ctx = canvas.getContext('2d');
    if (congestionChartInstances.trend) {
        congestionChartInstances.trend.destroy();
    }

    const { weeks, stations, dataByStation } = aggregateWeeklyTrend(analysis);

    const datasets = stations.map((station, index) => ({
        label: station,
        data: dataByStation[station],
        backgroundColor: getStationColor(station, index),
        borderColor: getStationColor(station, index),
        borderWidth: 1,
    }));

    congestionChartInstances.trend = new Chart(ctx, {
        type: 'bar',
        data: { labels: weeks, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true, position: 'top' },
                tooltip: { mode: 'index', intersect: false },
            },
            scales: {
                x: { stacked: true, title: { display: true, text: 'Week Starting' } },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    title: { display: true, text: 'Queued Sessions' },
                    ticks: { precision: 0 },
                },
            },
        },
    });
}

/**
 * Render the queue depth distribution chart.
 * @param {Object} analysis - Result of analyzeCongestion()
 */
function renderQueueDepthChart(analysis) {
    const canvas = document.getElementById('congestion-depth-chart');
    if (!canvas) {
        return;
    }
    const ctx = canvas.getContext('2d');
    if (congestionChartInstances.depth) {
        congestionChartInstances.depth.destroy();
    }

    const { labels, counts } = aggregateDepthDistribution(analysis);

    congestionChartInstances.depth = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels.map(label => `${label} vehicles`),
            datasets: [
                {
                    label: 'Episodes',
                    data: counts,
                    backgroundColor: '#8b5cf6',
                    borderColor: '#7c3aed',
                    borderWidth: 1,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label(context) {
                            return `${context.parsed.y} episode(s)`;
                        },
                    },
                },
            },
            scales: {
                x: { title: { display: true, text: 'Vehicles Queued Back-to-Back' } },
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Number of Episodes' },
                    ticks: { precision: 0 },
                },
            },
        },
    });
}

/**
 * Render the connector congestion ranking table (sorted by queued sessions).
 * @param {Array} rows - Result of aggregateByConnector()
 */
function renderChargerRankingTable(rows) {
    const tbody = document.getElementById('charger-ranking-body');
    if (!tbody) {
        return;
    }
    tbody.innerHTML = '';

    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7">No connectors with valid sessions in this dataset.</td></tr>';
        return;
    }

    rows.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.station}</td>
            <td>${formatConnector(row)}</td>
            <td>${row.totalSessions}</td>
            <td>${row.queuedSessions}</td>
            <td>${formatPercent(row.queueRate)}</td>
            <td>${row.maxDepth || '—'}</td>
            <td>${row.longestSpanMinutes ? formatMinutesDuration(row.longestSpanMinutes) : '—'}</td>
        `;
        tbody.appendChild(tr);
    });
}

/* Queue episodes table state (sortable + paginated, mirrors table.js patterns) */
let currentEpisodes = [];
const episodeSort = { column: 'episodeStart', direction: 'desc' };
let episodePage = 1;
const EPISODE_PAGE_SIZE = 25;

/**
 * Sort episodes by a given column.
 * @param {Array} episodes - Episodes to sort
 * @param {string} column - Column/property name
 * @param {string} direction - 'asc' or 'desc'
 * @returns {Array} New sorted array
 */
function sortEpisodes(episodes, column, direction) {
    const sorted = [...episodes];
    sorted.sort((a, b) => {
        const aVal = a[column];
        const bVal = b[column];
        let comparison = 0;
        if (aVal < bVal) {
            comparison = -1;
        }
        if (aVal > bVal) {
            comparison = 1;
        }
        return direction === 'asc' ? comparison : -comparison;
    });
    return sorted;
}

/**
 * Render one page of episode rows.
 * @param {Array} episodes - Sorted episodes
 * @param {number} page - Current page (1-indexed)
 */
function renderEpisodesTableRows(episodes, page) {
    const tbody = document.getElementById('episodes-body');
    if (!tbody) {
        return;
    }
    tbody.innerHTML = '';

    const start = (page - 1) * EPISODE_PAGE_SIZE;
    const end = Math.min(start + EPISODE_PAGE_SIZE, episodes.length);
    const pageEpisodes = episodes.slice(start, end);

    if (pageEpisodes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7">No queueing episodes detected at this threshold.</td></tr>';
        return;
    }

    pageEpisodes.forEach(ep => {
        const tr = document.createElement('tr');
        const idsLabel =
            ep.transactionIds.length > 4
                ? `${ep.transactionIds.slice(0, 3).join(', ')}, +${ep.transactionIds.length - 3} more`
                : ep.transactionIds.join(', ');

        tr.innerHTML = `
            <td>${formatDateTime(ep.episodeStart)}</td>
            <td>${ep.station}</td>
            <td>${formatConnector(ep)}</td>
            <td>${ep.depth}</td>
            <td>${formatMinutesDuration(ep.spanMinutes)}</td>
            <td>${formatMinutesDuration(ep.avgWaitMinutes)}</td>
            <td class="transaction-id" title="${ep.transactionIds.join(', ')}">${idsLabel}</td>
        `;
        tbody.appendChild(tr);
    });
}

/**
 * Update the episodes table pagination controls.
 * @param {number} total - Total number of episodes (all pages)
 */
function updateEpisodesPagination(total) {
    const totalPages = Math.max(1, Math.ceil(total / EPISODE_PAGE_SIZE));
    episodePage = Math.min(episodePage, totalPages);

    const prevBtn = document.getElementById('episodes-prev-page');
    const nextBtn = document.getElementById('episodes-next-page');
    const pageInfo = document.getElementById('episodes-page-info');
    if (!prevBtn || !nextBtn || !pageInfo) {
        return;
    }

    prevBtn.disabled = episodePage === 1;
    nextBtn.disabled = episodePage >= totalPages || total === 0;
    pageInfo.textContent = total === 0 ? 'Page 0 of 0' : `Page ${episodePage} of ${totalPages}`;
}

/**
 * Update sort indicator arrows in the episodes table header.
 */
function updateEpisodesSortIndicators() {
    document.querySelectorAll('#episodes-table th.sortable').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
    });
    const th = document.querySelector(`#episodes-table th[data-sort="${episodeSort.column}"]`);
    if (th) {
        th.classList.add(episodeSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
    }
}

/**
 * Re-render the episodes table using current sort/page state.
 */
function renderEpisodesTable() {
    const sorted = sortEpisodes(currentEpisodes, episodeSort.column, episodeSort.direction);
    renderEpisodesTableRows(sorted, episodePage);
    updateEpisodesPagination(currentEpisodes.length);
    updateEpisodesSortIndicators();
    setText('episodes-heading', `Queueing Incidents (${currentEpisodes.length})`);
}

/**
 * Load a new set of episodes into the table (resets to page 1).
 * @param {Array} episodes - Episodes from analyzeCongestion()
 */
function renderQueueEpisodesTable(episodes) {
    currentEpisodes = episodes;
    episodePage = 1;
    renderEpisodesTable();
}

/**
 * Attach click handlers for the episodes table's sortable headers and
 * pagination buttons. Safe to call once at page load.
 */
export function attachEpisodeTableHandlers() {
    document.querySelectorAll('#episodes-table th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const column = th.dataset.sort;
            if (episodeSort.column === column) {
                episodeSort.direction = episodeSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                episodeSort.column = column;
                episodeSort.direction = 'desc';
            }
            renderEpisodesTable();
        });
    });

    const prevBtn = document.getElementById('episodes-prev-page');
    const nextBtn = document.getElementById('episodes-next-page');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (episodePage > 1) {
                episodePage--;
                renderEpisodesTable();
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const totalPages = Math.max(1, Math.ceil(currentEpisodes.length / EPISODE_PAGE_SIZE));
            if (episodePage < totalPages) {
                episodePage++;
                renderEpisodesTable();
            }
        });
    }
}

/**
 * Run the congestion analysis and render every part of the section: the
 * methodology note, KPI cards, four charts, and both tables.
 * @param {Array} transactions - All transactions (with startDate/endDate)
 * @param {number} thresholdMinutes - Max gap (minutes) counted as queueing
 * @returns {Object} The analysis result, in case the caller needs it
 */
export function renderCongestionAnalysis(transactions, thresholdMinutes) {
    const analysis = analyzeCongestion(transactions, thresholdMinutes);
    const connectorRanking = aggregateByConnector(analysis);

    renderMethodologyNote(analysis);
    renderKPIs(analysis, connectorRanking);
    renderCongestionByStationChart(analysis);
    renderCongestionByHourChart(analysis);
    renderCongestionTrendChart(analysis);
    renderQueueDepthChart(analysis);
    renderChargerRankingTable(connectorRanking);
    renderQueueEpisodesTable(analysis.episodes);

    return analysis;
}
