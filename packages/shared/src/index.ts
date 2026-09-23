import { z } from "zod";

export const EVENT_TYPES = [
  "Trading card shows",
  "Collectibles & comics",
  "Markets & fairs",
  "Tournaments",
  "Conventions",
  "Other",
] as const;

export const EVENTS_PER_YEAR = ["1-2", "3-6", "7-12", "12+"] as const;

// Shared by the signup form (client-side checks) and the API (the real gatekeeper).
export const organizerSignupSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name").max(100),
  email: z.email("Please enter a valid email").trim().toLowerCase().max(254),
  organization: z.string().trim().max(120).optional().default(""),
  city: z.string().trim().min(2, "Where are your events?").max(100),
  eventType: z.enum(EVENT_TYPES, { message: "Pick the closest fit" }),
  eventsPerYear: z.enum(EVENTS_PER_YEAR, { message: "Pick one" }),
  message: z.string().trim().max(1000).optional().default(""),
});

export type OrganizerSignupInput = z.input<typeof organizerSignupSchema>;
export type OrganizerSignup = z.output<typeof organizerSignupSchema>;

export type ApiError = {
  error: string;
  fieldErrors?: Partial<Record<keyof OrganizerSignupInput, string[]>>;
};
