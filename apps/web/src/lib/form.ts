/** A form field's text, or "" for a missing field or a file upload. */
export function fieldText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
