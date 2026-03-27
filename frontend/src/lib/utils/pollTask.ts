import { apiGetTask } from "@/lib/api/backendClient";

type TaskStatus = "pending" | "started" | "success" | "failed" | "revoked";

interface PollOptions {
  /** Polling interval in ms (default: 2000) */
  interval?: number;
  /** Max number of polls before giving up (default: 60 = 2 min at 2s interval) */
  maxPolls?: number;
  /** C6: AbortSignal — cancel polling when image is removed or component unmounts */
  signal?: AbortSignal;
}

/**
 * Poll a Celery task until it reaches a terminal state.
 * Resolves with the task result on success, rejects on failure or timeout.
 */
export async function pollTask<T = unknown>(
  taskId: string,
  options: PollOptions = {},
): Promise<T> {
  const { interval = 2000, maxPolls = 60, signal } = options;

  return new Promise((resolve, reject) => {
    let polls = 0;

    // C6: abort immediately if signal already fired
    if (signal?.aborted) {
      reject(new DOMException("Polling aborted", "AbortError"));
      return;
    }

    const timer = setInterval(async () => {
      // C6: check abort on each tick
      if (signal?.aborted) {
        clearInterval(timer);
        reject(new DOMException("Polling aborted", "AbortError"));
        return;
      }

      polls += 1;
      try {
        const task = await apiGetTask(taskId);
        const status = task.status as TaskStatus;

        if (status === "success") {
          clearInterval(timer);
          resolve(task.result as T);
        } else if (status === "failed" || status === "revoked") {
          clearInterval(timer);
          reject(new Error(`Task ${taskId} ${status}`));
        } else if (polls >= maxPolls) {
          clearInterval(timer);
          reject(new Error(`Task ${taskId} timed out after ${polls} polls`));
        }
      } catch (err) {
        clearInterval(timer);
        reject(err);
      }
    }, interval);

    // C6: register abort listener to cancel in-flight timer
    signal?.addEventListener("abort", () => {
      clearInterval(timer);
      reject(new DOMException("Polling aborted", "AbortError"));
    });
  });
}
