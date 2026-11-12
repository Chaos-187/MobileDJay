/**
 * Sanity-check race keyframes: mid-race leader should not always match final winner.
 */
const { buildRacePlan, progressFromPlan } = require('../lib/virtual-race-session');

const finishOrder = ['a', 'b', 'c', 'd', 'e', 'f'];
const plan = buildRacePlan(finishOrder);
const mid = progressFromPlan(plan.a, 0.4);
const midLeader = finishOrder
    .map((id) => ({ id, p: progressFromPlan(plan[id], 0.4) }))
    .sort((x, y) => y.p - x.p)[0].id;
const winnerMidP = progressFromPlan(plan[finishOrder[0]], 0.4);

finishOrder.forEach((id) => {
    const kf = plan[id].keyframes;
    for (let i = 1; i < kf.length; i++) {
        if (kf[i].p + 1e-6 < kf[i - 1].p) {
            console.error('Non-monotonic keyframes for', id, kf);
            process.exit(1);
        }
    }
});

let swaps = 0;
for (let t = 0.1; t <= 0.7; t += 0.1) {
    const ranking = finishOrder
        .map((id) => ({ id, p: progressFromPlan(plan[id], t) }))
        .sort((x, y) => y.p - x.p);
    if (ranking[0].id !== finishOrder[0]) swaps++;
}

if (swaps < 1) {
    console.error('Expected at least one mid-race leader change; got', swaps);
    process.exit(1);
}
if (progressFromPlan(plan[finishOrder[0]], 1) < 0.99) {
    console.error('Winner should finish near 1.0');
    process.exit(1);
}
console.log('OK — mid-race leader at t=0.4:', midLeader, 'winner p=', winnerMidP.toFixed(3));
