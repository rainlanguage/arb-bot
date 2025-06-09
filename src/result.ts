import { Prettify } from "viem";

/** Ok varinat of Result */
export type Ok<T> = { value: T };

/** Error variant of Result */
export type Err<E> = { error: E };

/** Represents a result type that can ether be ok or error */
export type Result<T, E> = Prettify<
    (Ok<T> | Err<E>) & {
        isOk: () => this is Ok<T>;
        isErr: () => this is Err<E>;
    }
>;
export namespace Result {
    /** Creates an Ok variant of Result */
    export function ok<T, E>(value: T): Result<T, E> {
        return {
            value,
            isOk(): this is Ok<T> {
                // we explicitly check for existance of "value" and absence of "error" keys
                return "value" in this && !("error" in this);
            },
            isErr(): this is Err<E> {
                // we explicitly check for absence of "value" and existance of "error" keys
                return !("value" in this) && "error" in this;
            },
        };
    }

    /** Creates an Error variant of Result */
    export function err<T, E>(error: E): Result<T, E> {
        return {
            error,
            isOk(): this is Ok<T> {
                return "value" in this && !("error" in this);
            },
            isErr(): this is Err<E> {
                return !("value" in this) && "error" in this;
            },
        };
    }
}
