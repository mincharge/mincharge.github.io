import { initializeData } from './data-loader.js';
import { renderCongestionAnalysis, attachEpisodeTableHandlers } from './congestion.js';
import { initMonthRangeFilter, filterTransactionsByMonthRange } from './month-range.js';

/**
 * Analytics Module
 *
 * Renders a mixed bar/line chart showing cumulative energy (kWh) and revenue (₹)
 * across days of the month, with each month plotted as a separate line (revenue)
 * and separate bar (energy).
 */

const MONTH_COLORS = {};
const BASE_HUE = 210;
const HUE_STEP = 30;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

for (let i = 0; i < 12; i++) {
    const hue = (BASE_HUE + i * HUE_STEP) % 360;
    MONTH_COLORS[i] = {
        bar: `hsla(${hue}, 70%, 50%, 0.7)`,
        line: `hsl(${hue}, 70%, 50%)`,
        borderColor: `hsl(${hue}, 70%, 40%)`,
    };
}

/**
 * Aggregate transactions by month and day-of-month
 * Returns cumulative (running sum) per day for each month
 */
function aggregateCumulativeData(transactions) {
    // Step 1: Bucket transactions by (year-month, day-of-month)
    // A transaction belongs to date D if endDate >= D 00:00:00 AND endDate < D+1 00:00:00
    const monthlyDaily = {}; // { "YYYY-MM": { day: { revenue, kWh } } }

    transactions.forEach(txn => {
        const endDate = txn.endDate;
        const year = endDate.getFullYear();
        const month = endDate.getMonth(); // 0-indexed
        const day = endDate.getDate(); // 1-31
        const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;

        if (!monthlyDaily[monthKey]) {
            monthlyDaily[monthKey] = {};
        }

        if (!monthlyDaily[monthKey][day]) {
            monthlyDaily[monthKey][day] = { revenue: 0, kWh: 0 };
        }

        monthlyDaily[monthKey][day].revenue += txn.net_revenue;
        monthlyDaily[monthKey][day].kWh += txn.units_kwh;
    });

    // Step 2: Convert to cumulative (running sum) per month
    const result = {}; // { "YYYY-MM": { days: [1..31], cumulativeRevenue: [], cumulativeKWh: [] } }

    const sortedMonths = Object.keys(monthlyDaily).sort();

    sortedMonths.forEach(monthKey => {
        const dailyData = monthlyDaily[monthKey];
        const days = Object.keys(dailyData)
            .map(Number)
            .sort((a, b) => a - b);
        const maxDay = Math.max(...days);

        // Build cumulative arrays for days 1 to maxDay (or 31)
        const endDay = Math.max(maxDay, 28); // At least show through day 28
        const cumulativeRevenue = new Array(endDay).fill(0);
        const cumulativeKWh = new Array(endDay).fill(0);

        let revSum = 0;
        let kWhSum = 0;

        for (let d = 1; d <= endDay; d++) {
            if (dailyData[d]) {
                revSum += dailyData[d].revenue;
                kWhSum += dailyData[d].kWh;
            }
            cumulativeRevenue[d - 1] = revSum;
            cumulativeKWh[d - 1] = kWhSum;
        }

        // Trim trailing zeros if the month doesn't have data that far
        // Find the last day with actual data
        let lastDataDay = 0;
        for (let d = endDay; d >= 1; d--) {
            if (dailyData[d]) {
                lastDataDay = d;
                break;
            }
        }

        const sliceEnd = Math.max(lastDataDay, 1);

        result[monthKey] = {
            days: Array.from({ length: sliceEnd }, (_, i) => i + 1),
            cumulativeRevenue: cumulativeRevenue.slice(0, sliceEnd),
            cumulativeKWh: cumulativeKWh.slice(0, sliceEnd),
        };
    });

    return result;
}

/**
 * Render the monthly trends chart
 */
export function renderMonthlyTrendsChart(transactions) {
    const canvas = document.getElementById('monthly-trends-chart');
    if (!canvas) {
        console.error('Canvas element #monthly-trends-chart not found');
        return;
    }

    const ctx = canvas.getContext('2d');

    // Destroy existing chart if any
    const existingChart = Chart.getChart(canvas);
    if (existingChart) {
        existingChart.destroy();
    }

    if (transactions.length === 0) {
        console.warn('No transactions to display');
        return;
    }

    // Aggregate data
    const data = aggregateCumulativeData(transactions);
    const months = Object.keys(data).sort();

    if (months.length === 0) {
        console.warn('No monthly data to display');
        return;
    }

    // Build datasets
    const datasets = [];

    months.forEach((monthKey, index) => {
        const monthData = data[monthKey];
        const color = MONTH_COLORS[index % 12];
        const [year, monthNum] = monthKey.split('-').map(Number);
        const monthLabel = `${MONTH_NAMES[monthNum - 1]} ${year}`;

        // Bar dataset (energy - left y-axis)
        datasets.push({
            type: 'bar',
            label: `${monthLabel} (kWh)`,
            data: monthData.cumulativeKWh,
            backgroundColor: color.bar,
            borderColor: color.borderColor,
            borderWidth: 1,
            yAxisID: 'y',
            order: 2,
        });

        // Line dataset (revenue - right y-axis)
        datasets.push({
            type: 'line',
            label: `${monthLabel} (₹)`,
            data: monthData.cumulativeRevenue,
            borderColor: color.line,
            backgroundColor: color.line,
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 5,
            fill: false,
            tension: 0.1,
            yAxisID: 'y1',
            order: 1,
        });
    });

    // Determine max day across all months for x-axis labels
    const maxDay = Math.max(...months.map(m => data[m].days.length));
    const xLabels = Array.from({ length: maxDay }, (_, i) => String(i + 1));

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: xLabels,
            datasets,
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        padding: 15,
                    },
                },
                tooltip: {
                    callbacks: {
                        label(context) {
                            const value = context.parsed.y;
                            if (context.dataset.type === 'bar' || context.dataset.label.includes('kWh')) {
                                return `${context.dataset.label}: ${value.toFixed(2)} kWh (cumulative)`;
                            } else {
                                return `${context.dataset.label}: ₹${value.toFixed(2)} (cumulative)`;
                            }
                        },
                    },
                },
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Day of Month',
                    },
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Energy (kWh)',
                    },
                    ticks: {
                        callback(value) {
                            return `${value.toFixed(0)} kWh`;
                        },
                    },
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Revenue (₹)',
                    },
                    ticks: {
                        callback(value) {
                            return `₹${value.toLocaleString()}`;
                        },
                    },
                    grid: {
                        drawOnChartArea: false,
                    },
                },
            },
        },
    });
}

/**
 * Initialize the analytics page
 */
async function initializeAnalytics() {
    const loadingEl = document.getElementById('loading');
    const errorEl = document.getElementById('error');
    const contentEl = document.getElementById('analytics-content');

    loadingEl.hidden = false;
    errorEl.hidden = true;
    contentEl.hidden = true;

    try {
        // Load all data - the month range filter below narrows what's displayed
        const { transactions, metadata } = await initializeData();

        console.log(`Loaded ${transactions.length} transactions for analytics`);

        // Display last update timestamp
        if (metadata.latest_end_time) {
            const isoString = metadata.latest_end_time;
            const [datePart, timePart] = isoString.split('T');
            const [year, month, day] = datePart.split('-').map(Number);
            const [hours, minutes, seconds] = timePart.split(':').map(Number);

            const formatted = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            document.getElementById('last-update-time').textContent = formatted;
        }

        const thresholdSelect = document.getElementById('congestion-threshold');
        let currentRange = { start: null, end: null };

        // Re-render everything using the current month range + queue threshold
        function renderAll() {
            const filtered = filterTransactionsByMonthRange(transactions, currentRange);
            renderMonthlyTrendsChart(filtered);
            renderCongestionAnalysis(filtered, Number(thresholdSelect.value));
        }

        // Set up the month range filter (defaults to the full available range)
        currentRange = initMonthRangeFilter(transactions, range => {
            currentRange = range;
            renderAll();
        });

        // Recompute congestion analysis whenever the queue detection window changes
        thresholdSelect.addEventListener('change', renderAll);

        // Wire up the queueing incidents table's sort/pagination controls (once)
        attachEpisodeTableHandlers();

        // Initial render
        renderAll();

        // Show content
        loadingEl.hidden = true;
        contentEl.hidden = false;

        console.log('Analytics page rendered successfully');
    } catch (error) {
        console.error('Failed to initialize analytics:', error);
        loadingEl.hidden = true;
        errorEl.hidden = false;
        const errorMessageEl = errorEl.querySelector('.error-message');
        errorMessageEl.textContent = `Failed to load analytics data: ${error.message}`;
    }
}

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initializeAnalytics);
