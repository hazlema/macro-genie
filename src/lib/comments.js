// A post's comment list while comments are shown "Posting…" before the
// server answers. Loading the list can finish after a comment was added, so
// neither step may drop the other's work.

// Comments from the server, plus any of ours still being posted.
export function mergeLoaded(loaded, current) {
  const pending = (current ?? []).filter((c) => c.status === "sending");
  return [...loaded, ...pending];
}

// Swap the "Posting…" placeholder for the saved comment. If a reload already
// dropped the placeholder, add the comment unless the reload brought it in.
export function settleSent(list, tempId, real) {
  const comments = list ?? [];
  if (comments.some((c) => c.id === tempId))
    return comments.map((c) => (c.id === tempId ? { ...c, ...real } : c));
  if (comments.some((c) => c.id === real.id)) return comments;
  return [...comments, real];
}
