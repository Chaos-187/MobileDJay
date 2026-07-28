/**
 * Customer payment rules: deposit first; full balance due by N days before event (pay anytime after deposit).
 */

const DEFAULT_BALANCE_DUE_DAYS = 7;

function balanceDueDaysBeforeEvent() {
    const n = Number(process.env.PORTAL_BALANCE_DUE_DAYS_BEFORE_EVENT);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_BALANCE_DUE_DAYS;
}

function parseInstant(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Balance due date: explicit booking.balance_due_at, else event start minus configured days.
 * @param {object} booking
 * @returns {string|null} ISO timestamp
 */
function computeBalanceDueAt(booking) {
    if (!booking) return null;
    if (booking.balance_due_at) {
        const explicit = parseInstant(booking.balance_due_at);
        return explicit ? explicit.toISOString() : null;
    }
    const start = parseInstant(booking.start_datetime);
    if (!start) return null;
    const due = new Date(start.getTime());
    due.setUTCDate(due.getUTCDate() - balanceDueDaysBeforeEvent());
    return due.toISOString();
}

function isBookingOpenForPayments(booking) {
    if (!booking) return false;
    if (booking.status === 'cancelled') return false;
    return true;
}

/**
 * Fields for admin calendar balance-due tiles.
 * @param {object} booking
 * @param {{ quote_total: number, balance_remaining: number }} settlement
 */
function balanceDueCalendarFields(booking, settlement) {
    const balanceDueAt = computeBalanceDueAt(booking);
    const quoteTotal = Math.round((Number(settlement && settlement.quote_total) || 0) * 100) / 100;
    const balanceRemaining =
        Math.round((Number(settlement && settlement.balance_remaining) || 0) * 100) / 100;
    const depositPaid = booking.deposit_paid === 1 || booking.deposit_paid === true;
    const depositAmount =
        booking.deposit_amount != null && Number.isFinite(Number(booking.deposit_amount))
            ? Number(booking.deposit_amount)
            : 0;

    let show_balance_due_on_calendar = false;
    if (
        isBookingOpenForPayments(booking) &&
        quoteTotal > 0.005 &&
        balanceRemaining > 0.005 &&
        balanceDueAt &&
        (depositPaid || depositAmount <= 0)
    ) {
        show_balance_due_on_calendar = true;
    }

    return {
        balance_due_at: balanceDueAt,
        balance_due_days_before_event: balanceDueDaysBeforeEvent(),
        show_balance_due_on_calendar
    };
}

/**
 * @param {object} params
 * @param {object} params.booking
 * @param {{ quote_total: number, amount_paid: number, balance_remaining: number }} params.settlement
 * @param {boolean} params.stripeConfigured
 * @param {Date} [params.now]
 */
function customerPaymentOptions(params) {
    const { booking, settlement, stripeConfigured } = params;
    const now = params.now instanceof Date ? params.now : new Date();

    const depositPaid = booking.deposit_paid === 1 || booking.deposit_paid === true;
    const depositAmount =
        booking.deposit_amount != null && Number.isFinite(Number(booking.deposit_amount))
            ? Number(booking.deposit_amount)
            : 0;
    const quoteTotal = Math.round((Number(settlement && settlement.quote_total) || 0) * 100) / 100;
    const balanceRemaining =
        Math.round((Number(settlement && settlement.balance_remaining) || 0) * 100) / 100;
    const amountPaid = Math.round((Number(settlement && settlement.amount_paid) || 0) * 100) / 100;

    const balanceDueAt = computeBalanceDueAt(booking);
    const dueDate = parseInstant(balanceDueAt);
    const balancePastDue = dueDate ? now.getTime() > dueDate.getTime() : false;

    const open = isBookingOpenForPayments(booking) && stripeConfigured;

    let can_pay_deposit = open && !depositPaid && depositAmount > 0;
    let can_pay_balance = false;
    let balance_block_reason = null;

    if (open && quoteTotal > 0 && balanceRemaining > 0.005) {
        if (!depositPaid && depositAmount > 0) {
            balance_block_reason = 'deposit_first';
        } else {
            can_pay_balance = true;
            if (!balanceDueAt) {
                balance_block_reason = 'no_event_date';
            } else if (balancePastDue) {
                balance_block_reason = 'past_due';
            } else {
                balance_block_reason = 'due_by';
            }
        }
    } else if (balanceRemaining <= 0.005 && quoteTotal > 0) {
        balance_block_reason = 'settled';
    }

    let deposit_outstanding = 0;
    if (!depositPaid && depositAmount > 0) {
        deposit_outstanding = depositAmount;
    } else if (!depositPaid && quoteTotal > 0 && depositAmount <= 0) {
        deposit_outstanding = 0;
    }

    return {
        balance_due_at: balanceDueAt,
        balance_due_days_before_event: balanceDueDaysBeforeEvent(),
        balance_past_due: balancePastDue,
        can_pay_deposit,
        can_pay_balance,
        balance_block_reason,
        deposit_outstanding,
        quote_total: quoteTotal,
        amount_paid: amountPaid,
        balance_remaining: balanceRemaining
    };
}

function customerBalanceBlockedMessage(options) {
    if (!options) return 'Balance payment is not available.';
    const dueLabel =
        options.balance_due_at && parseInstant(options.balance_due_at)
            ? parseInstant(options.balance_due_at).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric'
              })
            : null;
    if (options.balance_block_reason === 'deposit_first') {
        return 'Pay your deposit first. The remaining balance must be paid in full before your event date.';
    }
    if (options.balance_block_reason === 'no_event_date') {
        return 'Balance payment will be available once your event date is confirmed.';
    }
    if (options.balance_block_reason === 'settled') {
        return 'This booking is fully paid.';
    }
    return 'Balance payment is not available yet.';
}

module.exports = {
    balanceDueDaysBeforeEvent,
    computeBalanceDueAt,
    balanceDueCalendarFields,
    customerPaymentOptions,
    customerBalanceBlockedMessage,
    isBookingOpenForPayments
};

