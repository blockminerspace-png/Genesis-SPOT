import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { finiteOrNull, finitePositiveOrNull } from "./bot-spot.validation.js";

describe("bot-spot.validation", () => {
  it("finiteOrNull rejects NaN and undefined", () => {
    assert.equal(finiteOrNull(undefined), null);
    assert.equal(finiteOrNull("NaN"), null);
    assert.equal(finiteOrNull("12.5"), 12.5);
  });

  it("finitePositiveOrNull rejects zero", () => {
    assert.equal(finitePositiveOrNull(0), null);
    assert.equal(finitePositiveOrNull("0.0001"), 0.0001);
  });
});
