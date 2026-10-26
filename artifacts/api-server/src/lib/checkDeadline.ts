export const CHECK_TIMEOUT_MS = 20_000;

export class CheckTimeoutError extends Error {
  constructor(readonly stage: "request" | "cache" | "search" | "gemini") {
    super("This check took too long. Please try again in a moment.");
    this.name = "CheckTimeoutError";
  }
}

// Race the entire operation, including response-body reads, against cancellation.
// The fetch itself also receives this signal, so timed-out provider work stops.
export function withinCheckSignal<T>(
  signal: AbortSignal,
  stage: CheckTimeoutError["stage"],
  operation: () => Promise<T>,
): Promise<T> {
  if (signal.aborted) return Promise.reject(new CheckTimeoutError(stage));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new CheckTimeoutError(stage));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => {
      if (signal.aborted) throw new CheckTimeoutError(stage);
      return operation();
    }).then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
