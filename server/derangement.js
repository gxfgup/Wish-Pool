function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function isDerangement(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) return false;
  }
  return true;
}

function derangement(ids, maxAttempts = 2000) {
  if (ids.length < 2) return null;
  const base = [...ids];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const perm = shuffle([...ids]);
    if (isDerangement(base, perm)) return perm;
  }

  return null;
}

module.exports = { derangement };
