/**
 * The result shape that every service and action returns.
 *
 * An expected failure, such as a closed period or an unbalanced entry, comes
 * back as a value with a reason code. The caller has to check `ok` before it
 * can read a success's fields, so no failure goes unhandled by accident.
 * Throw only for bugs and for infrastructure that is down.
 */

/** A success. Its fields sit next to `ok`, as in `{ ok: true, entryId }`. */
export type Ok<Fields extends object = Record<never, never>> = {
  readonly ok: true;
} & Fields;

/** An expected failure: a reason code, plus any details the caller needs. */
export type Fail<
  Reason extends string,
  Details extends object = Record<never, never>,
> = {
  readonly ok: false;
  readonly reason: Reason;
} & Details;

export type Result<Fields extends object, Reason extends string> =
  Ok<Fields> | Fail<Reason>;

/** Fields of a success or details of a failure can't reuse these names. */
type WithoutResultKeys = {
  readonly ok?: never;
  readonly reason?: never;
};

export function ok(): Ok;
export function ok<Fields extends object & WithoutResultKeys>(
  fields: Fields,
): Ok<Fields>;
export function ok(fields?: object): Ok<object> {
  return { ...fields, ok: true };
}

export function fail<Reason extends string>(reason: Reason): Fail<Reason>;
export function fail<
  Reason extends string,
  Details extends object & WithoutResultKeys,
>(reason: Reason, details: Details): Fail<Reason, Details>;
export function fail(reason: string, details?: object): Fail<string, object> {
  return { ...details, ok: false, reason };
}
