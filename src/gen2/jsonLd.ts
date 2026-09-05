/**
 * Serialize untrusted structured-data values for an HTML script element.
 * JSON.stringify is valid JSON but does not prevent </script> from ending the
 * surrounding element before the browser's JSON parser sees it.
 */
export function safeJsonLdText(value: unknown): string {
  const serialized = JSON.stringify(value) || "null";
  return serialized.replace(/[<>&]/g, (character) => ({
    "<": "\\u003c",
    ">": "\\u003e",
    "&": "\\u0026",
  })[character] || character);
}
