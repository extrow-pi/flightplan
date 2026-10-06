import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AddEventVendorInput,
  ApiError,
  AssignTableInput,
  Booking,
  BookingAlert,
  BulkInviteResult,
  CollaboratorInvite,
  CreateVendorInput,
  DiscountCode,
  DiscountCodeInput,
  DiscountCodeUse,
  QuoteRequestInput,
  QuoteResponse,
  UpdateVendorInput,
  VendorGroup,
  VendorListItem,
  VendorRequestHistory,
  CollaboratorInvitePreview,
  CollaboratorRole,
  CreateInviteInput,
  EventTeamResponse,
  InviteCollaboratorInput,
  OrganizerProfile,
  OrganizerProfileInput,
  PaymentMethod,
  PublicOrganizerPage,
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
    access: _a,
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

/** Vendors that can be picked when assigning a table on this event (the event owner's list). */
export function useEventVendors(eventId: string, enabled = true) {
  return useQuery({
    queryKey: [...bookingKeys.vendors, eventId],
    queryFn: () => request<{ vendors: Vendor[] }>(`/events/${eventId}/vendors`).then((r) => r.vendors),
    enabled: enabled && Boolean(eventId),
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
      request<{ bookings: Booking[] }>(`/events/${eventId}/bookings`, { method: "POST", body: input }).then((r) => r.bookings),
    onSuccess: () => invalidateBookings(qc, eventId),
  });
}

/** Add a vendor to the show without a table yet. */
export function useAddEventVendor(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddEventVendorInput) =>
      request<{ vendorId: string }>(`/events/${eventId}/unassigned`, { method: "POST", body: input }),
    onSuccess: () => invalidateBookings(qc, eventId),
  });
}

export function useRemoveEventVendor(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vendorId: string) => request(`/events/${eventId}/unassigned/${vendorId}`, { method: "DELETE" }),
    onSuccess: () => invalidateBookings(qc, eventId),
  });
}

// approve / reject / mark-paid / keep apply to the booking's whole request;
// release frees one table unless wholeRequest is set
export type BookingAction =
  | { action: "approve" | "reject" }
  | { action: "mark-paid"; paymentMethod?: PaymentMethod | null }
  | { action: "payment-method"; paymentMethod: PaymentMethod | null }
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
              : a.action === "mark-paid" || a.action === "payment-method"
                ? { paymentMethod: a.paymentMethod ?? null }
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

// ── Public organizer page ────────────────────────────────────────────────

const profileKey = ["profile"] as const;

/** The signed-in organizer's public page settings (null until first saved) */
export function useProfile() {
  return useQuery({
    queryKey: profileKey,
    queryFn: () => request<{ profile: OrganizerProfile | null; suggestedHandle: string }>("/profile"),
  });
}

export function useSaveProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OrganizerProfileInput) =>
      request<{ profile: OrganizerProfile }>("/profile", { method: "PUT", body: input }).then((r) => r.profile),
    onSuccess: (profile) => qc.setQueryData(profileKey, { profile, suggestedHandle: profile.handle }),
  });
}

export function useHandleAvailable(handle: string) {
  return useQuery({
    queryKey: ["profile", "handle", handle],
    queryFn: () =>
      request<{ valid: boolean; available: boolean }>(`/profile/handle-available?handle=${encodeURIComponent(handle)}`),
    enabled: handle.length >= 3,
    staleTime: 10_000,
  });
}

export function useProfileLogo() {
  const qc = useQueryClient();
  const onSuccess = (profile: OrganizerProfile) => qc.setQueryData(profileKey, { profile, suggestedHandle: profile.handle });
  return {
    upload: useMutation({
      mutationFn: (file: File) => {
        const form = new FormData();
        form.append("file", file);
        return request<{ profile: OrganizerProfile }>("/profile/logo", { method: "POST", body: form }).then((r) => r.profile);
      },
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: () => request<{ profile: OrganizerProfile }>("/profile/logo", { method: "DELETE" }).then((r) => r.profile),
      onSuccess,
    }),
  };
}

export function usePublicOrganizer(handle: string | undefined) {
  return useQuery({
    queryKey: ["public", "organizer", handle],
    queryFn: () => request<PublicOrganizerPage>(`/public/organizers/${handle}`),
    enabled: Boolean(handle),
    retry: (count, err) => !(err instanceof ApiRequestError && err.status === 404) && count < 2,
  });
}

// ── Vendors page ─────────────────────────────────────────────────────────

const vendorPageKeys = {
  list: ["vendor-list"] as const,
  groups: ["vendor-groups"] as const,
  requests: (id: string) => ["vendor-list", id, "requests"] as const,
};

/** The organizer's own vendor list, with groups and stats */
export function useVendorList() {
  return useQuery({
    queryKey: vendorPageKeys.list,
    queryFn: () => request<{ vendors: VendorListItem[] }>("/vendors").then((r) => r.vendors),
  });
}

export function useVendorRequests(vendorId: string) {
  return useQuery({
    queryKey: vendorPageKeys.requests(vendorId),
    queryFn: () => request<{ requests: VendorRequestHistory[] }>(`/vendors/${vendorId}/requests`).then((r) => r.requests),
  });
}

function invalidateVendorPage(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: vendorPageKeys.list }),
    qc.invalidateQueries({ queryKey: vendorPageKeys.groups }),
    // Favourite / banned flags also show on Tables pages and in the assign picker
    qc.invalidateQueries({ queryKey: bookingKeys.vendors }),
    qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "events" && q.queryKey[2] === "tables" }),
    qc.invalidateQueries({ queryKey: bookingKeys.alerts }),
  ]);
}

export function useCreateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateVendorInput) =>
      request<{ vendor: VendorListItem }>("/vendors", { method: "POST", body: input }).then((r) => r.vendor),
    onSuccess: () => invalidateVendorPage(qc),
  });
}

export function useUpdateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateVendorInput & { id: string }) =>
      request<{ vendor: VendorListItem }>(`/vendors/${id}`, { method: "PATCH", body: input }).then((r) => r.vendor),
    onSuccess: (vendor) => {
      // Update the row right away (e.g. the favourite star), then refresh everything it affects
      qc.setQueryData<VendorListItem[]>(vendorPageKeys.list, (list) => list?.map((v) => (v.id === vendor.id ? vendor : v)));
      return invalidateVendorPage(qc);
    },
  });
}

export function useVendorGroups() {
  return useQuery({
    queryKey: vendorPageKeys.groups,
    queryFn: () => request<{ groups: VendorGroup[] }>("/vendor-groups").then((r) => r.groups),
  });
}

export function useCreateVendorGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      request<{ group: VendorGroup }>("/vendor-groups", { method: "POST", body: { name } }).then((r) => r.group),
    onSuccess: () => invalidateVendorPage(qc),
  });
}

export function useRenameVendorGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      request<{ ok: true }>(`/vendor-groups/${id}`, { method: "PATCH", body: { name } }),
    onSuccess: () => invalidateVendorPage(qc),
  });
}

export function useDeleteVendorGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<void>(`/vendor-groups/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidateVendorPage(qc),
  });
}

/** Personal invites for everyone in a group (or all favourites), emailed to them */
export function useBulkInvite(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (target: string) =>
      request<BulkInviteResult>(`/events/${eventId}/invites/bulk`, { method: "POST", body: { target } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: bookingKeys.tables(eventId) }),
  });
}

// ── Team (collaborators) ─────────────────────────────────────────────────

const teamKey = (eventId: string) => ["events", eventId, "team"] as const;

export function useEventTeam(eventId: string | undefined) {
  return useQuery({
    queryKey: teamKey(eventId ?? ""),
    queryFn: () => request<EventTeamResponse>(`/events/${eventId}/team`),
    enabled: Boolean(eventId),
  });
}

export function useInviteCollaborator(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InviteCollaboratorInput) =>
      request<{ invite: CollaboratorInvite; link: string }>(`/events/${eventId}/team/invites`, { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: teamKey(eventId) }),
  });
}

export function useRevokeCollaboratorInvite(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => request<void>(`/collaborator-invites/${inviteId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: teamKey(eventId) }),
  });
}

export function useSetCollaboratorRole(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: CollaboratorRole }) =>
      request<{ ok: true }>(`/events/${eventId}/team/${userId}`, { method: "PATCH", body: { role } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: teamKey(eventId) }),
  });
}

/** Remove a collaborator, or leave the event when userId is your own. */
export function useRemoveCollaborator(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => request<void>(`/events/${eventId}/team/${userId}`, { method: "DELETE" }),
    onSuccess: () =>
      Promise.all([qc.invalidateQueries({ queryKey: teamKey(eventId) }), qc.invalidateQueries({ queryKey: eventKeys.all })]),
  });
}

export function useCollaboratorInvite(token: string | undefined) {
  return useQuery({
    queryKey: ["collaborator-invite", token],
    queryFn: () => request<CollaboratorInvitePreview>(`/collaborator-invites/by-token/${token}`),
    enabled: Boolean(token),
    retry: (count, err) => !(err instanceof ApiRequestError && err.status === 404) && count < 2,
  });
}

export function useAcceptCollaboratorInvite(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request<{ eventId: string; isTemplate: boolean }>(`/collaborator-invites/by-token/${token}/accept`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: eventKeys.all }),
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

/** Live price for the booking page: checks the discount code and picks the best discount. */
export function useBookingQuote(kind: BookingLinkKind, token: string, input: QuoteRequestInput, enabled: boolean) {
  return useQuery({
    queryKey: ["public", kind, token, "quote", input],
    queryFn: () => request<QuoteResponse>(`/public/${kind}/${token}/quote`, { method: "POST", body: input }),
    enabled,
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}

// ── Discount codes ───────────────────────────────────────────────────────

const codeKeys = { list: ["discount-codes"] as const, uses: (id: string) => ["discount-codes", id, "uses"] as const };

export function useDiscountCodes() {
  return useQuery({
    queryKey: codeKeys.list,
    queryFn: () => request<{ codes: DiscountCode[] }>("/discount-codes").then((r) => r.codes),
  });
}

export function useDiscountCodeUses(id: string) {
  return useQuery({
    queryKey: codeKeys.uses(id),
    queryFn: () => request<{ uses: DiscountCodeUse[] }>(`/discount-codes/${id}/uses`).then((r) => r.uses),
  });
}

/** Create (no id) or update a code */
export function useSaveDiscountCode(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DiscountCodeInput) =>
      request<{ code: DiscountCode }>(id ? `/discount-codes/${id}` : "/discount-codes", { method: id ? "PUT" : "POST", body: input }).then(
        (r) => r.code,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: codeKeys.list }),
  });
}

export function useDeleteDiscountCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<void>(`/discount-codes/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: codeKeys.list }),
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
