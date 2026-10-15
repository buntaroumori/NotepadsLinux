/**
 * diff.js — line based side-by-side diff for the Change Preview panel (Alt+D).
 *
 * A plain longest-common-subsequence table over lines, with a size guard so a
 * pathological pair of files cannot freeze the UI. This is the Linux stand-in
 * for the DiffPlex-powered viewer of the original application.
 */

const MAX_LINES = 6000;

/** @returns {Array<{type:'same'|'add'|'del'|'pad', left:string|null, right:string|null, leftNo:number|null, rightNo:number|null}>} */
export function diffLines(oldText, newText) {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return coarseDiff(a, b);
  }
  const n = a.length;
  const m = b.length;
  // LCS lengths, computed row by row to keep memory at O(m).
  const dp = new Uint32Array((n + 1) * (m + 1));
  const w = m + 1;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }

  const rows = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push(row('same', a[i], b[j], i + 1, j + 1));
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      rows.push(row('del', a[i], null, i + 1, null));
      i++;
    } else {
      rows.push(row('add', null, b[j], null, j + 1));
      j++;
    }
  }
  while (i < n) {
    rows.push(row('del', a[i], null, i + 1, null));
    i++;
  }
  while (j < m) {
    rows.push(row('add', null, b[j], null, j + 1));
    j++;
  }
  return rows;
}

function row(type, left, right, leftNo, rightNo) {
  return { type, left, right, leftNo, rightNo };
}

function coarseDiff(a, b) {
  const rows = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const l = a[i] ?? null;
    const r = b[i] ?? null;
    const type = l === r ? 'same' : l == null ? 'add' : 'del';
    rows.push(row(type, l, r, l == null ? null : i + 1, r == null ? null : i + 1));
  }
  return rows;
}

export function diffStats(rows) {
  let added = 0;
  let removed = 0;
  for (const r of rows) {
    if (r.type === 'add') added++;
    else if (r.type === 'del') removed++;
  }
  return { added, removed, rows: rows.length };
}
