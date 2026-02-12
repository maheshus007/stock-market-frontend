import axios from 'axios';

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';

export const api = axios.create({
  baseURL: API_BASE,
});

api.interceptors.request.use((config) => {
  config.headers = config.headers || {};
  // Avoid stale GETs from browser/proxy caches (important for metrics/prediction dashboards).
  (config.headers as any)['Cache-Control'] = 'no-cache';
  (config.headers as any)['Pragma'] = 'no-cache';
  (config.headers as any)['Expires'] = '0';
  return config;
});

// Response helpers to normalize errors
export async function safeGet<T>(url: string) {
  try {
    const res = await api.get<T>(url);
    return { data: res.data as T, error: null };
  } catch (e: any) {
    return { data: null as any as T, error: e?.response?.data || e?.message || 'Request failed' };
  }
}

export async function safePost<T>(url: string, body?: any) {
  try {
    const res = await api.post<T>(url, body);
    return { data: res.data as T, error: null };
  } catch (e: any) {
    return { data: null as any as T, error: e?.response?.data || e?.message || 'Request failed' };
  }
}

export async function safePut<T>(url: string, body?: any) {
  try {
    const res = await api.put<T>(url, body);
    return { data: res.data as T, error: null };
  } catch (e: any) {
    return { data: null as any as T, error: e?.response?.data || e?.message || 'Request failed' };
  }
}
