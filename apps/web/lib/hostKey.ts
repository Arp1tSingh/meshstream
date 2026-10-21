export interface HostRecord {
  streamId: string;
  hostKey: string;
  title: string;
  createdAt: number;
}

const HOSTS_KEY = "meshstream:hosts";
const P2P_KEY = "meshstream:p2p";

function read(): HostRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HOSTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HostRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(records: HostRecord[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(HOSTS_KEY, JSON.stringify(records.slice(0, 30)));
}

export function saveHost(record: HostRecord) {
  const records = read().filter((item) => item.streamId !== record.streamId);
  records.unshift(record);
  write(records);
}

export function getHost(streamId: string): HostRecord | null {
  return read().find((item) => item.streamId === streamId) ?? null;
}

export function listHosts(): HostRecord[] {
  return read();
}

export function removeHost(streamId: string) {
  write(read().filter((item) => item.streamId !== streamId));
}

export function getP2pPreference(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(P2P_KEY) !== "false";
}

export function setP2pPreference(value: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(P2P_KEY, String(value));
}
