import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApiError,
  AssignTableInput,
  Booking,
  BookingAlert,
  CreateInviteInput,
  EmailLogEntry,
  EventInput,
  EventRecord,
  EventStatus,
  EventTablesResponse,
  Invite,
  PublicBookingPage,
  PublicBookingResult,
  PublicRequestStatus,
  Vendor,
  VendorBookingInput,
} from "@flightplan/shared";

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public body: ApiError,
  ) {
    super(body.error);
  }
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    method: init.method ?? "GET",
    headers: init.body === undefined || isForm ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : isForm ? (init.body as FormData) : JSON.stringify(init.body),
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

/** Create (no id) or update an event. `floorMapFrom` reuses another event's floor map on create. */
export function useSaveEvent(id?: string, opts: { floorMapFrom?: string } = {}) {
  const qc = useQueryClient();
  const createPath = opts.floorMapFrom ? `/events?floorMapFrom=${opts.floorMapFrom}` : "/events";
  return useMutation({
    mutationFn: (input: EventInput) =>
      request<{ event: EventRecord }>(id ? `/events/${id}` : createPath, { method: id ? "PUT" : "POST", body: input }).then(
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

function setEvent(qc: ReturnType<typeof useQueryClient>, event: EventRecord) {
  qc.setQueryData(eventKeys.detail(event.id), event);
  qc.setQueryData<EventRecord[]>(eventKeys.all, (list) => list?.map((e) => (e.id === event.id ? event : e)));
}

/** The editable fields of an event, e.g. to save it again with one setting changed. */
export function eventToInput(e: EventRecord): EventInput {
  const {
    id: _id,
    createdAt: _c,
    updatedAt: _u,
    bookingToken: _t,
    floorMapUrl: _f,
    ...input
  } = e;
  return input;
}

export function useUploadFloorMap(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return request<{ event: EventRecord }>(`/events/${eventId}/floor-map`, { method: "POST", body: form }).then(
        (r) => r.event,
      );
    },
    onSuccess: (event) => setEvent(qc, event),
  });
}

export function useRemoveFloorMap(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request<{ event: EventRecord }>(`/events/${eventId}/floor-map`, { method: "DELETE" }).then((r) => r.event),
    onSuccess: (event) => setEvent(qc, event),
  });
}

// ── Tables & bookings ────────────────────────────────────────────────────

const bookingKeys = {
  tables: (eventId: string) => ["events", eventId, "tables"] as const,
  alerts: ["alerts"] as const,
  vendors: ["vendors"] as const,
};

export function useEventTables(eventId: string | undefined) {
  return useQuery({
    queryKey: bookingKeys.tables(eventId ?? ""),
    queryFn: () => request<EventTablesResponse>(`/events/${eventId}/tables`),
    enabled: Boolean(eventId),
  });
}

export function useAlerts() {
  return useQuery({
    queryKey: bookingKeys.alerts,
    queryFn: () => request<{ alerts: BookingAlert[] }>("/alerts").then((r) => r.alerts),
    // Deadlines pass while the dashboard is open
    refetchInterval: 60_000,
  });
}

export function useVendors() {
  return useQuery({
    queryKey: bookingKeys.vendors,
    queryFn: () => request<{ vendors: Vendor[] }>("/vendors").then((r) => r.vendors),
  });
}

/** Refresh everything a booking change can affect. */
function invalidateBookings(qc: ReturnType<typeof useQueryClient>, eventId?: string) {
  return Promise.all([
    eventId
      ? qc.invalidateQueries({ queryKey: bookingKeys.tables(eventId) })
      : qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "events" && q.queryKey[2] === "tables" }),
    qc.invalidateQueries({ queryKey: bookingKeys.alerts }),
    qc.invalidateQueries({ queryKey: bookingKeys.vendors }),
  ]);
}

export function useAssignTable(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AssignTableInput) =>
      request<{ booking: Booking }>(`/events/${eventId}/bookings`, { method: "POST", body: input }).then((r) => r.booking),
    onSuccess: () => invalidateBookings(qc, eventId),
  });
}

// approve / reject / mark-paid / keep apply to the booking's whole request;
// release frees one table unless wholeRequest is set
export type BookingAction =
  | { action: "approve" | "reject" | "mark-paid" }
  | { action: "release"; wholeRequest?: boolean }
  | { action: "keep"; extendDays: number | null };

export function useBookingAction(eventId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, ...a }: BookingAction & { bookingId: string }) =>
      request<{ bookings: Booking[] }>(`/bookings/${bookingId}/${a.action}`, {
        method: "POST",
        body:
          a.action === "keep"
            ? { extendDays: a.extendDays }
            : a.action === "release"
              ? { wholeRequest: a.wholeRequest ?? false }
              : {},
      }).then((r) => r.bookings),
    onSuccess: () => invalidateBookings(qc, eventId),
  });
}

export function useCreateInvite(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInviteInput) =>
      request<{ invite: Invite }>(`/events/${eventId}/invites`, { method: "POST", body: input }).then((r) => r.invite),
    onSuccess: () => qc.invalidateQueries({ queryKey: bookingKeys.tables(eventId) }),
  });
}

export function useRevokeInvite(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => request<{ invite: Invite }>(`/invites/${inviteId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: bookingKeys.tables(eventId) }),
  });
}

// ── Public booking pages (no sign-in) ────────────────────────────────────

export type BookingLinkKind = "book" | "invite";

export function usePublicBooking(kind: BookingLinkKind, token: string | undefined) {
  return useQuery({
    queryKey: ["public", kind, token],
    queryFn: () => request<PublicBookingPage>(`/public/${kind}/${token}`),
    enabled: Boolean(token),
    retry: (count, err) => !(err instanceof ApiRequestError && err.status === 404) && count < 2,
  });
}

export function useSubmitBooking(kind: BookingLinkKind, token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: VendorBookingInput) =>
      request<PublicBookingResult>(`/public/${kind}/${token}`, { method: "POST", body: input }),
    // Refresh availability either way (e.g. someone else took the table)
    onSettled: () => qc.invalidateQueries({ queryKey: ["public", kind, token] }),
  });
}

// ── Email log ────────────────────────────────────────────────────────────

export function useEmailLog() {
  return useQuery({
    queryKey: ["emails"],
    queryFn: () => request<{ emails: EmailLogEntry[]; deliveryEnabled: boolean }>("/emails"),
    // Queued emails flip to sent within seconds
    refetchInterval: 15_000,
  });
}

/** An email's HTML, for previewing in a sandboxed iframe. */
export function useEmailHtml(id: string) {
  return useQuery({
    queryKey: ["emails", id, "html"],
    queryFn: async () => {
      const res = await fetch(`/api/emails/${id}/html`);
      if (!res.ok) throw new Error("Couldn't load this email");
      return res.text();
    },
    staleTime: Infinity,
  });
}

export function useRetryEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<{ ok: true }>(`/emails/${id}/retry`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emails"] }),
  });
}

// ── Vendor status page (no sign-in) ──────────────────────────────────────

export function useRequestStatus(requestId: string | undefined) {
  return useQuery({
    queryKey: ["public", "request", requestId],
    queryFn: () => request<PublicRequestStatus>(`/public/request/${requestId}`),
    enabled: Boolean(requestId),
    retry: (count, err) => !(err instanceof ApiRequestError && err.status === 404) && count < 2,
  });
}
