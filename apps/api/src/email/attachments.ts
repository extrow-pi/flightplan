import type { EmailAttachmentRef } from "../db/schema.js";
import { readAttachment } from "../uploads.js";

/**
 * Resend's attachment list for an email. Files are read at send time; every copy of a message
 * shares the same stored files. Images shown in the email carry a content_id (<img src="cid:…">).
 */
export async function resendAttachments(refs: EmailAttachmentRef[]) {
  return Promise.all(
    refs.map(async (a) => {
      const bytes = await readAttachment(a.file);
      if (!bytes) throw new Error(`Attachment ${a.filename} is missing`);
      return {
        filename: a.filename,
        content: bytes.toString("base64"),
        content_type: a.contentType,
        ...(a.contentId && { content_id: a.contentId }),
      };
    }),
  );
}
