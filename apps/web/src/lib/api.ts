import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError, EventInput, EventRecord, EventStatus } from "@flightplan/shared";

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public body: ApiError,
  ) {
    super(body.error);
  }
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? "GET",
    headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({ error: "Something went wrong. Please try again." }));
  if (!res.ok) throw new ApiRequestError(res.status, body);
  return body as T;
}

// ── Events ───────────────────────────────────────────────────────────────

const eventKeys = {
  all: ["events"] as const,
  detail: (id: string) => ["events", id] as const,
};

export function useEvents() {
  return useQuery({
    queryKey: eventKeys.all,
    queryFn: () => request<{ events: EventRecord[] }>("/events").then((r) => r.events),
  });
}

export function useEvent(id: string | undefined) {
  return useQuery({
    queryKey: eventKeys.detail(id ?? ""),
    queryFn: () => request<{ event: EventRecord }>(`/events/${id}`).then((r) => r.event),
    enabled: Boolean(id),
    retry: (count, err) => !(err instanceof ApiRequestError && err.status === 404) && count < 2,
  });
}

export function useSaveEvent(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EventInput) =>
      request<{ event: EventRecord }>(id ? `/events/${id}` : "/events", { method: id ? "PUT" : "POST", body: input }).then(
        (r) => r.event,
      ),
    onSuccess: (event) => {
      qc.setQueryData(eventKeys.detail(event.id), event);
      return qc.invalidateQueries({ queryKey: eventKeys.all, exact: true });
    },
  });
}

export function useSetEventStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: Exclude<EventStatus, "template"> }) =>
      request<{ event: EventRecord }>(`/events/${id}/status`, { method: "PATCH", body: { status } }).then((r) => r.event),
    onSuccess: (event) => {
      qc.setQueryData(eventKeys.detail(event.id), event);
      qc.setQueryData<EventRecord[]>(eventKeys.all, (list) => list?.map((e) => (e.id === event.id ? event : e)));
    },
  });
}

export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<void>(`/events/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: eventKeys.detail(id) });
      qc.setQueryData<EventRecord[]>(eventKeys.all, (list) => list?.filter((e) => e.id !== id));
    },
  });
}

/** Create a draft from a template, starting on startDate. */
export function useSpawnFromTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, startDate }: { templateId: string; startDate: string }) =>
      request<{ event: EventRecord }>(`/events/${templateId}/spawn`, { method: "POST", body: { startDate } }).then(
        (r) => r.event,
      ),
    onSuccess: (event) => {
      qc.setQueryData(eventKeys.detail(event.id), event);
      return qc.invalidateQueries({ queryKey: eventKeys.all, exact: true });
    },
  });
}
