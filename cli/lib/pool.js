/**
 * A small pool of worker threads, one image in flight per worker.
 *
 * wasm encoding pins a core, so this is what makes a directory of images
 * finish in a fraction of the time.
 */
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Worker } from 'worker_threads';
import { cpus } from 'os';

const here = dirname(fileURLToPath(import.meta.url));

export function defaultConcurrency() {
  return Math.max(1, Math.min(4, (cpus().length || 4) - 1));
}

export class WorkerPool {
  #workers = [];
  #idle = [];
  #queue = [];
  #pending = new Map();
  #nextId = 0;

  constructor(size) {
    for (let i = 0; i < size; i++) {
      const worker = new Worker(join(here, 'worker.js'));
      worker.on('message', ({ id, result, error }) => {
        const task = this.#pending.get(id);
        this.#pending.delete(id);
        this.#idle.push(worker);
        this.#pump();
        if (error) task.reject(Error(error));
        else task.resolve(result);
      });
      worker.on('error', (err) => {
        // A worker that died takes its in-flight task with it.
        for (const [id, task] of this.#pending) {
          if (task.worker !== worker) continue;
          this.#pending.delete(id);
          task.reject(err);
        }
      });
      this.#workers.push(worker);
      this.#idle.push(worker);
    }
  }

  run(task) {
    return new Promise((resolve, reject) => {
      this.#queue.push({ task, resolve, reject });
      this.#pump();
    });
  }

  #pump() {
    while (this.#idle.length > 0 && this.#queue.length > 0) {
      const worker = this.#idle.pop();
      const { task, resolve, reject } = this.#queue.shift();
      const id = this.#nextId++;
      this.#pending.set(id, { resolve, reject, worker });
      worker.postMessage({ ...task, id });
    }
  }

  async close() {
    await Promise.all(this.#workers.map((worker) => worker.terminate()));
  }
}
