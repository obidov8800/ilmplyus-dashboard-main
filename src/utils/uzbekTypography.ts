/** Admin editorial style: o‘ / g‘, ma’muriy, and ‘‘quoted text’’. */
export function normalizeUzbekText(text: string): string {
  // Markup and addresses are not prose, even inside a display-text field.
  return text.split(/(<[^>]*>|(?:https?:\/\/|www\.)[^\s]+|[^\s]+@[^\s]+|[A-Za-z]:\\[^\s]+)/g)
    .map((part, index) => index % 2 ? part : normalizeProse(part)).join('');
}

function normalizeProse(text: string): string {
  // Keep addresses and paths byte-for-byte intact, even in a prose field.
  const normalized = text.split(/(\s+)/).map((part) => {
    if (/@|:\/\/|^www\.|[/\\]/.test(part)) return part;
    return part.replace(/([oOgG])['`‘’ʻʼʹ´](?!['`‘’ʻʼʹ´])|([a-zA-Z])['`‘’ʻʼʹ´](?=[a-zA-Z])/g, (_match, rounded: string | undefined, other: string | undefined) => {
      const letter = rounded ?? other!;
      return letter + (/[oOgG]/.test(letter) ? '‘' : '’');
    });
  }).join('');
  // Only paired quotation marks; an unfinished quote stays editable.
  return normalized.replace(/(?<![\p{L}\p{N}])"([^"\r\n]*)"(?![\p{L}\p{N}])|“([^”\r\n]*)”|‘‘([^\r\n]*?)’’/gu,
    (_match, straight: string | undefined, curly: string | undefined, paired: string | undefined) =>
      `‘‘${(straight ?? curly ?? paired ?? '').trim()}’’`);
}

// Only human-readable fields: never rewrite credentials, IDs, URLs, codes,
// machine values or serialized documents. Nested keys retain their own meaning.
const TEXT_FIELD = /^(?:name|full_name|fullname|first_name|last_name|middle_name|surname|patronymic|title|label|description|comment|comments|note|notes|reason|address|text|question|question_text|answer_text|message|nomi|izoh|manzil|fio)$|_(?:name|title|description|comment|notes|address)$/i;

export function normalizeUzbekFields(value: unknown, field = ''): unknown {
  if (typeof value === 'string') return TEXT_FIELD.test(field) ? normalizeUzbekText(value) : value;
  if (value instanceof FormData) {
    const normalized = new FormData();
    for (const [key, entry] of value.entries()) {
      // Laravel form keys can be nested: students[0][full_name].
      const leaf = key.replace(/\]/g, '').split('[').at(-1) ?? key;
      normalized.append(key, typeof entry === 'string'
        ? normalizeUzbekFields(entry, leaf) as string : entry);
    }
    return normalized;
  }
  if (Array.isArray(value)) return value.map((entry) => normalizeUzbekFields(entry, field));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
      [key, normalizeUzbekFields(entry, key)]));
  }
  return value;
}
