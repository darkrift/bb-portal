export class TargetNotFoundError extends Error {
  constructor() {
    super("TARGET_NOT_FOUND");
  }
}

export class TestNotFoundError extends Error {
  constructor() {
    super("TEST_NOT_FOUND");
  }
}
