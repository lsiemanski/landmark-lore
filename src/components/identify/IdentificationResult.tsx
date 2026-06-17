interface IdentificationResultProps {
  /** Heading — the subject name for a recognised photo, or a fallback message otherwise. */
  title: string;
  /** Body copy describing the subject (or why it couldn't be identified). */
  description: string;
  /** Optional id applied to the <h2> for aria-labelledby wiring in modal contexts. */
  titleId?: string;
}

/**
 * The subject heading + description panel — the core domain output of an
 * identification. Extracted from UploadFlow so S-02 (follow-up questions) and
 * S-03 (archive detail) can render the same panel without duplicating markup.
 */
export function IdentificationResult({ title, description, titleId }: IdentificationResultProps) {
  return (
    <div>
      <h2 id={titleId} className="text-xl font-bold text-white">
        {title}
      </h2>
      <p className="mt-2 text-justify text-sm leading-relaxed text-blue-100/80">{description}</p>
    </div>
  );
}
