export function getApiBase() {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured !== undefined) return configured.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location.port === "3000") {
    return "http://localhost:4000";
  }
  return "";
}

export function getSignalBase() {
  const configured = process.env.NEXT_PUBLIC_SIGNAL_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (typeof window !== "undefined") {
    if (window.location.port === "3000") return "ws://localhost:4001";
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}`;
  }
  return "ws://localhost:4001";
}

export function resolveApiPath(path: string) {
  if (/^https?:\/\//.test(path)) return path;
  return `${getApiBase()}${path.startsWith("/") ? path : `/${path}`}`;
}

export function resolveWsPath(base: string, path: "viewer" | "studio" | "chat") {
  if (base.endsWith("/ws")) return `${base}/${path}`;
  return `${base}/ws/${path}`;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`${getApiBase()}${path}`, {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    let message = response.statusText || "Request failed";
    try {
      const data = (await response.json()) as { error?: string; hint?: string };
      message = data.hint ? `${data.error ?? message} — ${data.hint}` : (data.error ?? message);
    } catch {
      // keep status text
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
