'use strict';
// Which earned achievements has this user not been told about yet? State lives in ud.achNotified (array of ids).
// First call for a user (no state yet) records everything already earned as notified, so nobody gets a flood.
const earnedIds = A => [...A.global, ...A.personal].filter(a => a.earned).map(a => a.id);
function pending(ud, A) {
  const ids = earnedIds(A);
  if (!Array.isArray(ud.achNotified)) { ud.achNotified = ids; return { ids: [], init: true }; }
  const seen = new Set(ud.achNotified); return { ids: ids.filter(id => !seen.has(id)), init: false };
}
// mark ids as notified (only ids that are actually earned, deduped); returns how many were added
function markSeen(ud, A, ids) {
  const ok = new Set(earnedIds(A)), cur = new Set(Array.isArray(ud.achNotified) ? ud.achNotified : []), before = cur.size;
  for (const id of ids || []) if (ok.has(String(id))) cur.add(String(id));
  ud.achNotified = [...cur]; return cur.size - before;
}
module.exports = { pending, markSeen, earnedIds };
