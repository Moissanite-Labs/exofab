// In-process async mutex: run(fn) waits for every earlier run to settle, so
// read-modify-write sequences never interleave. It does not lock across
// processes; one hub process owns a data directory at a time.
export class Mutex {
  #tail = Promise.resolve();

  run(fn) {
    const result = this.#tail.then(() => fn());
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
