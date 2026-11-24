// Backend base URL. Set EXPO_PUBLIC_API_URL in mobile/.env (see .env.example).
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
  } catch {
    throw new Error('Brak połączenia z serwerem');
  }
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Błąd serwera (${res.status})`);
  return body;
}

export const api = {
  listHives: () => request('/api/hives'),
  createHive: (hive) => request('/api/hives', { method: 'POST', body: JSON.stringify(hive) }),
  updateHive: (id, hive) => request(`/api/hives/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(hive) }),
  getLogs: (id) => request(`/api/hives/${encodeURIComponent(id)}/logs`),
};
