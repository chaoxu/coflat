export interface DocumentOutlineEntry {
  readonly id: string;
  readonly text: string;
  readonly html: string;
  readonly level: number;
  readonly number?: string;
}

export interface DocumentOutlineEntryInput {
  readonly id: string;
  readonly text: string;
  readonly html: string;
  readonly level: number;
  readonly number?: string;
  readonly displayUnnumbered?: boolean;
}

export function documentOutlineEntry(input: DocumentOutlineEntryInput): DocumentOutlineEntry {
  return input.displayUnnumbered || !input.number
    ? {
      id: input.id,
      text: input.text,
      html: input.html,
      level: input.level,
    }
    : {
      id: input.id,
      text: input.text,
      html: input.html,
      level: input.level,
      number: input.number,
    };
}

